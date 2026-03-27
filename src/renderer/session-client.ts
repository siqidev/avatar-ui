// セッションWebSocketクライアント: WSサーバーに接続しセッションイベントを配信する
// Renderer（ブラウザ環境）で動作。ブラウザネイティブのWebSocket APIを使用

import type {
  SessionEvent,
  SessionStatePayload,
  StreamItemPayload,
  MonitorItemPayload,
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
} from "../shared/session-event-schema.js"

// --- 型定義 ---

export type SessionClientCallbacks = {
  onSessionState?: (payload: SessionStatePayload) => void
  onStreamItem?: (payload: StreamItemPayload) => void
  onMonitorItem?: (payload: MonitorItemPayload) => void
  onApprovalRequested?: (payload: ApprovalRequestedPayload) => void
  onApprovalResolved?: (payload: ApprovalResolvedPayload) => void
  onError?: (error: Error) => void
  onClose?: () => void
  onReconnect?: () => void
}

export type SessionClient = {
  connect: () => Promise<void>
  close: () => void
  sendStreamPost: (text: string, correlationId: string, actor: "human" | "ai") => boolean
  sendApprovalRespond: (requestId: string, decision: "approve" | "deny") => void
}

// --- 自動再接続設定 ---

const RECONNECT_BASE_MS = 3_000
const RECONNECT_MAX_MS = 60_000

// --- クライアント生成 ---

export function createSessionClient(
  url: string,
  callbacks: SessionClientCallbacks,
): SessionClient {
  let ws: WebSocket | null = null
  let intentionalClose = false
  let reconnectDelay = RECONNECT_BASE_MS
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data as string) as SessionEvent
      switch (data.kind) {
        case "session.state":
          callbacks.onSessionState?.(data.payload)
          break
        case "stream.item":
          callbacks.onStreamItem?.(data.payload)
          break
        case "monitor.item":
          callbacks.onMonitorItem?.(data.payload)
          break
        case "approval.requested":
          callbacks.onApprovalRequested?.(data.payload)
          break
        case "approval.resolved":
          callbacks.onApprovalResolved?.(data.payload)
          break
      }
    } catch {
      callbacks.onError?.(new Error("セッションイベント解析失敗"))
    }
  }

  function setupWs(resolve?: () => void, reject?: (err: Error) => void): void {
    ws = new WebSocket(url)
    ws.onopen = () => {
      reconnectDelay = RECONNECT_BASE_MS // 成功時にリセット
      resolve?.()
    }
    ws.onmessage = handleMessage
    ws.onerror = () => {
      if (ws?.readyState !== WebSocket.OPEN) {
        reject?.(new Error("WebSocket接続失敗"))
      } else {
        callbacks.onError?.(new Error("WebSocketエラー"))
      }
    }
    ws.onclose = () => {
      callbacks.onClose?.()
      // 意図的なclose以外は自動再接続
      if (!intentionalClose) {
        scheduleReconnect()
      }
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      setupWs(
        () => { callbacks.onReconnect?.() },
        () => {
          // 再接続失敗: 指数バックオフで再試行
          reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
          scheduleReconnect()
        },
      )
    }, reconnectDelay)
  }

  function connect(): Promise<void> {
    intentionalClose = false
    return new Promise((resolve, reject) => {
      setupWs(resolve, reject)
    })
  }

  function close(): void {
    intentionalClose = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    ws?.close()
    ws = null
  }

  function sendStreamPost(text: string, correlationId: string, actor: "human" | "ai"): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify({ type: "stream.post", text, correlationId, actor }))
    return true
  }

  function sendApprovalRespond(requestId: string, decision: "approve" | "deny"): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: "tool.approval.respond", requestId, decision }))
  }

  return { connect, close, sendStreamPost, sendApprovalRespond }
}
