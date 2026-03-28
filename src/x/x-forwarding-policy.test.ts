import { describe, it, expect } from "vitest"
import { shouldForwardXEventToAI } from "./x-forwarding-policy.js"
import type { XEvent } from "./x-event-formatter.js"

describe("shouldForwardXEventToAI", () => {
  it("メンションイベントはAIに転送する", () => {
    const event: XEvent = {
      type: "x_mention",
      tweetId: "123",
      userId: "user1",
      username: "someone",
      text: "hello",
    }
    expect(shouldForwardXEventToAI(event)).toBe(true)
  })
})
