import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { FieldApi, SessionWsConfig } from "../shared/field-api.js"
import type {
  FsImportFileArgs,
  FsImportFileResult,
  FsListArgs,
  FsReadArgs,
  FsWriteArgs,
  FsMutateArgs,
  FsListResult,
  FsReadResult,
  FsWriteResult,
  FsMutateResult,
} from "../shared/fs-schema.js"
import type {
  TerminalInputArgs,
  TerminalResizeArgs,
  TerminalSnapshot,
} from "../shared/terminal-schema.js"
import type { DemoScript } from "../shared/demo-script-schema.js"

// Electron preloadはDesktop profileのFieldApi実装
// Renderer に公開する唯一のホスト境界。ipcRendererの直接公開は禁止
// セッション系（stream, monitor, approval）はWebSocket経由に移行済み
const fieldApi: FieldApi = {
  // 場のライフサイクル
  attach: (): Promise<void> => ipcRenderer.invoke("channel.attach"),
  detach: () => ipcRenderer.send("channel.detach"),
  terminate: () => ipcRenderer.send("field.terminate"),

  // WS接続情報（capabilities含む）
  sessionWsConfig: (): Promise<SessionWsConfig> =>
    ipcRenderer.invoke("session.ws.config"),

  // ファイル操作
  fsRootName: (): Promise<string> => ipcRenderer.invoke("fs.rootName"),
  fsList: (args: FsListArgs): Promise<FsListResult> =>
    ipcRenderer.invoke("fs.list", args),
  fsRead: (args: FsReadArgs): Promise<FsReadResult> =>
    ipcRenderer.invoke("fs.read", args),
  fsWrite: (args: FsWriteArgs): Promise<FsWriteResult> =>
    ipcRenderer.invoke("fs.write", args),
  fsImportFile: (args: FsImportFileArgs): Promise<FsImportFileResult> =>
    ipcRenderer.invoke("fs.importFile", args),
  fsMutate: (args: FsMutateArgs): Promise<FsMutateResult> =>
    ipcRenderer.invoke("fs.mutate", args),

  // Terminal操作
  terminalInput: (args: TerminalInputArgs): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("terminal.input", args),
  terminalResize: (args: TerminalResizeArgs): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("terminal.resize", args),
  terminalSnapshot: (): Promise<TerminalSnapshot> =>
    ipcRenderer.invoke("terminal.snapshot"),

  // ホスト→Rendererイベント
  onIntegrityAlert: (cb: (data: unknown) => void) => {
    ipcRenderer.on("integrity.alert", (_e, data) => cb(data))
  },
  onTerminalData: (cb: (data: unknown) => void) => {
    ipcRenderer.on("terminal.data", (_e, data) => cb(data))
  },
  onTerminalState: (cb: (data: unknown) => void) => {
    ipcRenderer.on("terminal.state", (_e, data) => cb(data))
  },
  onThemeChange: (cb: (theme: string) => void) => {
    ipcRenderer.on("settings.theme", (_e, theme) => cb(theme))
  },
  onLocaleChange: (cb: (locale: string) => void) => {
    ipcRenderer.on("settings.locale", (_e, locale) => cb(locale))
  },

  // D&D外部ファイルパス取得（Electron 32+でFile.path廃止のため）
  getFilePath: (file: File): string => webUtils.getPathForFile(file),

  // デモモード
  loadDemoScript: (): Promise<
    { ok: true; lines: DemoScript } | { ok: false; error: string }
  > => ipcRenderer.invoke("demo.script.load"),
}

contextBridge.exposeInMainWorld("fieldApi", fieldApi)
