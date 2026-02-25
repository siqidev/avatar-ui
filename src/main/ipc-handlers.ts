import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import { chatPostSchema } from "../shared/ipc-schema.js"
import type { FieldState, Source, ToRendererMessage } from "../shared/ipc-schema.js"
import type { ToolCallInfo } from "../services/chat-session-service.js"
import { transition, initialState, isActive } from "./field-fsm.js"
import { initRuntime, processChat, startPulse, startObservation } from "./field-runtime.js"
import * as log from "../logger.js"

// 場の状態（モジュールスコープで保持）
let fieldState: FieldState = initialState()

// メッセージ履歴（再接続時の再同期用、直近20件保持）
type HistoryEntry = {
  actor: "human" | "ai"
  text: string
  correlationId: string
  source?: Source
  toolCalls?: ToolCallInfo[]
}
const messageHistory: HistoryEntry[] = []
const MAX_HISTORY = 20

function pushHistory(
  actor: "human" | "ai",
  text: string,
  correlationId: string,
  source?: Source,
  toolCalls?: ToolCallInfo[],
): void {
  messageHistory.push({ actor, text, correlationId, source, toolCalls })
  if (messageHistory.length > MAX_HISTORY) messageHistory.shift()
}

// Rendererにメッセージを送る
function sendToRenderer(win: BrowserWindow | null, msg: ToRendererMessage): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send(msg.type, msg)
}

// 場の状態を取得する（外部参照用）
export function getFieldState(): FieldState {
  return fieldState
}

// IPCハンドラを登録する
export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {

  // FieldRuntime初期化
  let runtimeReady = false
  try {
    initRuntime()
    runtimeReady = true
  } catch (err) {
    log.error(`[RUNTIME] 初期化失敗: ${err instanceof Error ? err.message : err}`)
  }

  // Pulse開始（Runtime初期化成功時のみ）
  if (runtimeReady) {
    startPulse(
      (result, correlationId) => {
        const win = getMainWindow()
        // Chatペインにコンテキスト行（Pulse発火）
        pushHistory("human", "定期確認", correlationId, "pulse")
        sendToRenderer(win, {
          type: "chat.reply",
          actor: "human",
          correlationId,
          text: "定期確認",
          source: "pulse",
          toolCalls: [],
        })
        // AI応答
        pushHistory("ai", result.text, correlationId, "pulse", result.toolCalls)
        sendToRenderer(win, {
          type: "chat.reply",
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
        // Chatペインにも観測入力をコンテキスト表示
        pushHistory("human", formatted, correlationId, "observation")
        sendToRenderer(win, {
          type: "chat.reply",
          actor: "human",
          correlationId,
          text: formatted,
          source: "observation",
          toolCalls: [],
        })
      },
      (result, correlationId) => {
        pushHistory("ai", result.text, correlationId, "observation", result.toolCalls)
        const win = getMainWindow()
        sendToRenderer(win, {
          type: "chat.reply",
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
    try {
      fieldState = transition(fieldState, "attach")
      log.info(`[FSM] ${fieldState} (attach)`)
      // resumed は一時状態: ログ記録後に active へ自動遷移
      if (fieldState === "resumed") {
        fieldState = "active"
        log.info(`[FSM] ${fieldState} (resumed→active)`)
      }
    } catch (err) {
      log.error(`[FSM] attach失敗: ${err instanceof Error ? err.message : err}`)
      return
    }
    // 場の状態 + 直近メッセージ履歴をRendererに送信
    const win = getMainWindow()
    sendToRenderer(win, {
      type: "field.state",
      state: fieldState,
      ...(messageHistory.length > 0 ? { lastMessages: [...messageHistory] } : {}),
    })
  })

  // channel.detach: ウィンドウ切断
  ipcMain.on("channel.detach", () => {
    try {
      fieldState = transition(fieldState, "detach")
      log.info(`[FSM] ${fieldState} (detach)`)
    } catch (err) {
      log.error(`[FSM] detach失敗: ${err instanceof Error ? err.message : err}`)
    }
  })

  // chat.post: チャットメッセージ受信
  ipcMain.on("chat.post", async (_event, raw: unknown) => {
    const result = chatPostSchema.safeParse(raw)
    if (!result.success) {
      log.error(`[IPC] chat.post バリデーション失敗: ${JSON.stringify(result.error.issues)}`)
      return
    }

    if (!isActive(fieldState)) {
      log.error(`[IPC] chat.post拒否: 場が非アクティブ (${fieldState})`)
      return
    }

    const { text, correlationId, actor } = result.data
    pushHistory(actor, text, correlationId)
    log.info(`[CHAT] ${actor}: ${text.substring(0, 80)}`)

    try {
      const chatResult = await processChat(text)
      pushHistory("ai", chatResult.text, correlationId, "user", chatResult.toolCalls)
      log.info(`[CHAT] ai: ${chatResult.text.substring(0, 80)}`)

      const win = getMainWindow()
      sendToRenderer(win, {
        type: "chat.reply",
        actor: "ai",
        correlationId,
        text: chatResult.text,
        source: "user",
        toolCalls: chatResult.toolCalls,
      })
    } catch (err) {
      log.error(`[CHAT] エラー: ${err instanceof Error ? err.message : err}`)
      const win = getMainWindow()
      sendToRenderer(win, {
        type: "integrity.alert",
        code: "CHAT_ERROR",
        message: err instanceof Error ? err.message : "不明なエラー",
      })
    }
  })

  // field.terminate: 場の終了
  ipcMain.on("field.terminate", () => {
    try {
      fieldState = transition(fieldState, "terminate")
      log.info(`[FSM] ${fieldState} (terminate)`)
    } catch (err) {
      log.error(`[FSM] terminate失敗: ${err instanceof Error ? err.message : err}`)
    }
  })
}
