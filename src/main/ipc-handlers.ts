import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import { streamPostSchema } from "../shared/ipc-schema.js"
import type { FieldState, Source, ToRendererMessage } from "../shared/ipc-schema.js"
import type { ToolCallInfo } from "../services/chat-session-service.js"
import { transition, isActive } from "./field-fsm.js"
import {
  initRuntime,
  processStream,
  startPulse,
  startObservation,
  getState,
  updateFieldState,
  appendMessage,
  resetToNewField,
} from "./field-runtime.js"
import { setAlertSink, isFrozen, report } from "./integrity-manager.js"
import { getConfig } from "../config.js"
import * as log from "../logger.js"

// 場の状態（モジュールスコープで保持、field-runtimeの永続化状態と同期）
let fieldState: FieldState = "generated"

// Rendererにメッセージを送る
function sendToRenderer(win: BrowserWindow | null, msg: ToRendererMessage): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send(msg.type, msg)
}

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

// --- メッセージ履歴の記録（永続化付き） ---
function recordMessage(
  actor: "human" | "ai",
  text: string,
  source?: Source,
  toolCalls?: ToolCallInfo[],
): void {
  appendMessage({
    actor,
    text,
    ...(source ? { source } : {}),
    ...(toolCalls?.length ? {
      toolCalls: toolCalls.map((tc) => ({
        name: tc.name,
        result: tc.result,
      })),
    } : {}),
  })
}

// IPCハンドラを登録する
export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {

  // IntegrityManager: alertSink登録（検知→Renderer通知）
  setAlertSink((code, message) => {
    const win = getMainWindow()
    sendToRenderer(win, {
      type: "integrity.alert",
      code,
      message: `${message}。再起動してください`,
    })
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

  // Pulse開始（Runtime初期化成功時のみ）
  if (runtimeReady) {
    startPulse(
      (result, correlationId) => {
        const win = getMainWindow()
        // Streamペインにコンテキスト行（Pulse発火）
        recordMessage("human", "定期確認", "pulse")
        sendToRenderer(win, {
          type: "stream.reply",
          actor: "human",
          correlationId,
          text: "定期確認",
          source: "pulse",
          toolCalls: [],
        })
        // AI応答
        recordMessage("ai", result.text, "pulse", result.toolCalls)
        sendToRenderer(win, {
          type: "stream.reply",
          actor: "ai",
          correlationId,
          text: result.text,
          source: "pulse",
          toolCalls: result.toolCalls,
        })
      },
      () => isActive(fieldState),
    )

    // 観測サーバー起動（Roblox連携有効時のみ）
    startObservation(
      (event, formatted, correlationId) => {
        const win = getMainWindow()
        // Roblox Monitorペインへ
        sendToRenderer(win, {
          type: "observation.event",
          eventType: event.type,
          payload: event.payload,
          formatted,
          timestamp: new Date().toISOString(),
        })
        // Streamペインにも観測入力をコンテキスト表示
        recordMessage("human", formatted, "observation")
        sendToRenderer(win, {
          type: "stream.reply",
          actor: "human",
          correlationId,
          text: formatted,
          source: "observation",
          toolCalls: [],
        })
      },
      (result, correlationId) => {
        recordMessage("ai", result.text, "observation", result.toolCalls)
        const win = getMainWindow()
        sendToRenderer(win, {
          type: "stream.reply",
          actor: "ai",
          correlationId,
          text: result.text,
          source: "observation",
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

    // 場の状態 + 永続化された履歴をRendererに送信
    const win = getMainWindow()
    const config = getConfig()
    const restored = getState()
    const history = restored.field.messageHistory

    sendToRenderer(win, {
      type: "field.state",
      state: fieldState,
      avatarName: config.avatarName,
      userName: config.userName,
      ...(history.length > 0 ? { lastMessages: history.map((m) => ({
        actor: m.actor,
        text: m.text,
        correlationId: "restored",
        source: m.source,
        toolCalls: m.toolCalls?.map((tc) => ({
          name: tc.name,
          args: {} as Record<string, unknown>,
          result: tc.result,
        })),
      })) } : {}),
    })
  })

  // channel.detach: ウィンドウ切断
  ipcMain.on("channel.detach", () => {
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
    recordMessage(actor, text)
    log.info(`[STREAM] ${actor}: ${text.substring(0, 80)}`)

    try {
      const streamResult = await processStream(text)
      recordMessage("ai", streamResult.text, "user", streamResult.toolCalls)
      log.info(`[STREAM] ai: ${streamResult.text.substring(0, 80)}`)

      const win = getMainWindow()
      sendToRenderer(win, {
        type: "stream.reply",
        actor: "ai",
        correlationId,
        text: streamResult.text,
        source: "user",
        toolCalls: streamResult.toolCalls,
      })
    } catch (err) {
      report("RECIPROCITY_STREAM_ERROR",
        `Stream処理エラー: ${err instanceof Error ? err.message : String(err)}`)
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
