import { describe, it, expect } from "vitest"
import type { AppConfig } from "../config.js"
import {
  resolveConsoleRole,
  resolvePulseRole,
  resolveDiscordRole,
  resolveXRole,
  resolveRobloxRole,
} from "./input-role-resolver.js"

// テスト用の最小AppConfig（role判定に必要なフィールドのみ）
function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    discordOwnerId: undefined,
    xOwnerUserId: undefined,
    robloxOwnerUserId: undefined,
    ...overrides,
  } as AppConfig
}

describe("input-role-resolver", () => {
  describe("resolveConsoleRole", () => {
    it("常にownerを返す", () => {
      expect(resolveConsoleRole()).toBe("owner")
    })
  })

  describe("resolvePulseRole", () => {
    it("常にownerを返す", () => {
      expect(resolvePulseRole()).toBe("owner")
    })
  })

  describe("resolveDiscordRole", () => {
    it("DISCORD_OWNER_ID未設定 → external（fail-closed）", () => {
      const config = makeConfig({ discordOwnerId: undefined })
      expect(resolveDiscordRole("12345", config)).toBe("external")
    })

    it("一致 → owner", () => {
      const config = makeConfig({ discordOwnerId: "12345" })
      expect(resolveDiscordRole("12345", config)).toBe("owner")
    })

    it("不一致 → external", () => {
      const config = makeConfig({ discordOwnerId: "12345" })
      expect(resolveDiscordRole("99999", config)).toBe("external")
    })
  })

  describe("resolveXRole", () => {
    it("X_OWNER_USER_ID未設定 → external（fail-closed）", () => {
      const config = makeConfig({ xOwnerUserId: undefined })
      expect(resolveXRole("12345", config)).toBe("external")
    })

    it("一致 → owner", () => {
      const config = makeConfig({ xOwnerUserId: "12345" })
      expect(resolveXRole("12345", config)).toBe("owner")
    })

    it("不一致 → external", () => {
      const config = makeConfig({ xOwnerUserId: "12345" })
      expect(resolveXRole("99999", config)).toBe("external")
    })
  })

  describe("resolveRobloxRole", () => {
    it("ROBLOX_OWNER_USER_ID未設定 → external（fail-closed）", () => {
      const config = makeConfig({ robloxOwnerUserId: undefined })
      expect(resolveRobloxRole("12345", config)).toBe("external")
    })

    it("userId=undefined → external", () => {
      const config = makeConfig({ robloxOwnerUserId: "12345" })
      expect(resolveRobloxRole(undefined, config)).toBe("external")
    })

    it("文字列一致 → owner", () => {
      const config = makeConfig({ robloxOwnerUserId: "12345" })
      expect(resolveRobloxRole("12345", config)).toBe("owner")
    })

    it("数値一致（String変換） → owner", () => {
      const config = makeConfig({ robloxOwnerUserId: "12345" })
      expect(resolveRobloxRole(12345, config)).toBe("owner")
    })

    it("不一致 → external", () => {
      const config = makeConfig({ robloxOwnerUserId: "12345" })
      expect(resolveRobloxRole("99999", config)).toBe("external")
    })

    it("数値不一致 → external", () => {
      const config = makeConfig({ robloxOwnerUserId: "12345" })
      expect(resolveRobloxRole(99999, config)).toBe("external")
    })
  })
})
