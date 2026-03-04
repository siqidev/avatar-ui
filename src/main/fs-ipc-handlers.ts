import { ipcMain } from "electron"
import {
  FS_CHANNELS,
  fsListArgsSchema,
  fsReadArgsSchema,
  fsWriteArgsSchema,
  fsMutateArgsSchema,
} from "../shared/fs-schema.js"
import { fsList, fsRead, fsWrite, fsMutate, fsRootName } from "./filesystem-service.js"
import * as log from "../logger.js"

/** FS系IPCハンドラを登録する */
export function registerFsIpcHandlers(): void {
  ipcMain.handle("fs.rootName", () => fsRootName())

  ipcMain.handle(FS_CHANNELS.list, async (_event, raw: unknown) => {
    const parsed = fsListArgsSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`fs.list バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
    }
    log.info(`[FS] list: ${parsed.data.path}`)
    return fsList(parsed.data)
  })

  ipcMain.handle(FS_CHANNELS.read, async (_event, raw: unknown) => {
    const parsed = fsReadArgsSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`fs.read バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
    }
    log.info(`[FS] read: ${parsed.data.path}`)
    return fsRead(parsed.data)
  })

  ipcMain.handle(FS_CHANNELS.write, async (_event, raw: unknown) => {
    const parsed = fsWriteArgsSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`fs.write バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
    }
    log.info(`[FS] write: ${parsed.data.path}`)
    return fsWrite(parsed.data)
  })

  ipcMain.handle(FS_CHANNELS.mutate, async (_event, raw: unknown) => {
    const parsed = fsMutateArgsSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`fs.mutate バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
    }
    log.info(`[FS] mutate(${parsed.data.op}): ${parsed.data.path}`)
    return fsMutate(parsed.data)
  })
}
