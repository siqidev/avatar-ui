import { describe, it, expect } from "vitest"
import {
  GRID_SLOTS,
  DEFAULT_LAYOUT,
  buildGridAreas,
  swapPanes,
} from "./layout-manager.js"
import type { GridSlot } from "./layout-manager.js"

describe("buildGridAreas", () => {
  it("デフォルト配置からCSS文字列を生成（スプリッタートラック含む5×3）", () => {
    const result = buildGridAreas(DEFAULT_LAYOUT)
    expect(result).toBe('"avatar . canvas . stream" ". . . . ." "space . roblox . terminal"')
  })

  it("入替後の配置でも正しいCSS文字列を生成", () => {
    const swapped: GridSlot[][] = [
      ["avatar", "stream", "canvas"],
      ["space", "roblox", "terminal"],
    ]
    const result = buildGridAreas(swapped)
    expect(result).toBe('"avatar . stream . canvas" ". . . . ." "space . roblox . terminal"')
  })
})

describe("swapPanes", () => {
  it("2ペインの位置を入れ替える", () => {
    const result = swapPanes(DEFAULT_LAYOUT, "space", "terminal")
    expect(result).toEqual([
      ["avatar", "canvas", "stream"],
      ["terminal", "roblox", "space"],
    ])
  })

  it("同一ペインのswap → 変化なし", () => {
    const result = swapPanes(DEFAULT_LAYOUT, "stream", "stream")
    expect(result).toEqual(DEFAULT_LAYOUT)
  })

  it("同じ行内の入替", () => {
    const result = swapPanes(DEFAULT_LAYOUT, "space", "terminal")
    expect(result).toEqual([
      ["avatar", "canvas", "stream"],
      ["terminal", "roblox", "space"],
    ])
  })

  it("入替後も全スロットが存在する", () => {
    const result = swapPanes(DEFAULT_LAYOUT, "stream", "terminal")
    const flat = result.flat()
    for (const slot of GRID_SLOTS) {
      expect(flat).toContain(slot)
    }
  })

  it("元の配列を変更しない（immutable）", () => {
    const original = DEFAULT_LAYOUT.map((row) => [...row])
    swapPanes(DEFAULT_LAYOUT, "space", "roblox")
    expect(DEFAULT_LAYOUT).toEqual(original)
  })

  it("行をまたいだ入替", () => {
    const result = swapPanes(DEFAULT_LAYOUT, "avatar", "roblox")
    expect(result).toEqual([
      ["roblox", "canvas", "stream"],
      ["space", "avatar", "terminal"],
    ])
  })

  it("全組み合わせで有効なグリッドを維持", () => {
    for (let i = 0; i < GRID_SLOTS.length; i++) {
      for (let j = i + 1; j < GRID_SLOTS.length; j++) {
        const result = swapPanes(DEFAULT_LAYOUT, GRID_SLOTS[i], GRID_SLOTS[j])
        const flat = result.flat()
        // 全スロットが1回ずつ存在
        expect(flat.length).toBe(6)
        expect(new Set(flat).size).toBe(6)
        for (const slot of GRID_SLOTS) {
          expect(flat).toContain(slot)
        }
      }
    }
  })
})

describe("定数", () => {
  it("デフォルト配置は2行3列", () => {
    expect(DEFAULT_LAYOUT.length).toBe(2)
    expect(DEFAULT_LAYOUT[0].length).toBe(3)
    expect(DEFAULT_LAYOUT[1].length).toBe(3)
  })

  it("GRID_SLOTSは6要素", () => {
    expect(GRID_SLOTS.length).toBe(6)
  })
})
