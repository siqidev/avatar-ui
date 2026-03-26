// session-ws-server: WebSocketサーバーのテスト
// 検証: token認証、session.state初回配信、event busリレー、stream.post受信、切断

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { WebSocket } from "ws"
import { createSessionWsServer } from "./session-ws-server.js"
import type { SessionWsServer } from "./session-ws-server.js"
import { publish, _resetForTest as resetEventBus } from "./session-event-bus.js"
import { createSessionEvent } from "../shared/session-event-schema.js"
import type { SessionStatePayload } from "../shared/session-event-schema.js"

vi.mock("../logger.js", () => ({
  info: vi.fn(),
  error: vi.fn(),
}))

// テスト用ポート（テスト間で衝突しないよう動的割り当て）
let portCounter = 19200

function nextPort(): number {
  return portCounter++
}

function defaultSnapshot(): SessionStatePayload {
  return {
    fieldState: "active",
    settings: { avatarName: "TestAvatar", userName: "TestUser" },
    history: [],
  }
}

// --- ヘルパー ---

function parseWsMessage(data: Buffer | string): Record<string, unknown> {
  const text = typeof data === "string" ? data : data.toString("utf-8")
  return JSON.parse(text) as Record<string, unknown>
}

// 接続 + 初回メッセージを同時に取得（レースコンディション回避）
// session.stateはconnection時に即送信されるため、open前にリスナー登録が必要
function connectWithFirstMessage(
  port: number,
  token?: string,
): Promise<{ ws: WebSocket; firstMessage: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const url = token ? `ws://localhost:${port}?token=${token}` : `ws://localhost:${port}`
    const ws = new WebSocket(url)
    ws.once("message", (data: Buffer | string) => {
      resolve({ ws, firstMessage: parseWsMessage(data) })
    })
    ws.on("error", reject)
  })
}

// token認証テスト用（メッセージ不要、接続成否のみ）
function connect(port: number, token?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const url = token ? `ws://localhost:${port}?token=${token}` : `ws://localhost:${port}`
    const ws = new WebSocket(url)
    ws.on("open", () => resolve(ws))
    ws.on("error", reject)
  })
}

// 次のメッセージを1件受信
function receiveOne(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (data: Buffer | string) => {
      resolve(parseWsMessage(data))
    })
  })
}

// サーバー起動完了を待つ
function startAndWait(server: SessionWsServer): Promise<void> {
  return new Promise((resolve) => {
    server.start()
    setTimeout(resolve, 50)
  })
}

