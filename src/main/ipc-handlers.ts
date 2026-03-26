import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import { streamPostSchema } from "../shared/ipc-schema.js"
import type { FieldState } from "../shared/ipc-schema.js"
import type { ChannelId } from "../shared/channel.js"
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
  appendMessage,
  emitStreamItem,
  publishXToolResults,
} from "./field-runtime.js"
import { createConsoleProjection } from "./channel-projection.js"
import type { ChannelProjection } from "./channel-projection.js"
import { subscribe } from "../runtime/session-event-bus.js"
import type { SessionEvent } from "../shared/session-event-schema.js"
import { setAlertSink, isFrozen, report, warn } from "./integrity-manager.js"
import { registerApprover, unregisterApprover, respond as hubRespond } from "../runtime/approval-hub.js"
import { toolApprovalRespondSchema } from "../shared/tool-approval-schema.js"
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
// WSサーバーの初回接続時配信 + Console attach時の投影に使用
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

  return {
    fieldState: fieldState as SessionStatePayload["fieldState"],
    settings: {
      avatarName: config.avatarName,
      userName: config.userName,
    },
    history: [...streamHistory, ...robloxHistory, ...xHistory],
  }
}

// stream.post共通処理（IPC/WS両方から呼ばれる）
export async function handleStreamPost(text: string, correlationId: string, actor: "human" | "ai"): Promise<void> {
  if (isFrozen()) {
    log.error("[STREAM] stream.post拒否: 凍結中")
    return
  }

  if (!isActive(fieldState)) {
    log.error(`[STREAM] stream.post拒否: 場が非アクティブ (${fieldState})`)
    return
  }

  appendMessage({ actor, text, source: "user", channel: "console" })
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

  // ChannelProjection: Console（Electron BrowserWindow）チャネルを生成
  const projection: ChannelProjection = createConsoleProjection(getMainWindow)

  // IntegrityManager: alertSink登録（検知→投影経由でRenderer通知）
  setAlertSink((code, message) => {
    projection.sendIntegrityAlert(code, message)
  })

  // Console承認者の登録解除関数（attach/detach時に管理）
  let unregisterConsoleApprover: (() => void) | null = null

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
    // Event Bus → ChannelProjection（Console）: イベント配信の購読
    subscribe((event: SessionEvent) => {
      switch (event.kind) {
        case "stream.item":
          projection.sendStreamReply({
            actor: event.payload.actor,
            correlationId: event.payload.correlationId,
            text: event.payload.text,
            source: event.payload.source,
            channel: event.payload.channel as ChannelId,
            toolCalls: event.payload.toolCalls ?? [],
          })
          break
        case "monitor.item":
          if (event.payload.channel === "roblox") {
            projection.sendObservationEvent({
              eventType: event.payload.eventType,
              payload: event.payload.payload ?? {},
              formatted: event.payload.formatted,
              timestamp: event.payload.timestamp,
            })
          } else if (event.payload.channel === "x") {
            projection.sendXEvent({
              eventType: event.payload.eventType,
              payload: event.payload.payload ?? {},
              formatted: event.payload.formatted,
              timestamp: event.payload.timestamp,
            })
          }
          break
      }
    })

    startPulse()
    startXpulse()
    startObservation()
    startXWebhook()
  }

  // channel.attach: ウィンドウ接続
  ipcMain.on("channel.attach", (event) => {
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
      return
    }

    // Console承認者を登録（既存があれば先に解除）
    unregisterConsoleApprover?.()
    const sender = event.sender
    unregisterConsoleApprover = registerApprover({
      approverId: `console:${sender.id}`,
      label: "Console GUI",
      sendRequest: (req) => {
        if (!sender.isDestroyed()) {
          sender.send("tool.approval.request", req)
        }
      },
    })

    // sender破棄時に自動解除
    sender.once("destroyed", () => {
      unregisterConsoleApprover?.()
      unregisterConsoleApprover = null
    })

    // 場の状態 + 永続化された履歴を投影
    const config = getConfig()
    const restored = getState()

    projection.sendFieldState({
      state: fieldState,
      avatarName: config.avatarName,
      userName: config.userName,
      history: restored.field.messageHistory,
      observationHistory: restored.field.observationHistory,
      xEventHistory: restored.field.xEventHistory,
    })
  })

  // channel.detach: ウィンドウ切断
  ipcMain.on("channel.detach", () => {
    // Console承認者を解除（他の承認者がいればpending継続）
    unregisterConsoleApprover?.()
    unregisterConsoleApprover = null
    safeDetach()
  })

  // stream.post: ストリームメッセージ受信
  ipcMain.on("stream.post", async (_event, raw: unknown) => {
    const result = streamPostSchema.safeParse(raw)
    if (!result.success) {
      log.error(`[IPC] stream.post バリデーション失敗: ${JSON.stringify(result.error.issues)}`)
      return
    }
    const { text, correlationId, actor } = result.data
    await handleStreamPost(text, correlationId, actor)
  })

  // tool.approval.respond: ツール承認応答（Renderer→Main）
  ipcMain.handle("tool.approval.respond", (_event, raw: unknown) => {
    const parsed = toolApprovalRespondSchema.safeParse(raw)
    if (!parsed.success) {
      log.error(`[IPC] tool.approval.respond バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
      return { ok: false, reason: "VALIDATION_ERROR" }
    }
    return hubRespond(parsed.data.requestId, parsed.data.decision)
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
