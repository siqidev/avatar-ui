// session-ws-server: WebSocketサーバーのテスト
// 検証: token認証、session.state初回配信、event busリレー、stream.post受信、切断

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { WebSocket } from "ws"
import { createSessionWsServer } from "./session-ws-server.js"
import type { SessionWsServer } from "./session-ws-server.js"
import { publish, _resetForTest as resetEventBus } from "./session-event-bus.js"
import { createSessionEvent } from "../shared/session-event-schema.js"
import type { SessionStatePayload } from "../shared/session-event-schema.js"
import { _resetConfigForTest } from "../config.js"

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
    pendingApprovals: [],
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
        pendingApprovals: [],
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
    expect(onStreamPost).toHaveBeenCalledWith("WSからのメッセージ", "ws-corr-1", "human", undefined, undefined, undefined)
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

// --- fs.request（ブラウザWS経由FS RPC）---

describe("session-ws-server fs.request", () => {
  let server: SessionWsServer
  let clients: WebSocket[]
  let tmpDir: string

  beforeEach(async () => {
    resetEventBus()
    clients = []
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-fs-test-"))
    _resetConfigForTest({ XAI_API_KEY: "test-key", AVATAR_SPACE: tmpDir })
  })

  afterEach(async () => {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.close()
    }
    clients = []
    server?.stop()
    await new Promise((r) => setTimeout(r, 50))
    await fs.rm(tmpDir, { recursive: true, force: true })
    _resetConfigForTest({ XAI_API_KEY: "test-key" })
  })

  // reqIdでフィルタしてfs.responseを1件受信する
  function awaitFsResponse(ws: WebSocket, reqId: string): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const onMessage = (data: Buffer | string) => {
        const msg = parseWsMessage(data)
        if (msg.type === "fs.response" && msg.reqId === reqId) {
          ws.off("message", onMessage)
          resolve(msg)
        }
      }
      ws.on("message", onMessage)
    })
  }

  async function sendFsRequest(
    ws: WebSocket,
    method: string,
    args: unknown,
  ): Promise<Record<string, unknown>> {
    const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const responsePromise = awaitFsResponse(ws, reqId)
    ws.send(JSON.stringify({ type: "fs.request", reqId, method, args }))
    return responsePromise
  }

  // --- 正常系 ---

  it("fs.rootName: AVATAR_SPACEのbasenameを返す", async () => {
    const port = nextPort()
    server = createSessionWsServer({ port, token: undefined, getStateSnapshot: defaultSnapshot })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port)
    clients.push(ws)

    const res = await sendFsRequest(ws, "fs.rootName", undefined)
    expect(res.ok).toBe(true)
    expect(res.result).toBe(path.basename(tmpDir))
  })

  it("fs.list: ファイル一覧を返す", async () => {
    await fs.writeFile(path.join(tmpDir, "a.txt"), "alpha")
    await fs.mkdir(path.join(tmpDir, "sub"))

    const port = nextPort()
    server = createSessionWsServer({ port, token: undefined, getStateSnapshot: defaultSnapshot })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port)
    clients.push(ws)

    const res = await sendFsRequest(ws, "fs.list", { path: "." })
    expect(res.ok).toBe(true)
    const result = res.result as { entries: Array<{ name: string; type: string }> }
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0]).toMatchObject({ name: "sub", type: "directory" })
    expect(result.entries[1]).toMatchObject({ name: "a.txt", type: "file" })
  })

  it("fs.read: ファイル内容を返す", async () => {
    await fs.writeFile(path.join(tmpDir, "hello.txt"), "world")

    const port = nextPort()
    server = createSessionWsServer({ port, token: undefined, getStateSnapshot: defaultSnapshot })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port)
    clients.push(ws)

    const res = await sendFsRequest(ws, "fs.read", { path: "hello.txt" })
    expect(res.ok).toBe(true)
    const result = res.result as { content: string }
    expect(result.content).toBe("world")
  })

  it("fs.write: ファイルを作成する", async () => {
    const port = nextPort()
    server = createSessionWsServer({ port, token: undefined, getStateSnapshot: defaultSnapshot })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port)
    clients.push(ws)

    const res = await sendFsRequest(ws, "fs.write", { path: "new.txt", content: "fresh" })
    expect(res.ok).toBe(true)
    const written = await fs.readFile(path.join(tmpDir, "new.txt"), "utf-8")
    expect(written).toBe("fresh")
  })

  it("fs.mutate: ディレクトリ作成", async () => {
    const port = nextPort()
    server = createSessionWsServer({ port, token: undefined, getStateSnapshot: defaultSnapshot })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port)
    clients.push(ws)

    const res = await sendFsRequest(ws, "fs.mutate", { op: "mkdir", path: "newdir" })
    expect(res.ok).toBe(true)
    const stat = await fs.stat(path.join(tmpDir, "newdir"))
    expect(stat.isDirectory()).toBe(true)
  })

  // --- 異常系: バリデーション ---

  it("fs.request: 引数不正で ok:false / code: BAD_ARGS", async () => {
    const port = nextPort()
    server = createSessionWsServer({ port, token: undefined, getStateSnapshot: defaultSnapshot })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port)
    clients.push(ws)

    // fs.list は { path: string } を要求するので path欠落でBAD_ARGS
    const res = await sendFsRequest(ws, "fs.list", {})
    expect(res.ok).toBe(false)
    const err = res.error as { message: string; code: string }
    expect(err.code).toBe("BAD_ARGS")
  })

  it("fs.request: 未知methodはBAD_REQUEST（公開subset外）", async () => {
    const port = nextPort()
    server = createSessionWsServer({ port, token: undefined, getStateSnapshot: defaultSnapshot })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port)
    clients.push(ws)

    // fs.importFile はWS公開subsetから除外されている（fsRpcMethodSchema）
    const res = await sendFsRequest(ws, "fs.importFile", { sourcePath: "/etc/passwd", destPath: "x.txt" })
    expect(res.ok).toBe(false)
    const err = res.error as { message: string; code: string }
    expect(err.code).toBe("BAD_REQUEST")
  })

  it("fs.request: サービス例外はok:false（FS_ERROR）", async () => {
    const port = nextPort()
    server = createSessionWsServer({ port, token: undefined, getStateSnapshot: defaultSnapshot })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port)
    clients.push(ws)

    // 存在しないファイルの読み取り → ENOENT
    const res = await sendFsRequest(ws, "fs.read", { path: "missing.txt" })
    expect(res.ok).toBe(false)
    const err = res.error as { message: string; code: string }
    expect(err.code).toBe("FS_ERROR")
  })

  // --- サンドボックス維持 ---

  it("fs.request: AVATAR_SPACE外アクセスは拒否される", async () => {
    const port = nextPort()
    server = createSessionWsServer({ port, token: undefined, getStateSnapshot: defaultSnapshot })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port)
    clients.push(ws)

    // ../ で外に出ようとするとassertInAvatarSpaceがthrow
    const res = await sendFsRequest(ws, "fs.list", { path: "../../../" })
    expect(res.ok).toBe(false)
    const err = res.error as { message: string; code: string }
    expect(err.message).toMatch(/Avatar Space外/)
  })

  it("fs.request: refs/配下への書き込みは拒否される", async () => {
    await fs.mkdir(path.join(tmpDir, "refs"), { recursive: true })

    const port = nextPort()
    server = createSessionWsServer({ port, token: undefined, getStateSnapshot: defaultSnapshot })
    await startAndWait(server)

    const { ws } = await connectWithFirstMessage(port)
    clients.push(ws)

    const res = await sendFsRequest(ws, "fs.write", { path: "refs/forbidden.txt", content: "x" })
    expect(res.ok).toBe(false)
    const err = res.error as { message: string; code: string }
    expect(err.message).toMatch(/refs\/は読み取り専用/)
  })
})
