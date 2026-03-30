import { describe, it, expect, vi, afterEach } from "vitest"
import * as http from "node:http"
import * as crypto from "node:crypto"
import { startXWebhookServer } from "./x-webhook-server.js"
import type { XEvent } from "./x-event-formatter.js"

const TEST_SECRET = "test-consumer-secret"
const TEST_USER_ID = "self_user_123"

vi.mock("../config.js", () => ({
  getConfig: () => ({
    xConsumerSecret: TEST_SECRET,
    xUserId: TEST_USER_ID,
    xWebhookPort: 0, // テストでは動的ポートを使用
  }),
}))

vi.mock("./x-dedupe-repository.js", () => ({
  markSeen: vi.fn().mockReturnValue(true),
}))

vi.mock("../logger.js", () => ({
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

let server: http.Server | null = null

function getPort(s: http.Server): number {
  const addr = s.address()
  if (typeof addr === "object" && addr) return addr.port
  throw new Error("サーバーアドレス取得失敗")
}

function request(
  port: number,
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    }, (res) => {
      let data = ""
      res.on("data", (chunk) => { data += chunk })
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    req.on("error", reject)
    if (body) req.write(body)
    req.end()
  })
}

afterEach(() => {
  if (server) {
    server.close()
    server = null
  }
})

describe("CRC検証（GET /x/webhook）", () => {
  it("crc_tokenにHMAC-SHA256で応答する", async () => {
    const events: XEvent[] = []
    server = startXWebhookServer((ev) => events.push(ev), 0)
    await new Promise<void>((r) => server!.on("listening", r))
    const port = getPort(server)

    const crcToken = "test_crc_token"
    const expectedHmac = crypto.createHmac("sha256", TEST_SECRET).update(crcToken).digest("base64")

    const res = await request(port, "GET", `/x/webhook?crc_token=${crcToken}`)
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as { response_token: string }
    expect(data.response_token).toBe(`sha256=${expectedHmac}`)
  })

  it("crc_tokenがない場合は400", async () => {
    const events: XEvent[] = []
    server = startXWebhookServer((ev) => events.push(ev), 0)
    await new Promise<void>((r) => server!.on("listening", r))
    const port = getPort(server)

    const res = await request(port, "GET", "/x/webhook")
    expect(res.status).toBe(400)
  })
})

describe("イベント受信（POST /x/webhook）", () => {
  it("有効な署名付きメンションを処理する", async () => {
    const events: XEvent[] = []
    server = startXWebhookServer((ev) => events.push(ev), 0)
    await new Promise<void>((r) => server!.on("listening", r))
    const port = getPort(server)

    const payload = JSON.stringify({
      for_user_id: TEST_USER_ID,
      tweet_create_events: [{
        id_str: "tweet_789",
        text: "@spectra_aui hello!",
        user: {
          id_str: "other_user_456",
          screen_name: "someone",
        },
        favorite_count: 3,
        retweet_count: 1,
      }],
    })

    const signature = "sha256=" + crypto.createHmac("sha256", TEST_SECRET).update(payload).digest("base64")

    const res = await request(port, "POST", "/x/webhook", payload, {
      "x-twitter-webhooks-signature": signature,
    })

    expect(res.status).toBe(200)
    // イベントが非同期処理されるため少し待つ
    await new Promise((r) => setTimeout(r, 50))
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("x_mention")
    expect(events[0].username).toBe("someone")
    expect(events[0].tweetId).toBe("tweet_789")
  })

  it("署名なしは401", async () => {
    const events: XEvent[] = []
    server = startXWebhookServer((ev) => events.push(ev), 0)
    await new Promise<void>((r) => server!.on("listening", r))
    const port = getPort(server)

    const res = await request(port, "POST", "/x/webhook", "{}")
    expect(res.status).toBe(401)
  })

  it("不正な署名は401", async () => {
    const events: XEvent[] = []
    server = startXWebhookServer((ev) => events.push(ev), 0)
    await new Promise<void>((r) => server!.on("listening", r))
    const port = getPort(server)

    const res = await request(port, "POST", "/x/webhook", "{}", {
      "x-twitter-webhooks-signature": "sha256=invalid",
    })
    expect(res.status).toBe(401)
  })

  it("自己投稿はスキップ", async () => {
    const events: XEvent[] = []
    server = startXWebhookServer((ev) => events.push(ev), 0)
    await new Promise<void>((r) => server!.on("listening", r))
    const port = getPort(server)

    const payload = JSON.stringify({
      tweet_create_events: [{
        id_str: "self_tweet",
        text: "自分のポスト",
        user: {
          id_str: TEST_USER_ID, // 自分のID
          screen_name: "self",
        },
      }],
    })

    const signature = "sha256=" + crypto.createHmac("sha256", TEST_SECRET).update(payload).digest("base64")

    const res = await request(port, "POST", "/x/webhook", payload, {
      "x-twitter-webhooks-signature": signature,
    })

    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))
    expect(events).toHaveLength(0)
  })
})

describe("その他のルート", () => {
  it("未知のパスは404", async () => {
    server = startXWebhookServer(() => {}, 0)
    await new Promise<void>((r) => server!.on("listening", r))
    const port = getPort(server)

    const res = await request(port, "GET", "/unknown")
    expect(res.status).toBe(404)
  })
})
