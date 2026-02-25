import { describe, it, expect } from "vitest"
import { formatObservation, resolvePlayerName } from "./observation-formatter.js"
import type { ObservationEvent } from "./observation-server.js"

describe("resolvePlayerName", () => {
  it("isOwner=true + ownerDisplayName → 表示名を返す", () => {
    const result = resolvePlayerName({ player: "SitoSiqi", isOwner: true }, "シト")
    expect(result).toBe("シト")
  })

  it("isOwner=true + ownerDisplayNameなし → player名を返す", () => {
    const result = resolvePlayerName({ player: "SitoSiqi", isOwner: true })
    expect(result).toBe("SitoSiqi")
  })

  it("isOwner=false → player名をそのまま返す", () => {
    const result = resolvePlayerName({ player: "OtherPlayer", isOwner: false }, "シト")
    expect(result).toBe("OtherPlayer")
  })

  it("isOwnerフィールドなし → player名を返す", () => {
    const result = resolvePlayerName({ player: "Guest" }, "シト")
    expect(result).toBe("Guest")
  })
})

describe("formatObservation", () => {
  it("player_chat → チャット観測テキスト", () => {
    const event: ObservationEvent = {
      type: "player_chat",
      payload: { player: "TestPlayer", message: "こんにちは" },
    }
    const result = formatObservation(event)
    expect(result).toContain("[Roblox観測]")
    expect(result).toContain("TestPlayer")
    expect(result).toContain("こんにちは")
    expect(result).toContain("roblox_action")
  })

  it("player_chat + isOwner → オーナー表示名で出力", () => {
    const event: ObservationEvent = {
      type: "player_chat",
      payload: { player: "SitoSiqi", message: "やあ", isOwner: true },
    }
    const result = formatObservation(event, "シト")
    expect(result).toContain("シト")
    expect(result).not.toContain("SitoSiqi")
  })

  it("player_proximity(enter) → 接近テキスト", () => {
    const event: ObservationEvent = {
      type: "player_proximity",
      payload: { player: "NearPlayer", action: "enter", distance: 15 },
    }
    const result = formatObservation(event)
    expect(result).toContain("近づいてきた")
    expect(result).toContain("15")
  })

  it("player_proximity(leave) → 離脱テキスト", () => {
    const event: ObservationEvent = {
      type: "player_proximity",
      payload: { player: "FarPlayer", action: "leave" },
    }
    const result = formatObservation(event)
    expect(result).toContain("離れた")
  })

  it("projection_ack → JSON出力", () => {
    const event: ObservationEvent = {
      type: "projection_ack",
      payload: { intentId: "abc123", success: true },
    }
    const result = formatObservation(event)
    expect(result).toContain("投影結果")
    expect(result).toContain("abc123")
  })

  it("不明なタイプ → フォールバック形式", () => {
    const event = {
      type: "unknown_event" as "player_chat",
      payload: { data: "test" },
    }
    const result = formatObservation(event)
    expect(result).toContain("[Roblox観測]")
    expect(result).toContain("unknown_event")
  })
})
