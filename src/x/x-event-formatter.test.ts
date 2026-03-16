import { describe, it, expect } from "vitest"
import { formatXEvent, formatXEventForAI } from "./x-event-formatter.js"
import type { XMentionEvent } from "./x-event-formatter.js"

const mentionEvent: XMentionEvent = {
  type: "x_mention",
  tweetId: "123456",
  userId: "user1",
  username: "testuser",
  text: "こんにちは @spectra_aui",
}

describe("formatXEvent", () => {
  it("メンションイベントを表示用に整形する", () => {
    const result = formatXEvent(mentionEvent)
    expect(result).toBe("[Mention] @testuser: こんにちは @spectra_aui")
  })

  it("メトリクスがあれば付加する", () => {
    const withMetrics: XMentionEvent = {
      ...mentionEvent,
      metrics: { like_count: 5, retweet_count: 2, reply_count: 1 },
    }
    const result = formatXEvent(withMetrics)
    expect(result).toBe("[Mention] @testuser: こんにちは @spectra_aui [♡5 ↻2 💬1]")
  })

  it("メトリクスが0でも表示する", () => {
    const withZeroMetrics: XMentionEvent = {
      ...mentionEvent,
      metrics: { like_count: 0, retweet_count: 0, reply_count: 0 },
    }
    const result = formatXEvent(withZeroMetrics)
    expect(result).toContain("[♡0 ↻0 💬0]")
  })

  it("メトリクスの一部がundefinedでもデフォルト0", () => {
    const partial: XMentionEvent = {
      ...mentionEvent,
      metrics: { like_count: 3 },
    }
    const result = formatXEvent(partial)
    expect(result).toContain("[♡3 ↻0 💬0]")
  })
})

describe("formatXEventForAI", () => {
  it("AI入力用の固定プレフィックスを含む", () => {
    const result = formatXEventForAI(mentionEvent)
    expect(result).toContain("[X観測: mention]")
  })

  it("tweet_idを含む（AI応答時に返信先として使用）", () => {
    const result = formatXEventForAI(mentionEvent)
    expect(result).toContain("tweet_id: 123456")
  })

  it("ユーザー名とテキストを含む", () => {
    const result = formatXEventForAI(mentionEvent)
    expect(result).toContain("@testuser")
    expect(result).toContain("こんにちは @spectra_aui")
  })
})
