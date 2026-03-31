// Discord用セッションWSクライアント: session-ws-serverにNode wsで接続
// Renderer用session-client.tsと同一プロトコルだが、Node環境用に再接続・認証ヘッダを持つ

import WebSocket from "ws"
import type {
  SessionEvent,
  SessionStatePayload,
  StreamItemPayload,
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
} from "../shared/session-event-schema.js"
import * as log from "../logger.js"

// --- 型定義 ---

export type DiscordSessionCallbacks = {
  onSessionState?: (payload: SessionStatePayload) => void
  onStreamItem?: (payload: StreamItemPayload) => void
  onApprovalRequested?: (payload: ApprovalRequestedPayload) => void
  onApprovalResolved?: (payload: ApprovalResolvedPayload) => void
  onConnect?: () => void
  onDisconnect?: () => void
}

export type DiscordSessionClient = {
  connect: () => void
  close: () => void
  sendApprovalRespond: (requestId: string, decision: "approve" | "deny") => void
  sendStreamPost: (text: string, correlationId: string, inputRole: "owner" | "external") => void
}

// --- 再接続バックオフ ---

const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 30000]

function getBackoffDelay(attempt: number): number {
  const base = BACKOFF_STEPS[Math.min(attempt, BACKOFF_STEPS.length - 1)]
  // jitter: ±25%
  const jitter = base * 0.25 * (Math.random() * 2 - 1)
  return Math.round(base + jitter)
}

// --- クライアント生成 ---

export function createDiscordSessionClient(
  url: string,
  callbacks: DiscordSessionCallbacks,
): DiscordSessionClient {
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let closed = false // close()が明示的に呼ばれた場合

  function handleMessage(data: WebSocket.Data): void {
    try {
      const event = JSON.parse(String(data)) as SessionEvent
      switch (event.kind) {
        case "session.state":
          callbacks.onSessionState?.(event.payload)
          break
        case "stream.item":
          callbacks.onStreamItem?.(event.payload)
          break
        case "approval.requested":
          callbacks.onApprovalRequested?.(event.payload)
          break
        case "approval.resolved":
          callbacks.onApprovalResolved?.(event.payload)
          break
        // monitor.item は購読対象外（Discord窓口では不要）
      }
    } catch {
      log.error("[DISCORD_WS] イベント解析失敗")
    }
  }

  function scheduleReconnect(): void {
    if (closed) return
    const delay = getBackoffDelay(attempt)
    log.info(`[DISCORD_WS] ${delay}ms後に再接続 (attempt=${attempt})`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      attempt++
      connect()
    }, delay)
  }

  function connect(): void {
    if (closed) return
    try {
      ws = new WebSocket(url)
    } catch (err) {
      log.error(`[DISCORD_WS] 接続生成失敗: ${err instanceof Error ? err.message : String(err)}`)
      scheduleReconnect()
      return
    }

    ws.on("open", () => {
      log.info("[DISCORD_WS] 接続確立")
      attempt = 0
      callbacks.onConnect?.()
    })

    ws.on("message", handleMessage)

    ws.on("close", () => {
      log.info("[DISCORD_WS] 接続切断")
      ws = null
      callbacks.onDisconnect?.()
      scheduleReconnect()
    })

    ws.on("error", (err) => {
      log.error(`[DISCORD_WS] エラー: ${err.message}`)
      // closeイベントが後続するので、ここでは再接続しない
    })
  }

  function close(): void {
    closed = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
  }

  function sendApprovalRespond(requestId: string, decision: "approve" | "deny"): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: "tool.approval.respond", requestId, decision }))
  }

  function sendStreamPost(text: string, correlationId: string, inputRole: "owner" | "external"): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      type: "stream.post",
      actor: "human",
      correlationId,
      text,
      channel: "discord",
      inputRole,
    }))
  }

  return { connect, close, sendApprovalRespond, sendStreamPost }
}
