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

// Renderer に公開する最小API
// ipcRendererの直接公開は禁止。1チャネル1メソッドで公開する
contextBridge.exposeInMainWorld("fieldApi", {
  // Renderer → Main（送信: fire-and-forget）
  attach: () => ipcRenderer.send("channel.attach"),
  detach: () => ipcRenderer.send("channel.detach"),
  postChat: (text: string, correlationId: string) =>
    ipcRenderer.send("chat.post", { type: "chat.post", actor: "human", correlationId, text }),
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

  // Main → Renderer（イベント購読）
  onFieldState: (cb: (data: unknown) => void) =>
    ipcRenderer.on("field.state", (_e, data) => cb(data)),
  onChatReply: (cb: (data: unknown) => void) =>
    ipcRenderer.on("chat.reply", (_e, data) => cb(data)),
  onIntegrityAlert: (cb: (data: unknown) => void) =>
    ipcRenderer.on("integrity.alert", (_e, data) => cb(data)),
  onObservation: (cb: (data: unknown) => void) =>
    ipcRenderer.on("observation.event", (_e, data) => cb(data)),
  onTerminalOutput: (cb: (data: unknown) => void) =>
    ipcRenderer.on("terminal.output", (_e, data) => cb(data)),
  onTerminalLifecycle: (cb: (data: unknown) => void) =>
    ipcRenderer.on("terminal.lifecycle", (_e, data) => cb(data)),
  onTerminalSnapshot: (cb: (data: unknown) => void) =>
    ipcRenderer.on("terminal.snapshot", (_e, data) => cb(data)),
})
