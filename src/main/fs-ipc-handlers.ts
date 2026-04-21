import { ipcMain } from "electron"
import { FS_CHANNELS } from "../shared/fs-schema.js"
import { dispatchFsRequest } from "../runtime/fs-request-handler.js"
import * as log from "../logger.js"

/** FS系IPCハンドラを登録する。dispatcher経由でWS側と実装を共有する */
export function registerFsIpcHandlers(): void {
  ipcMain.handle("fs.rootName", () => dispatchFsRequest("fs.rootName", undefined))

  ipcMain.handle(FS_CHANNELS.list, async (_event, raw: unknown) => {
    log.info(`[FS] list: ${(raw as { path?: string })?.path ?? "?"}`)
    return dispatchFsRequest("fs.list", raw)
  })

  ipcMain.handle(FS_CHANNELS.read, async (_event, raw: unknown) => {
    log.info(`[FS] read: ${(raw as { path?: string })?.path ?? "?"}`)
    return dispatchFsRequest("fs.read", raw)
  })

  ipcMain.handle(FS_CHANNELS.write, async (_event, raw: unknown) => {
    log.info(`[FS] write: ${(raw as { path?: string })?.path ?? "?"}`)
    return dispatchFsRequest("fs.write", raw)
  })

  ipcMain.handle(FS_CHANNELS.importFile, async (_event, raw: unknown) => {
    const r = raw as { sourcePath?: string; destPath?: string }
    log.info(`[FS] importFile: ${r?.sourcePath ?? "?"} -> ${r?.destPath ?? "?"}`)
    return dispatchFsRequest("fs.importFile", raw)
  })

  ipcMain.handle(FS_CHANNELS.mutate, async (_event, raw: unknown) => {
    const r = raw as { op?: string; path?: string }
    log.info(`[FS] mutate(${r?.op ?? "?"}): ${r?.path ?? "?"}`)
    return dispatchFsRequest("fs.mutate", raw)
  })
}
