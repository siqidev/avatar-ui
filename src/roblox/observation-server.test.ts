import { describe, it, expect, afterEach } from "vitest"
import type { Server } from "node:http"
import { startObservationServer } from "./observation-server.js"
import type { ObservationEvent } from "./observation-server.js"

describe("observation-server", () => {
  let server: Server | null = null

  afterEach(() => {
    if (server) {
      server.close()
      server = null
    }
  })

  it("正常な観測イベントを受信してコールバックを呼ぶ", async () => {
    let received: ObservationEvent | null = null

    server = startObservationServer((event) => {
      received = event
    })

    // サーバー起動を待つ
    await new Promise((resolve) => server!.once("listening", resolve))

    const resp = await fetch("http://localhost:3000/observation", {
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
    server = startObservationServer(() => {})
    await new Promise((resolve) => server!.once("listening", resolve))

    const resp = await fetch("http://localhost:3000/observation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "invalid_type", payload: {} }),
    })

    expect(resp.status).toBe(400)
  })

  it("POST /observation以外は404を返す", async () => {
    server = startObservationServer(() => {})
    await new Promise((resolve) => server!.once("listening", resolve))

    const resp = await fetch("http://localhost:3000/other", {
      method: "GET",
    })

    expect(resp.status).toBe(404)
  })

  it("不正なJSONは400を返す", async () => {
    server = startObservationServer(() => {})
    await new Promise((resolve) => server!.once("listening", resolve))

    const resp = await fetch("http://localhost:3000/observation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    })

    expect(resp.status).toBe(400)
  })

  it("シークレット設定時、正しいBearerトークンで認証成功", async () => {
    let received: ObservationEvent | null = null
    server = startObservationServer((event) => {
      received = event
    }, "test-secret-123")
    await new Promise((resolve) => server!.once("listening", resolve))

    const resp = await fetch("http://localhost:3000/observation", {
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
    server = startObservationServer(() => {}, "test-secret-123")
    await new Promise((resolve) => server!.once("listening", resolve))

    const resp = await fetch("http://localhost:3000/observation", {
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
    server = startObservationServer(() => {}, "test-secret-123")
    await new Promise((resolve) => server!.once("listening", resolve))

    const resp = await fetch("http://localhost:3000/observation", {
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
