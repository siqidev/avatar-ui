import OpenAI from "openai"
import * as http from "node:http"
import * as fs from "node:fs"
import cron from "node-cron"
import { getConfig, isRobloxEnabled } from "../config.js"
import type { AppConfig } from "../config.js"
import { loadState, saveState, defaultState, pushMessage } from "../state/state-repository.js"
import type { State, PersistedMessage } from "../state/state-repository.js"
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

// チェーンTTL（30日）
const CHAIN_TTL_MS = 30 * 24 * 60 * 60 * 1000

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

// --- 起動時の状態補正 ---
// 異常終了（active/resumed）→ paused に補正
// terminated → 維持（attach時にリセット）
// チェーンTTL超過 → lastResponseId null化
function correctStateOnStartup(s: State): void {
  const fs = s.field.state

  // active/resumed = 異常終了（Main終了=暗黙のdetach）
  if (fs === "active" || fs === "resumed") {
    log.info(`[RUNTIME] 起動時補正: ${fs} → paused（異常終了検知）`)
    s.field.state = "paused"
  }

  // チェーンTTL超過チェック
  if (s.participant.lastResponseId && s.participant.lastResponseAt) {
    const elapsed = Date.now() - new Date(s.participant.lastResponseAt).getTime()
    if (elapsed > CHAIN_TTL_MS) {
      log.info(`[RUNTIME] チェーンTTL超過（${Math.floor(elapsed / 86400000)}日）→ lastResponseId null化`)
      s.participant.lastResponseId = null
      s.participant.lastResponseAt = null
    }
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

  // 起動時補正
  correctStateOnStartup(state)

  // 補正結果を即保存
  try {
    saveState(state)
  } catch (err) {
    report("COEXISTENCE_STATE_SAVE_FAILED",
      `state.json保存失敗: ${err instanceof Error ? err.message : String(err)}`)
  }

  initialized = true
  log.info(`[RUNTIME] 初期化完了 (fieldState: ${state.field.state}, lastResponseId: ${state.participant.lastResponseId ?? "なし"})`)
}

// --- 状態アクセスAPI（ipc-handlersから使用） ---

export function getState(): State {
  return state
}

export function getBeingPrompt(): string {
  return beingPrompt
}

// 場の状態を更新して永続化する
export function updateFieldState(newFieldState: string): void {
  state.field.state = newFieldState
  persistState()
}

// messageHistoryに追加して永続化する
export function appendMessage(msg: PersistedMessage): void {
  pushMessage(state.field.messageHistory, msg)
  persistState()
}

// 参与者のレスポンスIDを更新して永続化する
export function updateParticipantChain(responseId: string | null): void {
  state.participant.lastResponseId = responseId
  state.participant.lastResponseAt = responseId ? new Date().toISOString() : null
  persistState()
}

// terminated → 新規場にリセット（attach時に呼ばれる）
export function resetToNewField(): void {
  log.info("[RUNTIME] terminated → 新規場にリセット")
  state.field.state = "generated"
  state.field.messageHistory = []
  // 参与者側はリセットしない（接続契約: 参与者の意味資産は場の終了で消えない）
  // ただしterminatedは「場の正常終了」なので、チェーンもリセットする
  state.participant.lastResponseId = null
  state.participant.lastResponseAt = null
  persistState()
}

// state.jsonに保存する（エラー時は凍結報告）
function persistState(): void {
  try {
    saveState(state)
  } catch (err) {
    report("COEXISTENCE_STATE_SAVE_FAILED",
      `state.json保存失敗: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ストリームメッセージを処理する（stream.post → sendMessage → stream.reply）
export function processStream(text: string): Promise<SendMessageResult> {
  if (!initialized) throw new Error("FieldRuntime未初期化")

  return new Promise<SendMessageResult>((resolve, reject) => {
    enqueue(async () => {
      try {
        const result = await sendMessage(client, state, beingPrompt, text)
        // lastResponseIdはsendMessage内でstate.participant.lastResponseIdに更新済み
        updateParticipantChain(state.participant.lastResponseId)
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
        updateParticipantChain(state.participant.lastResponseId)
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
          updateParticipantChain(state.participant.lastResponseId)
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
  return state?.participant?.lastResponseId ?? null
}
