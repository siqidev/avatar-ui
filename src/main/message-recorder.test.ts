import { describe, it, expect, vi, beforeEach } from "vitest"
import { recordMessage } from "./message-recorder.js"
import { _resetConfigForTest } from "../config.js"

// field-runtime の appendMessage をモック
vi.mock("../runtime/field-runtime.js", () => ({
  appendMessage: vi.fn(),
}))

import { appendMessage } from "../runtime/field-runtime.js"
const mockAppendMessage = vi.mocked(appendMessage)

describe("message-recorder", () => {
  beforeEach(() => {
    _resetConfigForTest({ XAI_API_KEY: "test-key" })
    mockAppendMessage.mockClear()
  })

  it("actor + text のみで記録する", () => {
    recordMessage("human", "こんにちは")

    expect(mockAppendMessage).toHaveBeenCalledOnce()
    expect(mockAppendMessage).toHaveBeenCalledWith({
      actor: "human",
      text: "こんにちは",
    })
  })

  it("source + channel付きで記録する", () => {
    recordMessage("ai", "応答", "pulse", "console")

    expect(mockAppendMessage).toHaveBeenCalledWith({
      actor: "ai",
      text: "応答",
      source: "pulse",
      channel: "console",
    })
  })

  it("toolCalls付きで記録する（name + args + result を保持）", () => {
    recordMessage("ai", "保存しました", "user", "console", [
      { name: "save_memory", args: { text: "test" }, result: "ok" },
    ])

    expect(mockAppendMessage).toHaveBeenCalledWith({
      actor: "ai",
      text: "保存しました",
      source: "user",
      channel: "console",
      toolCalls: [{ name: "save_memory", args: { text: "test" }, result: "ok" }],
    })
  })

  it("toolCallsが空配列なら省略する", () => {
    recordMessage("ai", "テスト", "user", "console", [])

    const call = mockAppendMessage.mock.calls[0][0]
    expect(call).not.toHaveProperty("toolCalls")
  })

  it("sourceがundefinedなら省略する", () => {
    recordMessage("human", "テスト")

    const call = mockAppendMessage.mock.calls[0][0]
    expect(call).not.toHaveProperty("source")
  })
})
