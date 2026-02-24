import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import { chatPostSchema } from "../shared/ipc-schema.js"
import type { FieldState, ToRendererMessage } from "../shared/ipc-schema.js"
import { transition, initialState, isActive } from "./field-fsm.js"
import { initRuntime, processChat, startPulse } from "./field-runtime.js"
import * as log from "../logger.js"

// 場の状態（モジュールスコープで保持）
let fieldState: FieldState = initialState()

// メッセージ履歴（再接続時の再同期用、直近20件保持）
const messageHistory: Array<{ actor: "human" | "ai"; text: string; correlationId: string }> = []
const MAX_HISTORY = 20

function pushHistory(actor: "human" | "ai", text: string, correlationId: string): void {
  messageHistory.push({ actor, text, correlationId })
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
    startPulse((text) => {
      const correlationId = `pulse-${Date.now()}`
      pushHistory("ai", text, correlationId)
      const win = getMainWindow()
      sendToRenderer(win, {
        type: "chat.reply",
        actor: "ai",
        correlationId,
        text,
      })
    })
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
      const reply = await processChat(text)
      pushHistory("ai", reply, correlationId)
      log.info(`[CHAT] ai: ${reply.substring(0, 80)}`)

      const win = getMainWindow()
      sendToRenderer(win, {
        type: "chat.reply",
        actor: "ai",
        correlationId,
        text: reply,
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
