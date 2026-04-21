import { describe, it, expect, beforeEach } from "vitest"
import { pushObservation, drainObservationContext, bufferSize, clearBuffer } from "./observation-buffer.js"

describe("observation-buffer", () => {
  beforeEach(() => {
    clearBuffer()
  })

  it("初期状態: バッファは空", () => {
    expect(bufferSize()).toBe(0)
    expect(drainObservationContext()).toBeNull()
  })

  it("pushしてdrainすると観測コンテキスト文字列が返る", () => {
    pushObservation("Aliceが近づいてきた（距離: 10）", "player_proximity", "2026-04-12T00:01:00Z")
    expect(bufferSize()).toBe(1)

    const ctx = drainObservationContext()
    expect(ctx).not.toBeNull()
    expect(ctx).toContain("Aliceが近づいてきた")
    expect(bufferSize()).toBe(0)
  })

  it("複数の観測をバッファし、drainで全て排出される", () => {
    pushObservation("Aliceが近づいてきた（距離: 10）", "player_proximity", "2026-04-12T00:01:00Z")
    pushObservation("Bobが近づいてきた（距離: 15）", "player_proximity", "2026-04-12T00:03:00Z")
    expect(bufferSize()).toBe(2)

    const ctx = drainObservationContext()
    expect(ctx).toContain("Alice")
    expect(ctx).toContain("Bob")
    expect(bufferSize()).toBe(0)
  })

  it("drain後の再drainはnullを返す", () => {
    pushObservation("Aliceが近づいてきた", "player_proximity", "2026-04-12T00:01:00Z")
    drainObservationContext()
    expect(drainObservationContext()).toBeNull()
  })

  it("バッファ上限（20件）を超えると古いものから捨てる", () => {
    for (let i = 0; i < 25; i++) {
      pushObservation(`観測${i}`, "player_proximity", `2026-04-12T00:${String(i).padStart(2, "0")}:00Z`)
    }
    expect(bufferSize()).toBe(20)

    const ctx = drainObservationContext()!
    // 最初の5件（0-4）は捨てられ、5-24が残る
    expect(ctx).not.toContain("観測0")
    expect(ctx).not.toContain("観測4")
    expect(ctx).toContain("観測5")
    expect(ctx).toContain("観測24")
  })
})
