import { describe, it, expect } from "vitest"
import {
  toMainSchema,
  toRendererSchema,
  streamPostSchema,
  streamReplySchema,
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

    it("stream.post を受理（全フィールド）", () => {
      const result = streamPostSchema.safeParse({
        type: "stream.post",
        actor: "human",
        correlationId: "abc-123",
        text: "こんにちは",
      })
      expect(result.success).toBe(true)
    })

    it("stream.post: textが空なら拒否", () => {
      const result = streamPostSchema.safeParse({
        type: "stream.post",
        actor: "human",
        correlationId: "abc-123",
        text: "",
      })
      expect(result.success).toBe(false)
    })

    it("stream.post: actorが不正なら拒否", () => {
      const result = streamPostSchema.safeParse({
        type: "stream.post",
        actor: "unknown",
        correlationId: "abc-123",
        text: "hello",
      })
      expect(result.success).toBe(false)
    })

    it("stream.post: correlationIdが空なら拒否", () => {
      const result = streamPostSchema.safeParse({
        type: "stream.post",
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
    it("stream.reply を受理", () => {
      const result = streamReplySchema.safeParse({
        type: "stream.reply",
        actor: "ai",
        correlationId: "abc-123",
        text: "やっほー！",
        source: "user",
      })
      expect(result.success).toBe(true)
    })

    it("field.state を受理（lastMessagesなし）", () => {
      const result = fieldStateSchema.safeParse({
        type: "field.state",
        state: "active",
        avatarName: "Spectra",
        userName: "User",
      })
      expect(result.success).toBe(true)
    })

    it("field.state を受理（lastMessagesあり）", () => {
      const result = fieldStateSchema.safeParse({
        type: "field.state",
        state: "resumed",
        avatarName: "Spectra",
        userName: "User",
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
        avatarName: "Spectra",
        userName: "User",
      })
      expect(result.success).toBe(false)
    })

    it("integrity.alert を受理（有効なAlertCode）", () => {
      const result = toRendererSchema.safeParse({
        type: "integrity.alert",
        code: "FIELD_CONTRACT_VIOLATION",
        message: "不正な状態遷移",
      })
      expect(result.success).toBe(true)
    })

    it("integrity.alert: 未知のcodeを拒否", () => {
      const result = toRendererSchema.safeParse({
        type: "integrity.alert",
        code: "UNKNOWN_CODE",
        message: "不明",
      })
      expect(result.success).toBe(false)
    })
  })
})
