import { describe, it, expect } from "vitest"
import {
  GRID_SLOTS,
  DEFAULT_LAYOUT,
  validateLayout,
  swapPanes,
} from "./layout-manager.js"
import type { GridSlot } from "./layout-manager.js"

describe("定数", () => {
  it("GRID_SLOTSは7要素（x含む）", () => {
    expect(GRID_SLOTS.length).toBe(7)
    expect(GRID_SLOTS).toContain("x")
  })

  it("デフォルト配置は3列（2/3/2）", () => {
    expect(DEFAULT_LAYOUT.length).toBe(3)
    expect(DEFAULT_LAYOUT[0].length).toBe(2)
    expect(DEFAULT_LAYOUT[1].length).toBe(3)
    expect(DEFAULT_LAYOUT[2].length).toBe(2)
  })

  it("デフォルト配置は有効", () => {
    expect(validateLayout(DEFAULT_LAYOUT)).toBe(true)
  })
})

describe("validateLayout", () => {
  it("有効なレイアウトを受理", () => {
    expect(validateLayout([
      ["avatar", "space"],
      ["canvas", "x", "roblox"],
      ["stream", "terminal"],
    ])).toBe(true)
  })

  it("ペイン重複を拒否", () => {
    expect(validateLayout([
      ["avatar", "avatar"],
      ["canvas", "x", "roblox"],
      ["stream", "terminal"],
    ])).toBe(false)
  })

  it("ペイン不足を拒否", () => {
    expect(validateLayout([
      ["avatar", "space"],
      ["canvas", "x"],
      ["stream", "terminal"],
    ])).toBe(false)
  })

  it("余分なペインを拒否", () => {
    expect(validateLayout([
      ["avatar", "space", "canvas"],
      ["x", "roblox", "stream"],
      ["terminal", "avatar"],
    ])).toBe(false)
  })
})

describe("swapPanes", () => {
  it("2ペインの位置を入れ替える", () => {
    const result = swapPanes(DEFAULT_LAYOUT, "space", "terminal")
    expect(result).toEqual([
      ["avatar", "terminal"],
      ["canvas", "x", "roblox"],
      ["stream", "space"],
    ])
  })

  it("同一ペインのswap → 変化なし", () => {
    const result = swapPanes(DEFAULT_LAYOUT, "stream", "stream")
    expect(result).toEqual(DEFAULT_LAYOUT)
  })

  it("列をまたいだ入替", () => {
    const result = swapPanes(DEFAULT_LAYOUT, "avatar", "roblox")
    expect(result).toEqual([
      ["roblox", "space"],
      ["canvas", "x", "avatar"],
      ["stream", "terminal"],
    ])
  })

  it("Xと他ペインのswap", () => {
    const result = swapPanes(DEFAULT_LAYOUT, "x", "terminal")
    expect(result).toEqual([
      ["avatar", "space"],
      ["canvas", "terminal", "roblox"],
      ["stream", "x"],
    ])
  })

  it("Xと左列ペインのswap", () => {
    const result = swapPanes(DEFAULT_LAYOUT, "x", "avatar")
    expect(result).toEqual([
      ["x", "space"],
      ["canvas", "avatar", "roblox"],
      ["stream", "terminal"],
    ])
  })

  it("入替後も全スロットが存在する", () => {
    const result = swapPanes(DEFAULT_LAYOUT, "x", "stream")
    expect(validateLayout(result)).toBe(true)
  })

  it("元の配列を変更しない（immutable）", () => {
    const original = DEFAULT_LAYOUT.map((col) => [...col])
    swapPanes(DEFAULT_LAYOUT, "space", "roblox")
    expect(DEFAULT_LAYOUT).toEqual(original)
  })

  it("全組み合わせで有効なレイアウトを維持", () => {
    for (let i = 0; i < GRID_SLOTS.length; i++) {
      for (let j = i + 1; j < GRID_SLOTS.length; j++) {
        const result = swapPanes(DEFAULT_LAYOUT, GRID_SLOTS[i], GRID_SLOTS[j])
        const flat = result.flat()
        // 全7スロットが1回ずつ存在
        expect(flat.length).toBe(7)
        expect(new Set(flat).size).toBe(7)
        for (const slot of GRID_SLOTS) {
          expect(flat).toContain(slot)
        }
      }
    }
  })
})
