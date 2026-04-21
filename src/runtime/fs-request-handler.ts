// FS dispatcher: IPC（Electron）/WS（ブラウザ）から共通で呼ばれる薄い分岐
// 設計: throw型（既存IPC契約を維持）。WS側は呼び出し元で try/catch して fs.response エンベロープに変換する

import {
  fsListArgsSchema,
  fsReadArgsSchema,
  fsWriteArgsSchema,
  fsImportFileArgsSchema,
  fsMutateArgsSchema,
} from "../shared/fs-schema.js"
import {
  fsRootName,
  fsList,
  fsRead,
  fsWrite,
  fsImportFile,
  fsMutate,
} from "./filesystem-service.js"

// dispatcher が扱う全FSメソッド（Electron用にfs.importFileも含む）
export type FsDispatchMethod =
  | "fs.rootName"
  | "fs.list"
  | "fs.read"
  | "fs.write"
  | "fs.mutate"
  | "fs.importFile"

export class FsRequestError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "FsRequestError"
    this.code = code
  }
}

/** FSリクエストを分岐実行する。バリデーション失敗・実行失敗いずれもthrow */
export async function dispatchFsRequest(method: FsDispatchMethod, args: unknown): Promise<unknown> {
  switch (method) {
    case "fs.rootName":
      return fsRootName()
    case "fs.list": {
      const parsed = fsListArgsSchema.safeParse(args)
      if (!parsed.success) {
        throw new FsRequestError("BAD_ARGS", `fs.list バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
      }
      return fsList(parsed.data)
    }
    case "fs.read": {
      const parsed = fsReadArgsSchema.safeParse(args)
      if (!parsed.success) {
        throw new FsRequestError("BAD_ARGS", `fs.read バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
      }
      return fsRead(parsed.data)
    }
    case "fs.write": {
      const parsed = fsWriteArgsSchema.safeParse(args)
      if (!parsed.success) {
        throw new FsRequestError("BAD_ARGS", `fs.write バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
      }
      return fsWrite(parsed.data)
    }
    case "fs.mutate": {
      const parsed = fsMutateArgsSchema.safeParse(args)
      if (!parsed.success) {
        throw new FsRequestError("BAD_ARGS", `fs.mutate バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
      }
      return fsMutate(parsed.data)
    }
    case "fs.importFile": {
      const parsed = fsImportFileArgsSchema.safeParse(args)
      if (!parsed.success) {
        throw new FsRequestError("BAD_ARGS", `fs.importFile バリデーション失敗: ${JSON.stringify(parsed.error.issues)}`)
      }
      return fsImportFile(parsed.data)
    }
  }
}
