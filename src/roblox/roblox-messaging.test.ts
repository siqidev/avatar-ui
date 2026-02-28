import { describe, it, expect, vi, beforeEach } from "vitest"
import { publishMessage } from "./roblox-messaging.js"
import { _resetConfigForTest } from "../config.js"

describe("roblox-messaging", () => {
  beforeEach(() => {
    _resetConfigForTest({ XAI_API_KEY: "test-key" })
    vi.restoreAllMocks()
  })

  it("正常送信でok()を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true }),
    )

    const result = await publishMessage(
      "test-api-key",
      "12345",
      "AICommands",
      JSON.stringify({ action: "move_to", params: { x: 10, z: 20 } }),
    )

    expect(result.success).toBe(true)

    const call = vi.mocked(fetch).mock.calls[0]
    expect(call[0]).toContain("/universes/12345:publishMessage")
    const init = call[1] as RequestInit
    expect(init.headers).toEqual({
      "x-api-key": "test-api-key",
      "Content-Type": "application/json",
    })
    const body = JSON.parse(init.body as string)
    expect(body.topic).toBe("AICommands")
  })

  it("1KBを超えるメッセージはfail()を返す", async () => {
    const largeMessage = "x".repeat(1025)
    const result = await publishMessage(
      "test-api-key",
      "12345",
      "AICommands",
      largeMessage,
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe("MESSAGE_TOO_LARGE")
    }
  })

  it("HTTPエラー時にfail()を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      }),
    )

    const result = await publishMessage(
      "bad-key",
      "12345",
      "AICommands",
      "test",
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe("ROBLOX_PUBLISH_FAILED")
      expect(result.error.message).toContain("403")
    }
  })

  it("ネットワークエラー時にfail()を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    )

    const result = await publishMessage(
      "test-api-key",
      "12345",
      "AICommands",
      "test",
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe("ROBLOX_PUBLISH_FAILED")
      expect(result.error.message).toContain("ECONNREFUSED")
    }
  })
})
