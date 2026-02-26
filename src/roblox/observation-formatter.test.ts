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

  it("command_ack(成功) → ACK成功テキスト", () => {
    const event: ObservationEvent = {
      type: "command_ack",
      payload: {
        intent_id: "abc12345-6789",
        op: "apply_constraints",
        success: true,
        data: { created_ids: ["wall-1"] },
      },
    }
    const result = formatObservation(event)
    expect(result).toContain("[Roblox ACK]")
    expect(result).toContain("apply_constraints")
    expect(result).toContain("成功")
    expect(result).toContain("abc12345")
    expect(result).toContain("wall-1")
  })

  it("command_ack(失敗+検証) → ACK失敗テキスト+検証結果", () => {
    const event: ObservationEvent = {
      type: "command_ack",
      payload: {
        intent_id: "def99999",
        op: "apply_constraints",
        success: false,
        error: { code: "VALIDATION_FAILED", message: "物理検証失敗", retryable: true },
        meta: { validation: { passed: false, checks: [{ name: "non_overlap", ok: false }] } },
      },
    }
    const result = formatObservation(event)
    expect(result).toContain("失敗")
    expect(result).toContain("VALIDATION_FAILED")
    expect(result).toContain("再試行可能")
    expect(result).toContain("検証結果")
    expect(result).toContain("non_overlap")
  })

  it("npc_follow_event(started) → 追従開始テキスト", () => {
    const event: ObservationEvent = {
      type: "npc_follow_event",
      payload: { follow_id: "follow-1", state: "started", user_id: 123 },
    }
    const result = formatObservation(event)
    expect(result).toContain("追従開始")
    expect(result).toContain("follow-1")
  })

  it("npc_follow_event(lost) → 見失いテキスト", () => {
    const event: ObservationEvent = {
      type: "npc_follow_event",
      payload: { follow_id: "follow-2", state: "lost", user_id: 456 },
    }
    const result = formatObservation(event)
    expect(result).toContain("見失った")
  })

  it("npc_follow_event(stopped) → 追従停止テキスト", () => {
    const event: ObservationEvent = {
      type: "npc_follow_event",
      payload: { follow_id: "follow-3", state: "stopped" },
    }
    const result = formatObservation(event)
    expect(result).toContain("追従停止")
  })
})
