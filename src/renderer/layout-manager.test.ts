import { describe, it, expect } from "vitest"
import {
  calculateColumns,
  clampRatios,
  getDegradation,
  DEFAULT_RATIOS,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
} from "./layout-manager.js"

describe("calculateColumns", () => {
  it("基準幅1280pxでデフォルト比率（24/52/24）を計算", () => {
    const result = calculateColumns(1280)
    const effective = 1272 // 1280 - スプリッター8px
    // left/rightはMath.roundで丸め、mainが残りを吸収
    expect(result.left).toBe(Math.round(effective * 0.24))
    expect(result.right).toBe(Math.round(effective * 0.24))
    expect(result.left + result.main + result.right).toBe(effective)
  })

  it("任意幅でも比率を維持", () => {
    const result = calculateColumns(1600)
    const effective = 1600 - 8
    expect(result.left).toBe(Math.round(effective * 0.24))
    expect(result.right).toBe(Math.round(effective * 0.24))
    expect(result.left + result.main + result.right).toBe(effective)
  })

  it("カスタム比率を指定できる", () => {
    const result = calculateColumns(1280, [0.3, 0.4, 0.3])
    const effective = 1280 - 8
    expect(result.left).toBe(Math.round(effective * 0.3))
    expect(result.right).toBe(Math.round(effective * 0.3))
    expect(result.left + result.main + result.right).toBe(effective)
  })

  it("3列の合計が常にスプリッター除外後の総幅と一致（丸め誤差なし）", () => {
    // 複数の幅でテスト
    for (const w of [1280, 1366, 1440, 1600, 1920]) {
      const result = calculateColumns(w)
      expect(result.left + result.main + result.right).toBe(w - 8)
    }
  })
})

describe("clampRatios", () => {
  it("制約内の比率はそのまま返す", () => {
    const result = clampRatios([0.24, 0.52, 0.24])
    expect(result).toEqual([0.24, 0.52, 0.24])
  })

  it("leftが20%未満 → 20%にクランプ、差分をmainに再配分", () => {
    const result = clampRatios([0.15, 0.60, 0.25])
    expect(result[0]).toBe(0.20)
    // 合計は1.0を維持
    expect(result[0] + result[1] + result[2]).toBeCloseTo(1.0)
  })

  it("rightが20%未満 → 20%にクランプ", () => {
    const result = clampRatios([0.25, 0.60, 0.15])
    expect(result[2]).toBe(0.20)
    expect(result[0] + result[1] + result[2]).toBeCloseTo(1.0)
  })

  it("mainが最小比率未満 → 最小値にクランプ", () => {
    // mainの最小 = 42ch ≒ 546px / 1272px(基準実効幅) ≒ 0.43 → 実用的に0.40下限
    const result = clampRatios([0.35, 0.30, 0.35])
    expect(result[1]).toBeGreaterThanOrEqual(0.40)
    expect(result[0] + result[1] + result[2]).toBeCloseTo(1.0)
  })

  it("比率の合計が1.0でない場合は正規化される", () => {
    const result = clampRatios([0.30, 0.50, 0.30])
    expect(result[0] + result[1] + result[2]).toBeCloseTo(1.0)
  })

  it("最大比率（60%）を超えるmainはクランプ", () => {
    const result = clampRatios([0.15, 0.70, 0.15])
    expect(result[1]).toBeLessThanOrEqual(0.60)
    expect(result[0] + result[1] + result[2]).toBeCloseTo(1.0)
  })
})

describe("getDegradation", () => {
  it("十分な幅・高さ → none", () => {
    expect(getDegradation(1280, 800)).toBe("none")
  })

  it("幅が狭い → right-tabs（右列タブ化）", () => {
    // 合意: 縮退順で右列タブ化は一定幅以下
    expect(getDegradation(1000, 800)).toBe("right-tabs")
  })

  it("さらに幅が狭い → fs-drawer（FSドロワー化）", () => {
    expect(getDegradation(800, 800)).toBe("fs-drawer")
  })

  it("最小幅以上なら縮退なし", () => {
    expect(getDegradation(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)).toBe("none")
  })
})

describe("定数", () => {
  it("デフォルト比率は24/52/24", () => {
    expect(DEFAULT_RATIOS).toEqual([0.24, 0.52, 0.24])
  })

  it("最小ウィンドウは1280x800", () => {
    expect(MIN_WINDOW_WIDTH).toBe(1280)
    expect(MIN_WINDOW_HEIGHT).toBe(800)
  })
})
