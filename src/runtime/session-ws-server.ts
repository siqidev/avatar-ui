// セッションWebSocketサーバー: event busのイベントを外部クライアントに配信する
// トランスポート層のみ。ビジネスロジックは持たない

import { createServer } from "node:http"
import type { Server as HttpServer, IncomingMessage } from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import { subscribe } from "./session-event-bus.js"
import { createSessionEvent } from "../shared/session-event-schema.js"
import type { SessionEvent } from "../shared/session-event-schema.js"
import type { SessionStatePayload, HistoryItem } from "../shared/session-event-schema.js"
import { streamPostSchema } from "../shared/ipc-schema.js"
import * as log from "../logger.js"

// --- 型定義 ---

export type SessionWsOptions = {
  port: number
  token: string | undefined // undefinedの場合、認証なし（開発用）
  // 依存注入: 場の状態スナップショット取得
  getStateSnapshot: () => SessionStatePayload
  // 依存注入: stream.post処理
  onStreamPost?: (text: string, correlationId: string, actor: "human" | "ai") => void
}

export type SessionWsServer = {
  start: () => void
  stop: () => void
  getClientCount: () => number
}

// --- token認証 ---

function extractToken(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  // クエリパラメータ: ?token=xxx
  const queryToken = url.searchParams.get("token")
  if (queryToken) return queryToken
  // Authorizationヘッダー: Bearer xxx
  const auth = req.headers.authorization
  if (auth?.startsWith("Bearer ")) return auth.slice(7)
  return null
}

// --- サーバー作成 ---

export function createSessionWsServer(options: SessionWsOptions): SessionWsServer {
  const { port, token, getStateSnapshot, onStreamPost } = options

  let httpServer: HttpServer | null = null
  let wss: WebSocketServer | null = null
  let unsubscribe: (() => void) | null = null

  function start(): void {
    httpServer = createServer((_req, res) => {
      // HTTP直アクセスは拒否（WebSocket upgradeのみ受け付ける）
      res.writeHead(426, { "Content-Type": "text/plain" })
      res.end("Upgrade Required")
    })

    wss = new WebSocketServer({ noServer: true })

    // HTTP upgrade → token認証 → WebSocket接続
    httpServer.on("upgrade", (req, socket, head) => {
      // token認証（設定されている場合のみ）
      if (token) {
        const clientToken = extractToken(req)
        if (clientToken !== token) {
          log.info("[SESSION_WS] 認証失敗 — 接続拒否")
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
          socket.destroy()
          return
        }
      }

      wss!.handleUpgrade(req, socket, head, (ws) => {
        wss!.emit("connection", ws, req)
      })
    })

    // WebSocket接続確立
    wss.on("connection", (ws) => {
      log.info(`[SESSION_WS] クライアント接続 (計${wss!.clients.size}台)`)

      // 初回: session.stateを送信
      try {
        const snapshot = getStateSnapshot()
        const event = createSessionEvent("session.state", snapshot)
        ws.send(JSON.stringify(event))
      } catch (err) {
        log.error(`[SESSION_WS] session.state送信失敗: ${err instanceof Error ? err.message : String(err)}`)
      }

      // クライアントからのメッセージ受信
      ws.on("message", (data) => {
        handleClientMessage(ws, data)
      })

      ws.on("close", () => {
        log.info(`[SESSION_WS] クライアント切断 (残${wss?.clients.size ?? 0}台)`)
      })

      ws.on("error", (err) => {
        log.error(`[SESSION_WS] WebSocketエラー: ${err.message}`)
      })
    })

    // event bus購読 → 全クライアントに配信
    unsubscribe = subscribe((event: SessionEvent) => {
      broadcast(event)
    })

    httpServer.listen(port, () => {
      log.info(`[SESSION_WS] WebSocketサーバー起動 (port: ${port}, 認証: ${token ? "あり" : "なし"})`)
    })
  }

  function stop(): void {
    unsubscribe?.()
    unsubscribe = null

    // 全クライアントを切断
    if (wss) {
      for (const client of wss.clients) {
        client.close(1001, "Server shutting down")
      }
      wss.close()
      wss = null
    }

    if (httpServer) {
      httpServer.close()
      httpServer = null
    }

    log.info("[SESSION_WS] WebSocketサーバー停止")
  }

  function getClientCount(): number {
    return wss?.clients.size ?? 0
  }

  // 全接続クライアントにイベントをブロードキャスト
  function broadcast(event: SessionEvent): void {
    if (!wss || wss.clients.size === 0) return
    const json = JSON.stringify(event)
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json)
      }
    }
  }

  // クライアントメッセージの処理
  function handleClientMessage(ws: WebSocket, data: unknown): void {
    try {
      const text = typeof data === "string" ? data : String(data)
      const parsed = JSON.parse(text) as Record<string, unknown>

      // stream.post: クライアントからのメッセージ送信
      if (parsed.type === "stream.post") {
        const result = streamPostSchema.safeParse(parsed)
        if (!result.success) {
          ws.send(JSON.stringify({ type: "error", message: "stream.post バリデーション失敗" }))
          return
        }
        if (!onStreamPost) {
          ws.send(JSON.stringify({ type: "error", message: "stream.post 未対応" }))
          return
        }
        onStreamPost(result.data.text, result.data.correlationId, result.data.actor)
        return
      }

      log.info(`[SESSION_WS] 未知のメッセージタイプ: ${parsed.type}`)
    } catch (err) {
      log.error(`[SESSION_WS] メッセージ解析失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { start, stop, getClientCount }
}
