import { describe, it, expect } from "vitest"
import { getAllowedTools, isToolAllowed } from "./input-gate.js"

describe("input-gate", () => {
  describe("getAllowedTools", () => {
    it("user/console: 全ツール許可", () => {
      const tools = getAllowedTools("user", "console")
      expect(tools).toContain("roblox_action")
      expect(tools).toContain("x_post")
      expect(tools).toContain("x_reply")
      expect(tools).toContain("terminal")
      expect(tools).toContain("fs_write")
    })

    it("pulse/console: 全ツール許可（自発ポスト可能）", () => {
      const tools = getAllowedTools("pulse", "console")
      expect(tools).toContain("x_post")
      expect(tools).toContain("roblox_action")
    })

    it("observation/roblox: roblox_action + 読み取り系のみ", () => {
      const tools = getAllowedTools("observation", "roblox")
      expect(tools).toContain("roblox_action")
      expect(tools).toContain("save_memory")
      expect(tools).toContain("fs_list")
      expect(tools).toContain("fs_read")
      expect(tools).not.toContain("x_post")
      expect(tools).not.toContain("terminal")
      expect(tools).not.toContain("fs_write")
      expect(tools).not.toContain("fs_mutate")
    })

    it("observation/x: x_reply + 読み取り系のみ", () => {
      const tools = getAllowedTools("observation", "x")
      expect(tools).toContain("x_reply")
      expect(tools).toContain("save_memory")
      expect(tools).toContain("fs_list")
      expect(tools).toContain("fs_read")
      expect(tools).not.toContain("x_post")
      expect(tools).not.toContain("roblox_action")
      expect(tools).not.toContain("terminal")
      expect(tools).not.toContain("fs_write")
    })

    it("observation/console: 読み取り系のみ", () => {
      const tools = getAllowedTools("observation", "console")
      expect(tools).toContain("save_memory")
      expect(tools).toContain("fs_list")
      expect(tools).toContain("fs_read")
      expect(tools).not.toContain("x_post")
      expect(tools).not.toContain("roblox_action")
    })
  })

  describe("isToolAllowed", () => {
    it("user入力からx_postは許可される", () => {
      expect(isToolAllowed("x_post", "user", "console")).toBe(true)
    })

    it("observation/robloxからx_postは拒否される", () => {
      expect(isToolAllowed("x_post", "observation", "roblox")).toBe(false)
    })

    it("observation/robloxからroblox_actionは許可される", () => {
      expect(isToolAllowed("roblox_action", "observation", "roblox")).toBe(true)
    })

    it("observation/xからterminalは拒否される", () => {
      expect(isToolAllowed("terminal", "observation", "x")).toBe(false)
    })

    it("observation/xからx_replyは許可される", () => {
      expect(isToolAllowed("x_reply", "observation", "x")).toBe(true)
    })

    it("未知のツール名は拒否される", () => {
      expect(isToolAllowed("unknown_tool", "user", "console")).toBe(false)
    })
  })
})
