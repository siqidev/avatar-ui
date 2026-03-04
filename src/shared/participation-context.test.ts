import { describe, it, expect } from "vitest"
import {
  generateCorrelationId,
  createParticipationInput,
} from "./participation-context.js"
import type { ParticipationInput } from "./participation-context.js"

describe("participation-context", () => {
  describe("generateCorrelationId", () => {
    it("user: UUID形式を返す", () => {
      const id = generateCorrelationId("user")
      // UUID v4: 8-4-4-4-12
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
    })

    it("pulse: pulse-プレフィックスを返す", () => {
      const id = generateCorrelationId("pulse")
      expect(id).toMatch(/^pulse-\d+$/)
    })

    it("observation: obs-プレフィックスを返す", () => {
      const id = generateCorrelationId("observation")
      expect(id).toMatch(/^obs-\d+$/)
    })

    it("同一source呼び出しでも異なるIDを返す", () => {
      const id1 = generateCorrelationId("user")
      const id2 = generateCorrelationId("user")
      expect(id1).not.toBe(id2)
    })
  })

  describe("createParticipationInput", () => {
    it("正しい構造のParticipationInputを返す", () => {
      const input: ParticipationInput = createParticipationInput(
        "human",
        "user",
        "こんにちは",
      )

      expect(input.actor).toBe("human")
      expect(input.source).toBe("user")
      expect(input.text).toBe("こんにちは")
      expect(input.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
      expect(input.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it("AI起点のpulseを生成できる", () => {
      const input = createParticipationInput("ai", "pulse", "定期確認")

      expect(input.actor).toBe("ai")
      expect(input.source).toBe("pulse")
      expect(input.correlationId).toMatch(/^pulse-\d+$/)
    })

    it("観測入力を生成できる", () => {
      const input = createParticipationInput(
        "human",
        "observation",
        "[Roblox] PlayerJoined",
      )

      expect(input.actor).toBe("human")
      expect(input.source).toBe("observation")
      expect(input.correlationId).toMatch(/^obs-\d+$/)
    })
  })
})
