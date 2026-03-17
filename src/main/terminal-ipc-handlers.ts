// Terminal IPC — Zodバリデーション + service呼び出し

import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import {
  TERMINAL_CHANNELS,
  terminalInputSchema,
  terminalResizeSchema,
} from "../shared/terminal-schema.js"
import type { TerminalToRendererEvent } from "../shared/terminal-schema.js"
import * as service from "./terminal-service.js"

/** Terminal IPC ハンドラを登録する */
export function registerTerminalIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  // イベントシンク: Main→Renderer転送
  service.setEventSink((event: TerminalToRendererEvent) => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(event.type, event)
  })

  // terminal.input（人間の生入力 → PTY）
  ipcMain.handle(TERMINAL_CHANNELS.input, (_event, raw: unknown) => {
    const parsed = terminalInputSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`terminal.input バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
    }
    service.write(parsed.data.data)
    return { ok: true }
  })

  // terminal.resize
  ipcMain.handle(TERMINAL_CHANNELS.resize, (_event, raw: unknown) => {
    const parsed = terminalResizeSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`terminal.resize バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
    }
    service.resize(parsed.data.cols, parsed.data.rows)
    return { ok: true }
  })

  // terminal.snapshot
  ipcMain.handle(TERMINAL_CHANNELS.snapshot, () => {
    return service.getSnapshot()
  })
}
