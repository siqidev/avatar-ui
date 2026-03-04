// Terminal IPC — Zodバリデーション + service呼び出し

import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import {
  TERMINAL_CHANNELS,
  terminalExecSchema,
  terminalStdinSchema,
  terminalStopSchema,
  terminalResizeSchema,
} from "../shared/terminal-schema.js"
import type { TerminalToRendererEvent } from "../shared/terminal-schema.js"
import * as service from "./terminal-service.js"
import * as log from "../logger.js"

/** Terminal IPC ハンドラを登録する */
export function registerTerminalIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  // イベントシンク: Main→Renderer転送
  service.setEventSink((event: TerminalToRendererEvent) => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(event.type, event)
  })

  // terminal.exec
  ipcMain.handle(TERMINAL_CHANNELS.exec, (_event, raw: unknown) => {
    const parsed = terminalExecSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`terminal.exec バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
    }
    log.info(`[IPC] terminal.exec: ${parsed.data.cmd.substring(0, 80)}`)
    return service.execCommand(parsed.data)
  })

  // terminal.stdin
  ipcMain.handle(TERMINAL_CHANNELS.stdin, (_event, raw: unknown) => {
    const parsed = terminalStdinSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`terminal.stdin バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
    }
    return service.writeStdin(parsed.data)
  })

  // terminal.stop
  ipcMain.handle(TERMINAL_CHANNELS.stop, (_event, raw: unknown) => {
    const parsed = terminalStopSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`terminal.stop バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
    }
    log.info(`[IPC] terminal.stop: ${parsed.data.actor}`)
    return service.stopCommand(parsed.data)
  })

  // terminal.resize（将来PTY昇格時に有効化）
  ipcMain.handle(TERMINAL_CHANNELS.resize, (_event, raw: unknown) => {
    const parsed = terminalResizeSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`terminal.resize バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
    }
    // child_process段階ではリサイズは不要（PTY昇格時に実装）
    return { ok: true }
  })

  // terminal.snapshot
  ipcMain.handle(TERMINAL_CHANNELS.snapshot, () => {
    return service.getSnapshot()
  })
}
