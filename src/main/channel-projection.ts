// ChannelProjection: Rendererへの投影（IPC残置分のみ）
// session系イベント（stream, monitor, approval）はWebSocket経由に移行済み
// IPC残置: integrity.alert（Console固有のシステムアラート）

import type { BrowserWindow } from "electron"
import type { ToRendererMessage, AlertCode } from "../shared/ipc-schema.js"

// --- 型定義 ---

export type ChannelProjection = {
  sendIntegrityAlert(code: AlertCode, message: string): void
}

// --- Console チャネル実装（Electron BrowserWindow） ---

export function createConsoleProjection(
  getMainWindow: () => BrowserWindow | null,
): ChannelProjection {
  function send(msg: ToRendererMessage): void {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(msg.type, msg)
  }

  return {
    sendIntegrityAlert(code, message) {
      send({
        type: "integrity.alert",
        code,
        message: `${message}。再起動してください`,
      })
    },
  }
}
