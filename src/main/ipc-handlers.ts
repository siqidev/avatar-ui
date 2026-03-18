import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import { streamPostSchema } from "../shared/ipc-schema.js"
import type { FieldState } from "../shared/ipc-schema.js"
import { transition, isActive } from "./field-fsm.js"
import {
  initRuntime,
  processStream,
  startPulse,
  startObservation,
  startXWebhook,
  getState,
  updateFieldState,
  resetToNewField,
  appendObservationEvent,
  appendXEvent,
} from "./field-runtime.js"
import { createConsoleProjection } from "./channel-projection.js"
import type { ChannelProjection } from "./channel-projection.js"
import { recordMessage } from "./message-recorder.js"
import { setAlertSink, isFrozen, report, warn } from "./integrity-manager.js"
import { initApprovalService, resolveApproval, cancelAllPending } from "./tool-approval-service.js"
import { toolApprovalRespondSchema } from "../shared/tool-approval-schema.js"
import { getConfig } from "../config.js"
import { t } from "../shared/i18n.js"
import type { ToolCallInfo } from "../services/chat-session-service.js"
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

// IPCハンドラを登録する
export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {

  // ChannelProjection: Console（Electron BrowserWindow）チャネルを生成
  const projection: ChannelProjection = createConsoleProjection(getMainWindow)

  // x_post/x_reply成功をXペインに転送
  function forwardXToolResults(toolCalls: ToolCallInfo[]): void {
    for (const tc of toolCalls) {
      if (tc.name !== "x_post" && tc.name !== "x_reply") continue
      try {
        const parsed = JSON.parse(tc.result) as Record<string, unknown>
        if (parsed.status !== "posted" && parsed.status !== "replied") continue
        const text = (tc.args.text as string) ?? ""
        const eventType = tc.name === "x_post" ? "post" : "reply"
        const timestamp = new Date().toISOString()
        const formatted = `[${eventType}] ${text}`
        projection.sendXEvent({
          eventType,
          payload: { tweet_id: parsed.tweet_id, text },
          formatted,
          timestamp,
        })
        appendXEvent({ eventType, formatted, timestamp })
      } catch { /* パース失敗は無視 */ }
    }
  }

  // IntegrityManager: alertSink登録（検知→投影経由でRenderer通知）
  setAlertSink((code, message) => {
    projection.sendIntegrityAlert(code, message)
  })

  // ツール承認サービス初期化
  initApprovalService(getMainWindow)

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

  // Pulse開始（Runtime初期化成功時のみ）
  if (runtimeReady) {
    startPulse(
      (result, correlationId) => {
        // Streamペインにコンテキスト行（Pulse発火）
        recordMessage("human", t("pulseCheck"), "pulse", "console")
        projection.sendStreamReply({
          actor: "human",
          correlationId,
          text: t("pulseCheck"),
          source: "pulse",
          channel: "console",
          toolCalls: [],
        })
        // AI応答
        recordMessage("ai", result.text, "pulse", "console", result.toolCalls)
        forwardXToolResults(result.toolCalls)
        projection.sendStreamReply({
          actor: "ai",
          correlationId,
          text: result.displayText,
          source: "pulse",
          channel: "console",
          toolCalls: result.toolCalls,
        })
      },
      () => isActive(fieldState),
    )

    // 観測サーバー起動（Roblox連携有効時のみ）
    startObservation(
      (event, formatted) => {
        const timestamp = new Date().toISOString()
        // Roblox Monitorペインへ（ペインの役割: Roblox世界の全入出力）
        projection.sendObservationEvent({
          eventType: event.type,
          payload: event.payload,
          formatted,
          timestamp,
        })
        // Monitor履歴に永続化
        appendObservationEvent({ eventType: event.type, formatted, timestamp })
        // roblox_log: Monitorのみ（会話履歴には不要）
        if (event.type === "roblox_log") return
        // 会話履歴に記録（AIの文脈維持に必要）
        recordMessage("human", formatted, "observation", "roblox")
      },
      (result, correlationId) => {
        recordMessage("ai", result.text, "observation", "roblox", result.toolCalls)
        projection.sendStreamReply({
          actor: "ai",
          correlationId,
          text: result.displayText,
          source: "observation",
          channel: "roblox",
          toolCalls: result.toolCalls,
        })
      },
      () => isActive(fieldState),
    )

    // X Webhookサーバー起動（X連携有効時のみ）
    startXWebhook(
      (event, formatted) => {
        const timestamp = new Date().toISOString()
        // Xペインへ
        projection.sendXEvent({
          eventType: event.type,
          payload: event as unknown as Record<string, unknown>,
          formatted,
          timestamp,
        })
        // Monitor履歴に永続化
        appendXEvent({ eventType: event.type, formatted, timestamp })
        // 会話履歴に記録
        recordMessage("human", formatted, "observation", "x")
      },
      (result, correlationId) => {
        recordMessage("ai", result.text, "observation", "x", result.toolCalls)
        forwardXToolResults(result.toolCalls)
        projection.sendStreamReply({
          actor: "ai",
          correlationId,
          text: result.displayText,
          source: "observation",
          channel: "x",
          toolCalls: result.toolCalls,
        })
      },
      () => isActive(fieldState),
    )
  }

  // channel.attach: ウィンドウ接続
  ipcMain.on("channel.attach", () => {
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
    cancelAllPending()
    safeDetach()
  })

  // stream.post: ストリームメッセージ受信
  ipcMain.on("stream.post", async (_event, raw: unknown) => {
    const result = streamPostSchema.safeParse(raw)
    if (!result.success) {
      log.error(`[IPC] stream.post バリデーション失敗: ${JSON.stringify(result.error.issues)}`)
      return
    }

    if (isFrozen()) {
      log.error("[IPC] stream.post拒否: 凍結中")
      return
    }

    if (!isActive(fieldState)) {
      log.error(`[IPC] stream.post拒否: 場が非アクティブ (${fieldState})`)
      return
    }

    const { text, correlationId, actor } = result.data
    recordMessage(actor, text, "user", "console")
    log.info(`[STREAM] ${actor}: ${text.substring(0, 80)}`)

    try {
      const streamResult = await processStream(text)
      recordMessage("ai", streamResult.text, "user", "console", streamResult.toolCalls)
      log.info(`[STREAM] ai: ${streamResult.text.substring(0, 80)}`)
      forwardXToolResults(streamResult.toolCalls)

      projection.sendStreamReply({
        actor: "ai",
        correlationId,
        text: streamResult.displayText,
        source: "user",
        channel: "console",
        toolCalls: streamResult.toolCalls,
      })
    } catch (err) {
      warn("RECIPROCITY_STREAM_ERROR",
        `Stream処理エラー: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // tool.approval.respond: ツール承認応答（Renderer→Main）
  ipcMain.handle("tool.approval.respond", (_event, raw: unknown) => {
    const parsed = toolApprovalRespondSchema.safeParse(raw)
    if (!parsed.success) {
      log.error(`[IPC] tool.approval.respond バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
      return { ok: false }
    }
    return resolveApproval(parsed.data.requestId, parsed.data.decision)
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
