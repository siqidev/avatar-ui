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
import type { Source } from "../shared/ipc-schema.js"
import type { ChannelId } from "../shared/channel.js"
import type { InputRole } from "../services/input-role-resolver.js"
import { toolApprovalRespondSchema } from "../shared/tool-approval-schema.js"
import { registerApprover, unregisterApprover, respond as hubRespond } from "./approval-hub.js"
import { fsRequestSchema } from "../shared/fs-rpc-schema.js"
import { dispatchFsRequest, FsRequestError } from "./fs-request-handler.js"
import * as log from "../logger.js"

// --- 型定義 ---

export type SessionWsOptions = {
  port: number
  token: string | undefined // undefinedの場合、認証なし（開発用）
  // WS upgrade受け入れOrigin（未指定=全許可、指定=一致するOriginのみ許可）
  // token認証に加える多層防御。クロスサイトWebSocketハイジャック対策
  allowedOrigins?: string[] | undefined
  // 依存注入: 場の状態スナップショット取得
  getStateSnapshot: () => SessionStatePayload
  // 依存注入: stream.post処理
  onStreamPost?: (text: string, correlationId: string, actor: "human" | "ai", channel?: ChannelId, source?: Source, inputRole?: InputRole) => void
  // 外部HTTPサーバー（console-http-serverと同居する場合）
  // 指定時: createServer/listenをスキップし、upgradeハンドラのみ登録
  httpServer?: HttpServer
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
  const externalServer = options.httpServer ?? null
  const allowedOrigins = options.allowedOrigins
  // 非ブラウザクライアント（ElectronのWebSocket, curl, node-ws等）はOriginヘッダを付与しない場合がある
  // そのためOriginヘッダ無し（=undefined）は常に許可。allowlistは設定時にブラウザからの
  // クロスオリジン接続のみを弾く用途（トークン漏洩時のCSWSH対策）
  function isOriginAllowed(origin: string | undefined): boolean {
    if (!allowedOrigins || allowedOrigins.length === 0) return true
    if (!origin) return true
    return allowedOrigins.includes(origin)
  }

  let httpServer: HttpServer | null = null
  let wss: WebSocketServer | null = null
  let unsubscribe: (() => void) | null = null
  let unregisterWsApprover: (() => void) | null = null

  function start(): void {
    // 外部HTTPサーバーが注入されていない場合のみ内部サーバーを作成
    if (externalServer) {
      httpServer = externalServer
    } else {
      httpServer = createServer((_req, res) => {
        // HTTP直アクセスは拒否（WebSocket upgradeのみ受け付ける）
        res.writeHead(426, { "Content-Type": "text/plain" })
        res.end("Upgrade Required")
      })
    }

    wss = new WebSocketServer({ noServer: true })

    // HTTP upgrade → Origin検証 → token認証 → WebSocket接続
    httpServer.on("upgrade", (req, socket, head) => {
      // Origin allowlist検証（設定時のみ）
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined
      if (!isOriginAllowed(origin)) {
        log.info(`[SESSION_WS] Origin拒否: ${origin ?? "(なし)"}`)
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n")
        socket.destroy()
        return
      }

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

      // WS承認者を登録（初回クライアント接続時のみ）
      if (!unregisterWsApprover) {
        unregisterWsApprover = registerApprover({
          approverId: "ws",
          label: "WebSocket",
          sendRequest: (req) => {
            // approval.requestedはevent bus経由で全クライアントに配信済み
            // ここではhubの配送契約を満たすためのno-op（実際の配信はbus→broadcastが担う）
            log.info(`[SESSION_WS] 承認リクエスト配送: ${req.toolName} (${req.requestId})`)
          },
        })
      }

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

      // ping/pong: 接続の健全性監視（cloudflareアイドルタイムアウト対策）
      let alive = true
      const pingTimer = setInterval(() => {
        if (!alive) {
          log.info("[SESSION_WS] pong未応答 — 切断")
          ws.terminate()
          return
        }
        alive = false
        ws.ping()
      }, 30_000) // 30秒ごと

      ws.on("pong", () => { alive = true })

      ws.on("close", () => {
        clearInterval(pingTimer)
        log.info(`[SESSION_WS] クライアント切断 (残${wss?.clients.size ?? 0}台)`)
        // 全クライアント切断時にWS承認者を解除
        if (wss && wss.clients.size === 0 && unregisterWsApprover) {
          unregisterWsApprover()
          unregisterWsApprover = null
        }
      })

      ws.on("error", (err) => {
        clearInterval(pingTimer)
        log.error(`[SESSION_WS] WebSocketエラー: ${err.message}`)
      })
    })

    // event bus購読 → 全クライアントに配信
    unsubscribe = subscribe((event: SessionEvent) => {
      broadcast(event)
    })

    const originSummary = allowedOrigins && allowedOrigins.length > 0
      ? `allowlist=[${allowedOrigins.join(",")}]`
      : "allowlist=(なし)"

    // 外部HTTPサーバー使用時はlisten不要（呼び出し元が管理）
    if (!externalServer) {
      httpServer.listen(port, () => {
        log.info(`[SESSION_WS] WebSocketサーバー起動 (port: ${port}, 認証: ${token ? "あり" : "なし"}, ${originSummary})`)
      })
    } else {
      log.info(`[SESSION_WS] WebSocketサーバー起動（外部HTTPサーバー共有, 認証: ${token ? "あり" : "なし"}, ${originSummary})`)
    }
  }

  function stop(): void {
    unsubscribe?.()
    unsubscribe = null
    unregisterWsApprover?.()
    unregisterWsApprover = null

    // 全クライアントを切断
    if (wss) {
      for (const client of wss.clients) {
        client.close(1001, "Server shutting down")
      }
      wss.close()
      wss = null
    }

    // 外部HTTPサーバー使用時はclose不要（呼び出し元が管理）
    if (httpServer && !externalServer) {
      httpServer.close()
    }
    httpServer = null

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
        onStreamPost(result.data.text, result.data.correlationId, result.data.actor, result.data.channel, undefined, result.data.inputRole)
        return
      }

      // tool.approval.respond: ツール承認応答
      if (parsed.type === "tool.approval.respond") {
        const result = toolApprovalRespondSchema.safeParse(parsed)
        if (!result.success) {
          ws.send(JSON.stringify({ type: "error", message: "tool.approval.respond バリデーション失敗" }))
          return
        }
        const respondResult = hubRespond(result.data.requestId, result.data.decision)
        ws.send(JSON.stringify({ type: "tool.approval.result", ...respondResult }))
        return
      }

      // fs.request: ブラウザ版FS RPC
      if (parsed.type === "fs.request") {
        const result = fsRequestSchema.safeParse(parsed)
        if (!result.success) {
          // reqIdが取れない場合もあるので、type+errorだけ返す
          const reqId = typeof parsed.reqId === "string" ? parsed.reqId : ""
          ws.send(JSON.stringify({ type: "fs.response", reqId, ok: false, error: { message: "fs.request バリデーション失敗", code: "BAD_REQUEST" } }))
          return
        }
        const { reqId, method, args } = result.data
        dispatchFsRequest(method, args).then((value) => {
          ws.send(JSON.stringify({ type: "fs.response", reqId, ok: true, result: value }))
        }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          const code = err instanceof FsRequestError ? err.code : "FS_ERROR"
          ws.send(JSON.stringify({ type: "fs.response", reqId, ok: false, error: { message, code } }))
        })
        return
      }

      log.info(`[SESSION_WS] 未知のメッセージタイプ: ${parsed.type}`)
    } catch (err) {
      log.error(`[SESSION_WS] メッセージ解析失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { start, stop, getClientCount }
}
