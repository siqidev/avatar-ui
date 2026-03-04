import { describe, it, expect } from "vitest"
import {
  terminalExecSchema,
  terminalStdinSchema,
  terminalStopSchema,
  terminalResizeSchema,
  TERMINAL_CHANNELS,
} from "./terminal-schema.js"

describe("terminal-schema", () => {
  describe("terminalExecSchema", () => {
    it("正常: 必須フィールドのみ", () => {
      const r = terminalExecSchema.safeParse({
        actor: "human",
        correlationId: "abc-123",
        cmd: "ls -la",
      })
      expect(r.success).toBe(true)
    })

    it("正常: timeoutMs付き", () => {
      const r = terminalExecSchema.safeParse({
        actor: "ai",
        correlationId: "x",
        cmd: "echo hello",
        timeoutMs: 60000,
      })
      expect(r.success).toBe(true)
    })

    it("拒否: cmd空文字", () => {
      const r = terminalExecSchema.safeParse({
        actor: "human",
        correlationId: "x",
        cmd: "",
      })
      expect(r.success).toBe(false)
    })

    it("拒否: actorが不正", () => {
      const r = terminalExecSchema.safeParse({
        actor: "system",
        correlationId: "x",
        cmd: "ls",
      })
      expect(r.success).toBe(false)
    })

    it("拒否: timeoutMs範囲外", () => {
      const r = terminalExecSchema.safeParse({
        actor: "human",
        correlationId: "x",
        cmd: "ls",
        timeoutMs: 500,
      })
      expect(r.success).toBe(false)
    })
  })

  describe("terminalStdinSchema", () => {
    it("正常", () => {
      const r = terminalStdinSchema.safeParse({
        actor: "human",
        correlationId: "x",
        data: "y\n",
      })
      expect(r.success).toBe(true)
    })
  })

  describe("terminalStopSchema", () => {
    it("正常: signalなし", () => {
      const r = terminalStopSchema.safeParse({
        actor: "human",
        correlationId: "x",
      })
      expect(r.success).toBe(true)
    })

    it("正常: SIGKILL指定", () => {
      const r = terminalStopSchema.safeParse({
        actor: "ai",
        correlationId: "x",
        signal: "SIGKILL",
      })
      expect(r.success).toBe(true)
    })

    it("拒否: 不正signal", () => {
      const r = terminalStopSchema.safeParse({
        actor: "human",
        correlationId: "x",
        signal: "SIGSTOP",
      })
      expect(r.success).toBe(false)
    })
  })

  describe("terminalResizeSchema", () => {
    it("正常", () => {
      const r = terminalResizeSchema.safeParse({ cols: 80, rows: 24 })
      expect(r.success).toBe(true)
    })

    it("拒否: cols=0", () => {
      const r = terminalResizeSchema.safeParse({ cols: 0, rows: 24 })
      expect(r.success).toBe(false)
    })
  })

  describe("TERMINAL_CHANNELS", () => {
    it("チャンネル名がterminal.プレフィックス", () => {
      for (const ch of Object.values(TERMINAL_CHANNELS)) {
        expect(ch).toMatch(/^terminal\./)
      }
    })
  })
})
