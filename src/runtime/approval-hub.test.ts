import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../logger.js", () => ({
  info: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}))

import {
  registerApprover,
  unregisterApprover,
  request,
  respond,
  getApproverCount,
  _resetForTest,
} from "./approval-hub.js"
import type { Approver, ApprovalEnvelope } from "./approval-hub.js"

// テスト用のモック承認者を作成する
function createMockApprover(id: string): Approver & { lastRequest: ApprovalEnvelope | null } {
  const approver = {
    approverId: id,
    label: `Test ${id}`,
    lastRequest: null as ApprovalEnvelope | null,
    sendRequest: vi.fn((req: ApprovalEnvelope) => {
      approver.lastRequest = req
    }),
  }
  return approver
}

describe("approval-hub", () => {
  beforeEach(() => {
    _resetForTest()
  })

  it("承認者0件で即deny", async () => {
    const result = await request("x_post", { text: "test" })
    expect(result.approved).toBe(false)
    expect(result.reason).toBe("NO_APPROVER")
  })

  it("承認者1件で承認リクエストが配送される", async () => {
    const approver = createMockApprover("console:1")
    registerApprover(approver)

    const promise = request("x_post", { text: "test" })
    expect(approver.sendRequest).toHaveBeenCalledOnce()

    // 承認応答
    const requestId = approver.lastRequest!.requestId
    const respondResult = respond(requestId, "approve")
    expect(respondResult.ok).toBe(true)

    const result = await promise
    expect(result.approved).toBe(true)
    expect(result.reason).toBe("USER_APPROVED")
  })

  it("denyが正しく動作する", async () => {
    const approver = createMockApprover("console:1")
    registerApprover(approver)

    const promise = request("x_post", { text: "test" })
    const requestId = approver.lastRequest!.requestId
    respond(requestId, "deny")

    const result = await promise
    expect(result.approved).toBe(false)
    expect(result.reason).toBe("USER_DENIED")
  })

  it("first-response-wins: 2件目の応答はREQUEST_NOT_FOUND", async () => {
    const a1 = createMockApprover("console:1")
    const a2 = createMockApprover("discord:1")
    registerApprover(a1)
    registerApprover(a2)

    const promise = request("x_reply", { text: "test" })
    const requestId = a1.lastRequest!.requestId

    // 1件目: 承認
    const r1 = respond(requestId, "approve")
    expect(r1.ok).toBe(true)

    // 2件目: 同じrequestIdに応答 → 既に解決済み
    const r2 = respond(requestId, "deny")
    expect(r2).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" })

    const result = await promise
    expect(result.approved).toBe(true)
  })

  it("承認者解除後も他の承認者が残ればpending継続", async () => {
    const a1 = createMockApprover("console:1")
    const a2 = createMockApprover("discord:1")
    registerApprover(a1)
    registerApprover(a2)

    const promise = request("roblox_action", { ops: [] })
    const requestId = a1.lastRequest!.requestId

    // console承認者を解除
    unregisterApprover("console:1")
    expect(getApproverCount()).toBe(1)

    // discord承認者で応答
    const r = respond(requestId, "approve")
    expect(r.ok).toBe(true)

    const result = await promise
    expect(result.approved).toBe(true)
  })

  it("全承認者が解除されたらpendingが即deny", async () => {
    const a1 = createMockApprover("console:1")
    registerApprover(a1)

    const promise = request("terminal", { command: "ls" })

    // 唯一の承認者を解除
    unregisterApprover("console:1")

    const result = await promise
    expect(result.approved).toBe(false)
    expect(result.reason).toBe("NO_APPROVER")
  })

  it("registerApproverの戻り値で登録解除できる", () => {
    const approver = createMockApprover("console:1")
    const unregister = registerApprover(approver)
    expect(getApproverCount()).toBe(1)

    unregister()
    expect(getApproverCount()).toBe(0)
  })

  it("sendRequestがthrowしても他の承認者に配送される", async () => {
    const broken = createMockApprover("broken:1")
    broken.sendRequest = vi.fn(() => { throw new Error("配送失敗") })

    const working = createMockApprover("working:1")

    registerApprover(broken)
    registerApprover(working)

    const promise = request("x_post", { text: "test" })
    expect(working.sendRequest).toHaveBeenCalledOnce()

    const requestId = working.lastRequest!.requestId
    respond(requestId, "approve")

    const result = await promise
    expect(result.approved).toBe(true)
  })

  it("存在しないrequestIdへの応答はREQUEST_NOT_FOUND", () => {
    const result = respond("nonexistent", "approve")
    expect(result).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" })
  })

  it("タイムアウトで自動deny（TIMEOUT）", async () => {
    vi.useFakeTimers()
    const approver = createMockApprover("console:1")
    registerApprover(approver)

    const promise = request("x_post", { text: "test" }, 5000)
    expect(approver.sendRequest).toHaveBeenCalledOnce()

    // 5秒経過 → タイムアウト
    vi.advanceTimersByTime(5000)

    const result = await promise
    expect(result.approved).toBe(false)
    expect(result.reason).toBe("TIMEOUT")

    // タイムアウト後のrespondはREQUEST_NOT_FOUND
    const requestId = approver.lastRequest!.requestId
    const respondResult = respond(requestId, "approve")
    expect(respondResult).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" })

    vi.useRealTimers()
  })

  it("タイムアウト前に承認すればタイマーはクリアされる", async () => {
    vi.useFakeTimers()
    const approver = createMockApprover("console:1")
    registerApprover(approver)

    const promise = request("x_post", { text: "test" }, 5000)
    const requestId = approver.lastRequest!.requestId

    // 3秒後に承認
    vi.advanceTimersByTime(3000)
    respond(requestId, "approve")

    const result = await promise
    expect(result.approved).toBe(true)
    expect(result.reason).toBe("USER_APPROVED")

    vi.useRealTimers()
  })

  it("timeoutMs=0ではタイムアウトしない", async () => {
    vi.useFakeTimers()
    const approver = createMockApprover("console:1")
    registerApprover(approver)

    const promise = request("x_post", { text: "test" }, 0)

    // 大量の時間が経過してもタイムアウトしない
    vi.advanceTimersByTime(999_999)

    // 手動で承認して解決
    const requestId = approver.lastRequest!.requestId
    respond(requestId, "approve")

    const result = await promise
    expect(result.approved).toBe(true)

    vi.useRealTimers()
  })
})