describe("session-ws-server", () => {
  let server: SessionWsServer
  let clients: WebSocket[]

  beforeEach(() => {
    resetEventBus()
    clients = []
  })

  afterEach(async () => {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.close()
    }
    clients = []
    server?.stop()
    await new Promise((r) => setTimeout(r, 50))
  })

  // --- token認証 ---

  it("token認証: 正しいtokenで接続成功", async () => {
    const port = nextPort()
    server = createSessionWsServer({
      port,
      token: "secret-123",
      getStateSnapshot: defaultSnapshot,
    })
    await startAndWait(server)

    const ws = await connect(port, "secret-123")
    clients.push(ws)
    expect(ws.readyState).toBe(WebSocket.OPEN)
  })

  it("token認証: 不正なtokenで接続拒否", async () => {
    const port = nextPort()
    server = createSessionWsServer({
      port,
      token: "secret-123",
      getStateSnapshot: defaultSnapshot,
    })
    await startAndWait(server)

    await expect(connect(port, "wrong-token")).rejects.toThrow()
  })

  it("token認証: tokenなしで接続拒否", async () => {
    const port = nextPort()
    server = createSessionWsServer({
      port,
      token: "secret-123",
      getStateSnapshot: defaultSnapshot,
    })
    await startAndWait(server)

    await expect(connect(port)).rejects.toThrow()
  })

  it("token認証: token未設定時は認証なしで接続成功", async () => {
    const port = nextPort()
    server = createSessionWsServer({
      port,
      token: undefined,
      getStateSnapshot: defaultSnapshot,
    })
    await startAndWait(server)

    const ws = await connect(port)
    clients.push(ws)
    expect(ws.readyState).toBe(WebSocket.OPEN)
  })

  // --- session.state初回配信 ---

  it("接続時にsession.stateが送信される", async () => {
    const port = nextPort()
    server = createSessionWsServer({
      port,
      token: undefined,
      getStateSnapshot: () => ({
        fieldState: "active",
        settings: { avatarName: "Spectra", userName: "Sito" },
        history: [
          { type: "stream", actor: "human", text: "こんにちは" },
          { type: "monitor", channel: "roblox", eventType: "chat", formatted: "[chat] test", timestamp: "2026-01-01T00:00:00Z" },
        ],
      }),
    })
    await startAndWait(server)

    const { ws, firstMessage } = await connectWithFirstMessage(port)
    clients.push(ws)

    expect(firstMessage.kind).toBe("session.state")
    const payload = firstMessage.payload as Record<string, unknown>
    expect(payload.fieldState).toBe("active")
    expect(payload.settings).toEqual({ avatarName: "Spectra", userName: "Sito" })
    expect(payload.history).toHaveLength(2)
  })

  // --- event busリレー ---

  it("event busのイベントがWSクライアントに配信される", async () => {
    const port = nextPort()
    server = createSessionWsServer({
      port,
      token: undefined,
      getStateSnapshot: defaultSnapshot,
    })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port) // session.state消費済み
    clients.push(ws)

    // event busにstream.itemを発行
    const msgPromise = receiveOne(ws)
    publish(createSessionEvent("stream.item", {
      actor: "ai",
      correlationId: "test-corr",
      text: "テスト応答",
      source: "user",
      channel: "console",
      toolCalls: [],
    }))

    const msg = await msgPromise
    expect(msg.kind).toBe("stream.item")
    const payload = msg.payload as Record<string, unknown>
    expect(payload.actor).toBe("ai")
    expect(payload.text).toBe("テスト応答")
  })

  it("複数クライアントに同時配信される", async () => {
    const port = nextPort()
    server = createSessionWsServer({
      port,
      token: undefined,
      getStateSnapshot: defaultSnapshot,
    })
    await startAndWait(server)

    const { ws: ws1 } = await connectWithFirstMessage(port)
    const { ws: ws2 } = await connectWithFirstMessage(port)
    clients.push(ws1, ws2)

    const p1 = receiveOne(ws1)
    const p2 = receiveOne(ws2)

    publish(createSessionEvent("monitor.item", {
      channel: "roblox",
      eventType: "chat",
      formatted: "[chat] hello",
      timestamp: new Date().toISOString(),
    }))

    const [msg1, msg2] = await Promise.all([p1, p2])
    expect(msg1.kind).toBe("monitor.item")
    expect(msg2.kind).toBe("monitor.item")
    expect(server.getClientCount()).toBe(2)
  })

  // --- stream.post受信 ---

  it("stream.postメッセージがonStreamPostコールバックに渡される", async () => {
    const port = nextPort()
    const onStreamPost = vi.fn()
    server = createSessionWsServer({
      port,
      token: undefined,
      getStateSnapshot: defaultSnapshot,
      onStreamPost,
    })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port)
    clients.push(ws)

    ws.send(JSON.stringify({
      type: "stream.post",
      actor: "human",
      correlationId: "ws-corr-1",
      text: "WSからのメッセージ",
    }))

    // コールバック呼び出しを待つ
    await new Promise((r) => setTimeout(r, 50))
    expect(onStreamPost).toHaveBeenCalledWith("WSからのメッセージ", "ws-corr-1", "human")
  })

  it("不正なstream.postはエラーメッセージを返す", async () => {
    const port = nextPort()
    server = createSessionWsServer({
      port,
      token: undefined,
      getStateSnapshot: defaultSnapshot,
      onStreamPost: vi.fn(),
    })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port)
    clients.push(ws)

    const errorPromise = receiveOne(ws)
    ws.send(JSON.stringify({
      type: "stream.post",
      actor: "human",
      // correlationId欠落、text欠落
    }))

    const msg = await errorPromise
    expect(msg.type).toBe("error")
  })

  // --- getClientCount ---

  it("getClientCountが正確なクライアント数を返す", async () => {
    const port = nextPort()
    server = createSessionWsServer({
      port,
      token: undefined,
      getStateSnapshot: defaultSnapshot,
    })
    await startAndWait(server)

    expect(server.getClientCount()).toBe(0)

    const ws = await connect(port)
    clients.push(ws)
    expect(server.getClientCount()).toBe(1)
  })

  // --- 停止 ---

  it("stop()で全クライアントが切断される", async () => {
    const port = nextPort()
    server = createSessionWsServer({
      port,
      token: undefined,
      getStateSnapshot: defaultSnapshot,
    })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port)
    clients.push(ws)

    const closePromise = new Promise<number>((resolve) => {
      ws.on("close", (code) => resolve(code))
    })

    server.stop()
    const code = await closePromise
    expect(code).toBe(1001) // Server shutting down
  })
})
