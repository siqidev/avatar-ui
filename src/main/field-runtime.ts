import OpenAI from "openai"
import * as http from "node:http"
import * as fs from "node:fs"
import cron from "node-cron"
import { getConfig, isRobloxEnabled, isXEnabled } from "../config.js"
import { getSettings } from "./settings-store.js"
import type { AppConfig } from "../config.js"
import { loadState, saveState, pushMessage, pushMonitorEvent } from "../state/state-repository.js"
import type { State, PersistedMessage, PersistedMonitorEvent } from "../state/state-repository.js"
import { sendMessage } from "../services/chat-session-service.js"
import type { SendMessageResult } from "../services/chat-session-service.js"
import { startObservationServer } from "../roblox/observation-server.js"
import type { ObservationEvent } from "../roblox/observation-server.js"
import { formatObservation } from "../roblox/observation-formatter.js"
import { shouldForwardToAI } from "../roblox/observation-forwarding-policy.js"
import { endSuppression as endMotionSuppression, isProximitySuppressed } from "../roblox/motion-state.js"
import { startXWebhookServer } from "../x/x-webhook-server.js"
import type { XEvent } from "../x/x-event-formatter.js"
import { formatXEvent, formatXEventForAI } from "../x/x-event-formatter.js"
import { shouldForwardXEventToAI } from "../x/x-forwarding-policy.js"
import { generateCorrelationId } from "../shared/participation-context.js"
import { report, warn, isFrozen } from "./integrity-manager.js"
import { t } from "../shared/i18n.js"
import * as log from "../logger.js"

// FieldRuntime: 場のロジックを統合する（Electron Main向け）

let client: OpenAI
let config: AppConfig
let state: State
let beingPrompt: string
let initialized = false

// チェーンTTL（30日）
const CHAIN_TTL_MS = 30 * 24 * 60 * 60 * 1000

