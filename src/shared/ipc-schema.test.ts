import { describe, it, expect } from "vitest"
import {
  toMainSchema,
  toRendererSchema,
  chatPostSchema,
  chatReplySchema,
  fieldStateSchema,
} from "./ipc-schema.js"

describe("ipc-schema", () => {
  describe("Renderer → Main", () => {
    it("channel.attach を受理", () => {
      const result = toMainSchema.safeParse({ type: "channel.attach" })
      expect(result.success).toBe(true)
    })

    it("channel.detach を受理", () => {
      const result = toMainSchema.safeParse({ type: "channel.detach" })
      expect(result.success).toBe(true)
    })

    it("chat.post を受理（全フィールド）", () => {
      const result = chatPostSchema.safeParse({
        type: "chat.post",
        actor: "human",
        correlationId: "abc-123",
        text: "こんにちは",
      })
      expect(result.success).toBe(true)
    })

    it("chat.post: textが空なら拒否", () => {
      const result = chatPostSchema.safeParse({
        type: "chat.post",
        actor: "human",
        correlationId: "abc-123",
        text: "",
      })
      expect(result.success).toBe(false)
    })

    it("chat.post: actorが不正なら拒否", () => {
      const result = chatPostSchema.safeParse({
        type: "chat.post",
        actor: "unknown",
        correlationId: "abc-123",
        text: "hello",
      })
      expect(result.success).toBe(false)
    })

    it("chat.post: correlationIdが空なら拒否", () => {
      const result = chatPostSchema.safeParse({
        type: "chat.post",
        actor: "human",
        correlationId: "",
        text: "hello",
      })
      expect(result.success).toBe(false)
    })

    it("field.terminate を受理", () => {
      const result = toMainSchema.safeParse({ type: "field.terminate" })
      expect(result.success).toBe(true)
    })

    it("未知のtypeを拒否", () => {
      const result = toMainSchema.safeParse({ type: "unknown.type" })
      expect(result.success).toBe(false)
    })
  })

  describe("Main → Renderer", () => {
    it("chat.reply を受理", () => {
      const result = chatReplySchema.safeParse({
        type: "chat.reply",
        actor: "ai",
        correlationId: "abc-123",
        text: "やっほー！",
      })
      expect(result.success).toBe(true)
    })

    it("field.state を受理（lastMessagesなし）", () => {
      const result = fieldStateSchema.safeParse({
        type: "field.state",
        state: "active",
      })
      expect(result.success).toBe(true)
    })

    it("field.state を受理（lastMessagesあり）", () => {
      const result = fieldStateSchema.safeParse({
        type: "field.state",
        state: "resumed",
        lastMessages: [
          { actor: "human", text: "こんにちは" },
          { actor: "ai", text: "やっほー" },
        ],
      })
      expect(result.success).toBe(true)
    })

    it("field.state: 不正な状態を拒否", () => {
      const result = fieldStateSchema.safeParse({
        type: "field.state",
        state: "unknown",
      })
      expect(result.success).toBe(false)
    })

    it("integrity.alert を受理", () => {
      const result = toRendererSchema.safeParse({
        type: "integrity.alert",
        code: "FSM_VIOLATION",
        message: "不正な状態遷移",
      })
      expect(result.success).toBe(true)
    })
  })
})
