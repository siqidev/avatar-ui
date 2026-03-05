import { describe, it, expect } from "vitest"
import { shouldForwardToAI } from "./observation-forwarding-policy.js"
import type { ObservationEvent } from "./observation-server.js"

function event(type: ObservationEvent["type"], payload: Record<string, unknown> = {}): ObservationEvent {
  return { type, payload }
}

describe("shouldForwardToAI", () => {
  // player_chat / player_proximity: 常にAI送信
  it("player_chat → true", () => {
    expect(shouldForwardToAI(event("player_chat", { player: "Alice", message: "hello" }))).toBe(true)
  })

  it("player_proximity enter → true", () => {
    expect(shouldForwardToAI(event("player_proximity", { player: "Alice", action: "enter", distance: 10 }))).toBe(true)
  })

  it("player_proximity leave → true", () => {
    expect(shouldForwardToAI(event("player_proximity", { player: "Alice", action: "leave" }))).toBe(true)
  })

  // command_ack: 失敗のみAI送信
  it("command_ack success → false", () => {
    expect(shouldForwardToAI(event("command_ack", {
      intent_id: "abc", op: "create", success: true, data: { name: "Orb" },
    }))).toBe(false)
  })

  it("command_ack failure → true", () => {
    expect(shouldForwardToAI(event("command_ack", {
      intent_id: "abc", op: "apply_constraints", success: false,
      error: { code: "VALIDATION_FAILED", message: "重なり", retryable: true },
    }))).toBe(true)
  })

  it("command_ack success未設定 → true（fail-fast: 不明はAI送信）", () => {
    expect(shouldForwardToAI(event("command_ack", { intent_id: "abc", op: "create" }))).toBe(true)
  })

  // npc_follow_event: lost/path_failed のみAI送信
  it("npc_follow_event started → false", () => {
    expect(shouldForwardToAI(event("npc_follow_event", { state: "started", follow_id: "f-1" }))).toBe(false)
  })

  it("npc_follow_event stopped → false", () => {
    expect(shouldForwardToAI(event("npc_follow_event", { state: "stopped", follow_id: "f-1" }))).toBe(false)
  })

  it("npc_follow_event lost → true", () => {
    expect(shouldForwardToAI(event("npc_follow_event", { state: "lost", follow_id: "f-1" }))).toBe(true)
  })

  it("npc_follow_event path_failed → true", () => {
    expect(shouldForwardToAI(event("npc_follow_event", { state: "path_failed", follow_id: "f-2" }))).toBe(true)
  })

  // projection_ack: 失敗のみAI送信
  it("projection_ack success → false", () => {
    expect(shouldForwardToAI(event("projection_ack", { success: true }))).toBe(false)
  })

  it("projection_ack failure → true", () => {
    expect(shouldForwardToAI(event("projection_ack", { success: false, error: "timeout" }))).toBe(true)
  })

  // roblox_log: AI送信しない
  it("roblox_log → false", () => {
    expect(shouldForwardToAI(event("roblox_log", { message: "test", level: "Enum.MessageType.MessageOutput" }))).toBe(false)
  })
})
