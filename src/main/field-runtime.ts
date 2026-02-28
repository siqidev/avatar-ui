import OpenAI from "openai"
import * as http from "node:http"
import * as fs from "node:fs"
import cron from "node-cron"
import { getConfig, isRobloxEnabled } from "../config.js"
import type { AppConfig } from "../config.js"
import { loadState, saveState, defaultState } from "../state/state-repository.js"
import type { State } from "../state/state-repository.js"
import { sendMessage } from "../services/chat-session-service.js"
import type { SendMessageResult } from "../services/chat-session-service.js"
import { startObservationServer } from "../roblox/observation-server.js"
import type { ObservationEvent } from "../roblox/observation-server.js"
import { formatObservation } from "../roblox/observation-formatter.js"
import { generateCorrelationId } from "../shared/participation-context.js"
import { report, isFrozen } from "./integrity-manager.js"
import * as log from "../logger.js"

// FieldRuntime: 場のロジックを統合する
// CLIのmain()と同等の機能をElectron Main向けに提供

let client: OpenAI
let config: AppConfig
let state: State
let beingPrompt: string
let initialized = false

// 直列キュー（同時にsendMessageを呼ばないようにする）
// 凍結中はジョブをスキップ（検知後の安全側停止）
let queue: Promise<void> = Promise.resolve()
function enqueue(fn: () => Promise<void>): Promise<void> {
  queue = queue.then(() => {
    if (isFrozen()) {
      log.info("[RUNTIME] 凍結中 — ジョブスキップ")
      return
    }
    return fn()
  }, () => {
    if (isFrozen()) {
      log.info("[RUNTIME] 凍結中 — ジョブスキップ")
      return
    }
    return fn()
  })
  return queue
}

// being.mdを読み込む
function loadBeing(): string {
  try {
    return fs.readFileSync(getConfig().beingFile, "utf-8").trim()
  } catch {
    throw new Error("BEING.md が見つかりません")
  }
}

// pulse.mdを読み込む
function loadPulse(): string | null {
  try {
    const content = fs.readFileSync(getConfig().pulseFile, "utf-8").trim()
    return content || null
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }
    throw err
  }
}

// FieldRuntimeを初期化する
export function initRuntime(): void {
  if (initialized) return

  config = getConfig()
  client = new OpenAI({
    apiKey: config.xaiApiKey,
    baseURL: config.apiBaseUrl,
  })
  beingPrompt = loadBeing()

  // state.json読み込み（破損検知: ENOENT以外はthrow）
  try {
    state = loadState()
  } catch (err) {
    report("COEXISTENCE_STATE_LOAD_CORRUPTED",
      `state.json破損: ${err instanceof Error ? err.message : String(err)}`)
    state = defaultState()
  }

  initialized = true
  log.info(`[RUNTIME] 初期化完了 (lastResponseId: ${state.lastResponseId ?? "なし"})`)
}

// ストリームメッセージを処理する（stream.post → sendMessage → stream.reply）
export function processStream(text: string): Promise<SendMessageResult> {
  if (!initialized) throw new Error("FieldRuntime未初期化")

  return new Promise<SendMessageResult>((resolve, reject) => {
    enqueue(async () => {
      try {
        const result = await sendMessage(client, state, beingPrompt, text)
        saveState(state)
        resolve(result)
      } catch (err) {
        reject(err)
      }
    })
  })
}

// Pulseを開始する（AI起点の定期発話）
// isFieldActive: 場状態ゲート（非アクティブ時はスキップ）
export function startPulse(
  onReply: (result: SendMessageResult, correlationId: string) => void,
  isFieldActive: () => boolean,
): void {
  if (!initialized) throw new Error("FieldRuntime未初期化")

  cron.schedule(config.pulseCron, () => {
    if (!isFieldActive()) {
      log.info("[PULSE] 場が非アクティブ — スキップ")
      return
    }

    const pulseContent = loadPulse()
    if (!pulseContent) return

    const correlationId = generateCorrelationId("pulse")
    log.info(`[PULSE] 発火 (${correlationId})`)
    enqueue(async () => {
      try {
        const result = await sendMessage(
          client,
          state,
          beingPrompt,
          config.pulsePrompt,
          true, // forceSystemPrompt
        )
        saveState(state)
        if (!result.text.startsWith(config.pulseOkPrefix)) {
          log.info(`[PULSE] 応答: ${result.text.substring(0, 100)}`)
          onReply(result, correlationId)
        } else {
          log.info("[PULSE] 対応不要")
        }
      } catch (err) {
        report("RECIPROCITY_PULSE_ERROR",
          `Pulse処理エラー: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  })

  log.info(`[PULSE] cron開始: ${config.pulseCron}`)
}

// 観測サーバーを起動する（Roblox連携有効時のみ）
// onEvent: 生イベント通知（Renderer表示用）
// onReply: AI応答通知（stream.reply用）
let observationServer: http.Server | null = null

// isFieldActive: 場状態ゲート（非アクティブ時はスキップ）
export function startObservation(
  onEvent: (event: ObservationEvent, formatted: string, correlationId: string) => void,
  onReply: (result: SendMessageResult, correlationId: string) => void,
  isFieldActive: () => boolean,
): void {
  if (!initialized) throw new Error("FieldRuntime未初期化")
  if (!isRobloxEnabled(config)) {
    log.info("[OBSERVATION] Roblox連携無効 — 観測サーバー起動スキップ")
    return
  }

  observationServer = startObservationServer(
    (event: ObservationEvent) => {
      // roblox_log: 表示+ログのみ、AIには送らない
      if (event.type === "roblox_log") {
        const formatted = formatObservation(event, config.robloxOwnerDisplayName)
        log.info(`[ROBLOX] ${formatted}`)
        const correlationId = generateCorrelationId("observation")
        onEvent(event, formatted, correlationId)
        return
      }

      if (!isFieldActive()) {
        log.info("[OBSERVATION] 場が非アクティブ — スキップ")
        return
      }

      // correlationIdを1回だけ生成し、onEventとonReplyで同一IDを使う
      const correlationId = generateCorrelationId("observation")
      const formatted = formatObservation(event, config.robloxOwnerDisplayName)
      onEvent(event, formatted, correlationId)

      enqueue(async () => {
        try {
          log.info(`[OBSERVATION→AI] (${correlationId}) ${formatted}`)
          const result = await sendMessage(client, state, beingPrompt, formatted)
          saveState(state)
          log.info(`[AI→OBSERVATION] (${correlationId}) ${result.text.substring(0, 100)}`)
          onReply(result, correlationId)
        } catch (err) {
          report("RECIPROCITY_OBSERVATION_ERROR",
            `観測AI応答エラー: ${err instanceof Error ? err.message : String(err)}`)
        }
      })
    },
    config.robloxObservationSecret,
  )

  log.info("[OBSERVATION] 観測サーバー起動")
}

// ランタイム停止（観測サーバーのクリーンアップ）
export function stopRuntime(): void {
  if (observationServer) {
    observationServer.close()
    observationServer = null
    log.info("[OBSERVATION] 観測サーバー停止")
  }
}

// 現在のlastResponseIdを取得（会話継続性の確認用）
export function getLastResponseId(): string | null {
  return state?.lastResponseId ?? null
}
