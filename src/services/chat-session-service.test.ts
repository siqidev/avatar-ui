import { describe, it, expect } from "vitest"
import {
  resolveDisplayText,
  type ToolCallInfo,
} from "./chat-session-service.js"

describe("resolveDisplayText", () => {
  it("roblox_act avatar sayがあれば発話テキストを返す", () => {
    const toolCalls: ToolCallInfo[] = [
      {
        name: "roblox_act",
        args: {
          channel: "avatar",
          ops: [
            { op: "say", text: "やあ Sito！" },
            { op: "emote", name: "wave" },
          ],
          reason: "挨拶するため",
        },
        result: "{\"status\":\"ok\"}",
      },
    ]

    expect(resolveDisplayText("メタ記述", toolCalls)).toBe("やあ Sito！")
  })

  it("avatar sayがなければ元テキストを返す", () => {
    const toolCalls: ToolCallInfo[] = [
      {
        name: "roblox_act",
        args: {
          channel: "world",
          ops: [{ op: "part.create", name: "Cube" }],
          reason: "オブジェクトを置くため",
        },
        result: "{\"status\":\"ok\"}",
      },
    ]

    expect(resolveDisplayText("従来テキスト", toolCalls)).toBe("従来テキスト")
  })

  it("複数のavatar sayがあれば改行結合する", () => {
    const toolCalls: ToolCallInfo[] = [
      {
        name: "roblox_act",
        args: {
          channel: "avatar",
          ops: [
            { op: "say", text: "こんにちは" },
            { op: "say", text: "またね" },
          ],
          reason: "会話するため",
        },
        result: "{\"status\":\"ok\"}",
      },
      {
        name: "roblox_act",
        args: {
          channel: "avatar",
          ops: [{ op: "say", text: "気をつけて" }],
          reason: "見送るため",
        },
        result: "{\"status\":\"ok\"}",
      },
    ]

    expect(resolveDisplayText("メタ記述", toolCalls)).toBe(
      "こんにちは\nまたね\n気をつけて",
    )
  })
})
