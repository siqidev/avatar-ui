import { contextBridge, ipcRenderer } from "electron"

// Renderer に公開する最小API
// ipcRendererの直接公開は禁止。1チャネル1メソッドで公開する
contextBridge.exposeInMainWorld("fieldApi", {
  // Renderer → Main（送信）
  attach: () => ipcRenderer.send("channel.attach"),
  detach: () => ipcRenderer.send("channel.detach"),
  postChat: (text: string, correlationId: string) =>
    ipcRenderer.send("chat.post", { type: "chat.post", actor: "human", correlationId, text }),
  terminate: () => ipcRenderer.send("field.terminate"),

  // Main → Renderer（イベント購読）
  onFieldState: (cb: (data: unknown) => void) =>
    ipcRenderer.on("field.state", (_e, data) => cb(data)),
  onChatReply: (cb: (data: unknown) => void) =>
    ipcRenderer.on("chat.reply", (_e, data) => cb(data)),
  onIntegrityAlert: (cb: (data: unknown) => void) =>
    ipcRenderer.on("integrity.alert", (_e, data) => cb(data)),
  onObservation: (cb: (data: unknown) => void) =>
    ipcRenderer.on("observation.event", (_e, data) => cb(data)),
})
