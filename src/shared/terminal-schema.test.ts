import { describe, it, expect } from "vitest"
import {
  terminalInputSchema,
  terminalResizeSchema,
  TERMINAL_CHANNELS,
} from "./terminal-schema.js"

describe("terminal-schema", () => {
  describe("terminalInputSchema", () => {
    it("正常: 文字列データ", () => {
      const r = terminalInputSchema.safeParse({ data: "ls\n" })
      expect(r.success).toBe(true)
    })

    it("正常: 空文字（Ctrl+Cなど制御文字）", () => {
      const r = terminalInputSchema.safeParse({ data: "\x03" })
      expect(r.success).toBe(true)
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
