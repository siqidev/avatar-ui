import { contextBridge, ipcRenderer, webUtils } from "electron"
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

// Renderer に公開する最小API
// ipcRendererの直接公開は禁止。1チャネル1メソッドで公開する
// セッション系（stream, monitor, approval）はWebSocket経由に移行済み
contextBridge.exposeInMainWorld("fieldApi", {
  // Renderer → Main（場のライフサイクル: request-response）
  // attach: FSM遷移を保証するためinvoke（WS接続前に完了を待つ）
  attach: (): Promise<void> => ipcRenderer.invoke("channel.attach"),
  detach: () => ipcRenderer.send("channel.detach"),
  terminate: () => ipcRenderer.send("field.terminate"),

  // Renderer → Main（WS接続情報取得）
  sessionWsConfig: (): Promise<{ port: number; token?: string }> =>
    ipcRenderer.invoke("session.ws.config"),

  // Renderer → Main（ファイル操作: request-response）
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

  // Renderer → Main（Terminal: request-response）
  terminalInput: (args: TerminalInputArgs): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("terminal.input", args),
  terminalResize: (args: TerminalResizeArgs): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("terminal.resize", args),
  terminalSnapshot: (): Promise<TerminalSnapshot> =>
    ipcRenderer.invoke("terminal.snapshot"),

  // Main → Renderer（IPC残置: Console固有イベント）
  onIntegrityAlert: (cb: (data: unknown) => void) =>
    ipcRenderer.on("integrity.alert", (_e, data) => cb(data)),
  onTerminalData: (cb: (data: unknown) => void) =>
    ipcRenderer.on("terminal.data", (_e, data) => cb(data)),
  onTerminalState: (cb: (data: unknown) => void) =>
    ipcRenderer.on("terminal.state", (_e, data) => cb(data)),

  // Main → Renderer（設定変更）
  onThemeChange: (cb: (theme: string) => void) =>
    ipcRenderer.on("settings.theme", (_e, theme) => cb(theme)),
  onLocaleChange: (cb: (locale: string) => void) =>
    ipcRenderer.on("settings.locale", (_e, locale) => cb(locale)),

  // D&D外部ファイルパス取得（Electron 32+でFile.path廃止のため）
  getFilePath: (file: File): string => webUtils.getPathForFile(file),

  // デモモード
  loadDemoScript: (): Promise<{ ok: true; lines: DemoScript } | { ok: false; error: string }> =>
    ipcRenderer.invoke("demo.script.load"),
})