// 直列キュー（同時にsendMessageを呼ばないようにする）
// 凍結中はジョブをスキップ（検知後の安全側停止）
// onSkip: 凍結スキップ時に呼ばれるコールバック（processStreamのPromise未解決防止用）
let queue: Promise<void> = Promise.resolve()
function enqueue(fn: () => Promise<void>, onSkip?: () => void): Promise<void> {
  queue = queue.then(() => {
    if (isFrozen()) {
      log.info("[RUNTIME] 凍結中 — ジョブスキップ")
      onSkip?.()
      return
    }
    return fn()
  }, () => {
    if (isFrozen()) {
      log.info("[RUNTIME] 凍結中 — ジョブスキップ")
      onSkip?.()
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

  // state.json読み込み（破損時は.prevフォールバック → warn続行）
  const loadResult = loadState()
  state = loadResult.state
  if (loadResult.recoveredFromPrev) {
    warn("COEXISTENCE_STATE_LOAD_CORRUPTED",
      "state.json破損を検知しました。直前の保存状態から復帰しました")
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

// observationHistoryに追加して永続化する
export function appendObservationEvent(event: PersistedMonitorEvent): void {
  pushMonitorEvent(state.field.observationHistory, event)
  persistState()
}

// xEventHistoryに追加して永続化する
export function appendXEvent(event: PersistedMonitorEvent): void {
  pushMonitorEvent(state.field.xEventHistory, event)
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
  state.field.observationHistory = []
  state.field.xEventHistory = []
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
export function processStream(text: string, source: import("../shared/ipc-schema.js").Source = "user", channel: import("../shared/channel.js").ChannelId = "console"): Promise<SendMessageResult> {
  if (!initialized) throw new Error("FieldRuntime未初期化")

  return new Promise<SendMessageResult>((resolve, reject) => {
    enqueue(async () => {
      try {
        const result = await sendMessage(client, state, beingPrompt, text, false, source, channel)
        // lastResponseIdはsendMessage内でstate.participant.lastResponseIdに更新済み
        updateParticipantChain(state.participant.lastResponseId)
        resolve(result)
      } catch (err) {
        reject(err)
      }
    }, () => reject(new Error("凍結中 — ジョブスキップ")))
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
        const pulseInput = `${pulseContent}\n\n${config.pulseOkPrefix}と返答すれば対応不要を意味する。`
        const result = await sendMessage(
          client,
          state,
          beingPrompt,
          pulseInput,
          true, // forceSystemPrompt
          "pulse",
          "console",
        )
        updateParticipantChain(state.participant.lastResponseId)
        if (!result.text.startsWith(config.pulseOkPrefix)) {
          log.info(`[PULSE] 応答: ${result.text.substring(0, 100)}`)
          onReply(result, correlationId)
        } else {
          log.info("[PULSE] 対応不要")
        }
      } catch (err) {
        warn("RECIPROCITY_PULSE_ERROR",
          `Pulse処理エラー: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  })

  log.info(`[PULSE] cron開始: ${config.pulseCron}`)
}

// xpulse.mdを読み込む
function loadXpulse(): string | null {
  try {
    const content = fs.readFileSync(getConfig().xpulseFile, "utf-8").trim()
    return content || null
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }
    throw err
  }
}

// XPulseを開始する（X投稿用の定期Pulse）
export function startXpulse(
  onReply: (result: SendMessageResult, correlationId: string) => void,
  isFieldActive: () => boolean,
): void {
  if (!initialized) throw new Error("FieldRuntime未初期化")
  if (!isXEnabled(config)) {
    log.info("[XPULSE] X連携無効 — XPulse起動スキップ")
    return
  }

  cron.schedule(config.xpulseCron, () => {
    if (!isFieldActive()) {
      log.info("[XPULSE] 場が非アクティブ — スキップ")
      return
    }

    const xpulseContent = loadXpulse()
    if (!xpulseContent) return

    const correlationId = generateCorrelationId("xpulse")
    log.info(`[XPULSE] 発火 (${correlationId})`)
    enqueue(async () => {
      try {
        const xpulseInput = `${xpulseContent}\n\n${config.xpulseOkPrefix}と返答すれば対応不要を意味する。`
        const result = await sendMessage(
          client,
          state,
          beingPrompt,
          xpulseInput,
          true, // forceSystemPrompt
          "xpulse",
          "x",
        )
        updateParticipantChain(state.participant.lastResponseId)
        if (!result.text.startsWith(config.xpulseOkPrefix)) {
          log.info(`[XPULSE] 応答: ${result.text.substring(0, 100)}`)
          onReply(result, correlationId)
        } else {
          log.info("[XPULSE] 対応不要")
        }
      } catch (err) {
        warn("RECIPROCITY_PULSE_ERROR",
          `XPulse処理エラー: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  })

  log.info(`[XPULSE] cron開始: ${config.xpulseCron}`)
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
      const correlationId = generateCorrelationId("observation")
      const formatted = formatObservation(event, config.robloxOwnerDisplayName)
      const shouldForward = shouldForwardToAI(event)

      // roblox_log: Monitorに表示、AIには送らない
      if (event.type === "roblox_log") {
        log.info(`[ROBLOX] ${formatted}`)
        onEvent(event, formatted, correlationId)
        return
      }

      // Monitorに全観測を表示（ペインの役割: Roblox世界の全入出力）
      onEvent(event, formatted, correlationId)

      // 移動完了検知: 自己起因proximity抑制を解除
      // ACK/stoppedが来たら、以降のproximityは「新規の観測」として扱う
      if (event.type === "command_ack") {
        const p = event.payload as Record<string, unknown>
        if (p.op === "go_to_player" || p.op === "follow_player") {
          endMotionSuppression()
        }
      } else if (event.type === "npc_follow_event") {
        const p = event.payload as Record<string, unknown>
        if (p.state === "stopped" || p.state === "lost") {
          endMotionSuppression()
        }
      }

      // AI転送ポリシー: 異常対応に必要な信号のみAIに送る
      if (!shouldForward) {
        log.info(`[OBSERVATION] AI転送スキップ: ${event.type} ${formatted.substring(0, 80)}`)
        return
      }

      // 自己起因proximity抑制: npc_motion実行中のplayer_proximityをスキップ
      if (event.type === "player_proximity" && isProximitySuppressed()) {
        log.info(`[OBSERVATION] 移動中proximity抑制: ${formatted.substring(0, 80)}`)
        return
      }

      // 共振ゲート: off時は注意+表出を停止（知覚は常時ON）
      if (!getSettings().resonance) {
        log.info(`[OBSERVATION] 共振OFF — AI転送スキップ: ${event.type}`)
        return
      }

      if (!isFieldActive()) {
        log.info("[OBSERVATION] 場が非アクティブ — スキップ")
        return
      }

      enqueue(async () => {
        try {
          // 観測プレフィックス: AIが「これは観測情報であり、ユーザーの命令ではない」と認識できる
          const aiInput = t("obs.aiPrefix", event.type, formatted)
          log.info(`[OBSERVATION→AI] (${correlationId}) ${formatted}`)
          const result = await sendMessage(client, state, beingPrompt, aiInput, false, "observation", "roblox")
          updateParticipantChain(state.participant.lastResponseId)
          log.info(`[AI→OBSERVATION] (${correlationId}) ${result.text.substring(0, 100)}`)
          onReply(result, correlationId)
        } catch (err) {
          warn("RECIPROCITY_OBSERVATION_ERROR",
            `観測AI応答エラー: ${err instanceof Error ? err.message : String(err)}`)
        }
      })
    },
    config.robloxObservationSecret,
  )

  log.info("[OBSERVATION] 観測サーバー起動")
}

// X Webhookサーバーを起動する（X連携有効時のみ）
let xWebhookServer: http.Server | null = null

export function startXWebhook(
  onEvent: (event: XEvent, formatted: string, correlationId: string) => void,
  onReply: (result: SendMessageResult, correlationId: string) => void,
  isFieldActive: () => boolean,
): void {
  if (!initialized) throw new Error("FieldRuntime未初期化")
  if (!isXEnabled(config)) {
    log.info("[X_WEBHOOK] X連携無効 — Webhookサーバー起動スキップ")
    return
  }

  xWebhookServer = startXWebhookServer(
    (event: XEvent) => {
      const correlationId = generateCorrelationId("observation")
      const formatted = formatXEvent(event)

      // Xペインに全イベントを表示
      onEvent(event, formatted, correlationId)

      // AI転送判定
      if (!shouldForwardXEventToAI(event)) {
        log.info(`[X_WEBHOOK] AI転送スキップ: ${event.type}`)
        return
      }

      // 共振ゲート
      if (!getSettings().resonance) {
        log.info(`[X_WEBHOOK] 共振OFF — AI転送スキップ: ${event.type}`)
        return
      }

      if (!isFieldActive()) {
        log.info("[X_WEBHOOK] 場が非アクティブ — スキップ")
        return
      }

      enqueue(async () => {
        try {
          const aiInput = formatXEventForAI(event)
          log.info(`[X→AI] (${correlationId}) ${formatted}`)
          const result = await sendMessage(client, state, beingPrompt, aiInput, false, "observation", "x")
          updateParticipantChain(state.participant.lastResponseId)
          log.info(`[AI→X] (${correlationId}) ${result.text.substring(0, 100)}`)
          onReply(result, correlationId)
        } catch (err) {
          warn("RECIPROCITY_OBSERVATION_ERROR",
            `X観測AI応答エラー: ${err instanceof Error ? err.message : String(err)}`)
        }
      })
    },
  )

  log.info("[X_WEBHOOK] Webhookサーバー起動")
}

// ランタイム停止（サーバーのクリーンアップ）
export function stopRuntime(): void {
  if (observationServer) {
    observationServer.close()
    observationServer = null
    log.info("[OBSERVATION] 観測サーバー停止")
  }
  if (xWebhookServer) {
    xWebhookServer.close()
    xWebhookServer = null
    log.info("[X_WEBHOOK] Webhookサーバー停止")
  }
}

// 現在のlastResponseIdを取得（会話継続性の確認用）
export function getLastResponseId(): string | null {
  return state?.participant?.lastResponseId ?? null
}

// モデル切替時にチェーンをリセットする（previous_response_idはモデル間で共有不可）
export function resetChainForModelSwitch(): void {
  if (!initialized) return // メニュー操作がruntime初期化前に起きた場合はno-op
  log.info("[RUNTIME] モデル変更 → チェーンリセット")
  state.participant.lastResponseId = null
  state.participant.lastResponseAt = null
  persistState()
}
