import { contextBridge, ipcRenderer } from "electron"
import type {
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
  TerminalExecArgs,
  TerminalStdinArgs,
  TerminalStopArgs,
  TerminalResizeArgs,
  TerminalSnapshot,
} from "../shared/terminal-schema.js"
import type { ToolApprovalRespond } from "../shared/tool-approval-schema.js"
import type { DemoScript } from "../shared/demo-script-schema.js"

// Renderer に公開する最小API
// ipcRendererの直接公開は禁止。1チャネル1メソッドで公開する
contextBridge.exposeInMainWorld("fieldApi", {
  // Renderer → Main（送信: fire-and-forget）
  attach: () => ipcRenderer.send("channel.attach"),
  detach: () => ipcRenderer.send("channel.detach"),
  postStream: (text: string, correlationId: string) =>
    ipcRenderer.send("stream.post", { type: "stream.post", actor: "human", correlationId, text }),
  terminate: () => ipcRenderer.send("field.terminate"),

  // Renderer → Main（ファイル操作: request-response）
  fsRootName: (): Promise<string> => ipcRenderer.invoke("fs.rootName"),
  fsList: (args: FsListArgs): Promise<FsListResult> =>
    ipcRenderer.invoke("fs.list", args),
  fsRead: (args: FsReadArgs): Promise<FsReadResult> =>
    ipcRenderer.invoke("fs.read", args),
  fsWrite: (args: FsWriteArgs): Promise<FsWriteResult> =>
    ipcRenderer.invoke("fs.write", args),
  fsMutate: (args: FsMutateArgs): Promise<FsMutateResult> =>
    ipcRenderer.invoke("fs.mutate", args),

  // Renderer → Main（Terminal: request-response）
  terminalExec: (args: TerminalExecArgs): Promise<{ accepted: boolean; reason?: string }> =>
    ipcRenderer.invoke("terminal.exec", args),
  terminalStdin: (args: TerminalStdinArgs): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke("terminal.stdin", args),
  terminalStop: (args: TerminalStopArgs): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke("terminal.stop", args),
  terminalResize: (args: TerminalResizeArgs): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("terminal.resize", args),
  terminalSnapshot: (): Promise<TerminalSnapshot> =>
    ipcRenderer.invoke("terminal.snapshot"),

  // Renderer → Main（ツール承認応答: request-response）
  respondToolApproval: (args: ToolApprovalRespond): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("tool.approval.respond", args),

  // Main → Renderer（イベント購読）
  onFieldState: (cb: (data: unknown) => void) =>
    ipcRenderer.on("field.state", (_e, data) => cb(data)),
  onStreamReply: (cb: (data: unknown) => void) =>
    ipcRenderer.on("stream.reply", (_e, data) => cb(data)),
  onIntegrityAlert: (cb: (data: unknown) => void) =>
    ipcRenderer.on("integrity.alert", (_e, data) => cb(data)),
  onObservation: (cb: (data: unknown) => void) =>
    ipcRenderer.on("observation.event", (_e, data) => cb(data)),
  onXEvent: (cb: (data: unknown) => void) =>
    ipcRenderer.on("x.event", (_e, data) => cb(data)),
  onTerminalOutput: (cb: (data: unknown) => void) =>
    ipcRenderer.on("terminal.output", (_e, data) => cb(data)),
  onTerminalLifecycle: (cb: (data: unknown) => void) =>
    ipcRenderer.on("terminal.lifecycle", (_e, data) => cb(data)),
  onTerminalSnapshot: (cb: (data: unknown) => void) =>
    ipcRenderer.on("terminal.snapshot", (_e, data) => cb(data)),
  onToolApprovalRequest: (cb: (data: unknown) => void) =>
    ipcRenderer.on("tool.approval.request", (_e, data) => cb(data)),

  // Main → Renderer（設定変更）
  onThemeChange: (cb: (theme: string) => void) =>
    ipcRenderer.on("settings.theme", (_e, theme) => cb(theme)),
  onLocaleChange: (cb: (locale: string) => void) =>
    ipcRenderer.on("settings.locale", (_e, locale) => cb(locale)),

  // デモモード
  loadDemoScript: (): Promise<{ ok: true; lines: DemoScript } | { ok: false; error: string }> =>
    ipcRenderer.invoke("demo.script.load"),
})
