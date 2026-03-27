import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import type { FieldState } from "../shared/ipc-schema.js"
import type { SessionStatePayload, HistoryItem } from "../shared/session-event-schema.js"
import { transition, isActive } from "./field-fsm.js"
import {
  initRuntime,
  processStream,
  startPulse,
  startXpulse,
  startObservation,
  startXWebhook,
  getState,
  updateFieldState,
  resetToNewField,
  emitStreamItem,
  publishXToolResults,
} from "./field-runtime.js"
import { createConsoleProjection } from "./channel-projection.js"
import type { ChannelProjection } from "./channel-projection.js"
import { setAlertSink, isFrozen, report, warn } from "./integrity-manager.js"
import { getPendingRequests } from "../runtime/approval-hub.js"
import { getConfig } from "../config.js"
import * as log from "../logger.js"

// 場の状態（モジュールスコープで保持、field-runtimeの永続化状態と同期）
let fieldState: FieldState = "generated"

// 場の状態を取得する（外部参照用）
export function getFieldState(): FieldState {
  return fieldState
}

// --- safeDetach: 冪等なdetach処理（複数箇所から安全に呼べる） ---
export function safeDetach(): void {
  // ガード: active/resumed以外はno-op
  if (fieldState !== "active" && fieldState !== "resumed") return

  try {
    fieldState = transition(fieldState, "detach")
    log.info(`[FSM] ${fieldState} (detach)`)
    updateFieldState(fieldState)
  } catch (err) {
    // 想定外（ガードを通過したのに遷移失敗）
    report("FIELD_CONTRACT_VIOLATION",
      `safeDetach失敗: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// 場の状態スナップショット（SessionStatePayload形式）を返す
// WSサーバーの初回接続時配信に使用
export function getStateSnapshot(): SessionStatePayload {
  const config = getConfig()
  const restored = getState()

  // PersistedMessage → HistoryItem(stream)
  const streamHistory: HistoryItem[] = restored.field.messageHistory.map((m) => ({
    type: "stream" as const,
    actor: m.actor,
    text: m.text,
    ...(m.source ? { source: m.source } : {}),
    ...(m.channel ? { channel: m.channel } : {}),
    ...(m.toolCalls ? { toolCalls: m.toolCalls.map((tc) => ({ name: tc.name, args: tc.args ?? {}, result: tc.result })) } : {}),
  }))

  // PersistedMonitorEvent → HistoryItem(monitor)
  const robloxHistory: HistoryItem[] = restored.field.observationHistory.map((e) => ({
    type: "monitor" as const,
    channel: "roblox" as const,
    eventType: e.eventType,
    formatted: e.formatted,
    timestamp: e.timestamp,
  }))

  const xHistory: HistoryItem[] = restored.field.xEventHistory.map((e) => ({
    type: "monitor" as const,
    channel: "x" as const,
    eventType: e.eventType,
    formatted: e.formatted,
    timestamp: e.timestamp,
  }))

  // pending承認リクエストを含める
  const pendingApprovals = getPendingRequests().map((e) => ({
    requestId: e.requestId,
    toolName: e.toolName,
    args: e.args,
    requestedAt: e.requestedAt,
  }))

  return {
    fieldState: fieldState as SessionStatePayload["fieldState"],
    settings: {
      avatarName: config.avatarName,
      userName: config.userName,
    },
    history: [...streamHistory, ...robloxHistory, ...xHistory],
    pendingApprovals,
  }
}

// stream.post共通処理（WS経由で呼ばれる）
export async function handleStreamPost(text: string, correlationId: string, actor: "human" | "ai"): Promise<void> {
  if (isFrozen()) {
    log.error("[STREAM] stream.post拒否: 凍結中")
    return
  }

  if (!isActive(fieldState)) {
    log.error(`[STREAM] stream.post拒否: 場が非アクティブ (${fieldState})`)
    return
  }

  // human発話をevent busに発行（永続化+publish）
  emitStreamItem(actor, text, correlationId, "user", "console")
  log.info(`[STREAM] ${actor}: ${text.substring(0, 80)}`)

  try {
    const streamResult = await processStream(text)
    log.info(`[STREAM] ai: ${streamResult.text.substring(0, 80)}`)
    emitStreamItem("ai", streamResult.text, correlationId, "user", "console", streamResult.toolCalls, streamResult.displayText)
    publishXToolResults(streamResult.toolCalls)
  } catch (err) {
    warn("RECIPROCITY_STREAM_ERROR",
      `Stream処理エラー: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// IPCハンドラを登録する
export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {

  // ChannelProjection: integrity.alertのみ使用（session系はWS経由に移行済み）
  const projection: ChannelProjection = createConsoleProjection(getMainWindow)

  // IntegrityManager: alertSink登録（検知→投影経由でRenderer通知）
  setAlertSink((code, message) => {
    projection.sendIntegrityAlert(code, message)
  })

  // FieldRuntime初期化
  let runtimeReady = false
  try {
    initRuntime()
    runtimeReady = true

    // 永続化された場状態を復元
    const restored = getState()
    fieldState = restored.field.state as FieldState
    log.info(`[IPC] 永続化状態を復元: fieldState=${fieldState}, history=${restored.field.messageHistory.length}件`)
  } catch (err) {
    log.error(`[RUNTIME] 初期化失敗: ${err instanceof Error ? err.message : err}`)
  }

  // Pulse/Observation開始（Runtime初期化成功時のみ）
  if (runtimeReady) {
    startPulse()
    startXpulse()
    startObservation()
    startXWebhook()
  }

  // channel.attach: ウィンドウ接続（FSM遷移のみ。セッションデータはWS経由で配信）
  ipcMain.handle("channel.attach", () => {
    // terminated → 新規場にリセット（接続契約: 旧場は終了済み）
    if (fieldState === "terminated") {
      resetToNewField()
      fieldState = "generated"
    }

    try {
      fieldState = transition(fieldState, "attach")
      log.info(`[FSM] ${fieldState} (attach)`)
      // resumed は一時状態: ログ記録後に active へ自動遷移
      if (fieldState === "resumed") {
        fieldState = "active"
        log.info(`[FSM] ${fieldState} (resumed→active)`)
      }
      updateFieldState(fieldState)
    } catch (err) {
      report("FIELD_CONTRACT_VIOLATION",
        `attach失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // channel.detach: ウィンドウ切断
  ipcMain.on("channel.detach", () => {
    safeDetach()
  })

  // session.ws.config: WS接続情報を返す
  ipcMain.handle("session.ws.config", () => {
    const config = getConfig()
    return {
      port: config.sessionWsPort,
      token: config.sessionWsToken,
    }
  })

  // field.terminate: 場の終了
  ipcMain.on("field.terminate", () => {
    try {
      fieldState = transition(fieldState, "terminate")
      log.info(`[FSM] ${fieldState} (terminate)`)
      updateFieldState(fieldState)
    } catch (err) {
      report("FIELD_CONTRACT_VIOLATION",
        `terminate失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
}
