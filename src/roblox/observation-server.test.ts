import { describe, it, expect, afterEach } from "vitest"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { startObservationServer } from "./observation-server.js"
import type { ObservationEvent } from "./observation-server.js"

// テスト用: port 0でOS自動割り当て、実際のURLを返すヘルパー
async function startTestServer(
  handler: (event: ObservationEvent) => void,
  secret?: string,
): Promise<{ server: Server; baseUrl: string }> {
  const srv = startObservationServer(handler, secret, 0)
  await new Promise((resolve) => srv.once("listening", resolve))
  const addr = srv.address() as AddressInfo
  return { server: srv, baseUrl: `http://localhost:${addr.port}` }
}

describe("observation-server", () => {
  let server: Server | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()))
      server = null
    }
  })

  it("正常な観測イベントを受信してコールバックを呼ぶ", async () => {
    let received: ObservationEvent | null = null

    const t = await startTestServer((event) => {
      received = event
    })
    server = t.server

    const resp = await fetch(`${t.baseUrl}/observation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "player_chat",
        payload: { player: "testUser", message: "hello" },
      }),
    })

    expect(resp.status).toBe(200)
    expect(received).not.toBeNull()
    expect(received!.type).toBe("player_chat")
    expect(received!.payload.player).toBe("testUser")
  })

  it("不正なイベントは400を返す", async () => {
    const t = await startTestServer(() => {})
    server = t.server

    const resp = await fetch(`${t.baseUrl}/observation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "invalid_type", payload: {} }),
    })

    expect(resp.status).toBe(400)
  })

  it("POST /observation以外は404を返す", async () => {
    const t = await startTestServer(() => {})
    server = t.server

    const resp = await fetch(`${t.baseUrl}/other`, {
      method: "GET",
    })

    expect(resp.status).toBe(404)
  })

  it("不正なJSONは400を返す", async () => {
    const t = await startTestServer(() => {})
    server = t.server

    const resp = await fetch(`${t.baseUrl}/observation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    })

    expect(resp.status).toBe(400)
  })

  it("シークレット設定時、正しいBearerトークンで認証成功", async () => {
    let received: ObservationEvent | null = null
    const t = await startTestServer((event) => {
      received = event
    }, "test-secret-123")
    server = t.server

    const resp = await fetch(`${t.baseUrl}/observation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-secret-123",
      },
      body: JSON.stringify({
        type: "player_chat",
        payload: { player: "owner", message: "hi" },
      }),
    })

    expect(resp.status).toBe(200)
    expect(received).not.toBeNull()
    expect(received!.type).toBe("player_chat")
  })

  it("シークレット設定時、トークンなしは401を返す", async () => {
    const t = await startTestServer(() => {}, "test-secret-123")
    server = t.server

    const resp = await fetch(`${t.baseUrl}/observation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "player_chat",
        payload: { player: "hacker", message: "fake" },
      }),
    })

    expect(resp.status).toBe(401)
  })

  it("シークレット設定時、不正なトークンは401を返す", async () => {
    const t = await startTestServer(() => {}, "test-secret-123")
    server = t.server

    const resp = await fetch(`${t.baseUrl}/observation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-secret",
      },
      body: JSON.stringify({
        type: "player_chat",
        payload: { player: "hacker", message: "fake" },
      }),
    })

    expect(resp.status).toBe(401)
  })
})
