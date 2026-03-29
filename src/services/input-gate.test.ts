import { describe, it, expect } from "vitest"
import { getAllowedTools, isToolAllowed } from "./input-gate.js"

describe("input-gate", () => {
  describe("getAllowedTools", () => {
    // --- owner（デフォルト） ---
    it("user/console/owner: 全ツール許可", () => {
      const tools = getAllowedTools("user", "console")
      expect(tools).toContain("roblox_action")
      expect(tools).toContain("x_post")
      expect(tools).toContain("x_reply")
      expect(tools).toContain("terminal")
      expect(tools).toContain("fs_write")
    })

    it("pulse/console: 全ツール許可（source=pulseで常に許可）", () => {
      const tools = getAllowedTools("pulse", "console")
      expect(tools).toContain("x_post")
      expect(tools).toContain("roblox_action")
      expect(tools).toContain("terminal")
    })

    it("xpulse/x: 全ツール許可（source=xpulseで常に許可）", () => {
      const tools = getAllowedTools("xpulse", "x")
      expect(tools).toContain("x_post")
      expect(tools).toContain("fs_list")
      expect(tools).toContain("fs_read")
      expect(tools).toContain("terminal")
    })

    it("observation/roblox/owner: 全ツール許可", () => {
      const tools = getAllowedTools("observation", "roblox", "owner")
      expect(tools).toContain("roblox_action")
      expect(tools).toContain("x_post")
      expect(tools).toContain("terminal")
      expect(tools).toContain("fs_write")
    })

    it("observation/x/owner: 全ツール許可", () => {
      const tools = getAllowedTools("observation", "x", "owner")
      expect(tools).toContain("x_reply")
      expect(tools).toContain("x_post")
      expect(tools).toContain("terminal")
      expect(tools).toContain("fs_write")
    })

    // --- external ---
    it("observation/roblox/external: roblox_actionのみ", () => {
      const tools = getAllowedTools("observation", "roblox", "external")
      expect(tools).toEqual(["roblox_action"])
    })

    it("observation/x/external: x_replyのみ", () => {
      const tools = getAllowedTools("observation", "x", "external")
      expect(tools).toEqual(["x_reply"])
    })

    it("observation/console/external: 空（ツールなし）", () => {
      const tools = getAllowedTools("observation", "console", "external")
      expect(tools).toEqual([])
    })

    it("observation/discord/external: 空（ツールなし）", () => {
      const tools = getAllowedTools("observation", "discord", "external")
      expect(tools).toEqual([])
    })

    // --- source=user/pulse/xpulse は role を無視して常に全ツール ---
    it("user/console/external でも全ツール（sourceがuser）", () => {
      const tools = getAllowedTools("user", "console", "external")
      expect(tools).toContain("terminal")
      expect(tools).toContain("fs_write")
    })

    it("pulse/console/external でも全ツール（sourceがpulse）", () => {
      const tools = getAllowedTools("pulse", "console", "external")
      expect(tools).toContain("x_post")
    })
  })

  describe("isToolAllowed", () => {
    // owner
    it("owner: observation/robloxからx_postは許可される", () => {
      expect(isToolAllowed("x_post", "observation", "roblox", "owner")).toBe(true)
    })

    it("owner: observation/xからterminalは許可される", () => {
      expect(isToolAllowed("terminal", "observation", "x", "owner")).toBe(true)
    })

    // external
    it("external: observation/robloxからx_postは拒否される", () => {
      expect(isToolAllowed("x_post", "observation", "roblox", "external")).toBe(false)
    })

    it("external: observation/robloxからroblox_actionは許可される", () => {
      expect(isToolAllowed("roblox_action", "observation", "roblox", "external")).toBe(true)
    })

    it("external: observation/xからterminalは拒否される", () => {
      expect(isToolAllowed("terminal", "observation", "x", "external")).toBe(false)
    })

    it("external: observation/xからx_replyは許可される", () => {
      expect(isToolAllowed("x_reply", "observation", "x", "external")).toBe(true)
    })

    it("external: observation/xからfs_readは拒否される", () => {
      expect(isToolAllowed("fs_read", "observation", "x", "external")).toBe(false)
    })

    it("未知のツール名は拒否される", () => {
      expect(isToolAllowed("unknown_tool", "user", "console")).toBe(false)
    })
  })
})
