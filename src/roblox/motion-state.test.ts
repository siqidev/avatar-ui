// motion-state: 移動中proximity抑制の単体テスト

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import {
  startSuppression,
  endSuppression,
  isProximitySuppressed,
  _resetForTest,
} from "./motion-state.js"

vi.mock("../logger.js", () => ({
  info: vi.fn(),
}))

describe("motion-state", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetForTest()
  })

  afterEach(() => {
    _resetForTest()
    vi.useRealTimers()
  })

  it("初期状態: 抑制なし", () => {
    expect(isProximitySuppressed()).toBe(false)
  })

  it("startSuppression → 抑制ON", () => {
    startSuppression()
    expect(isProximitySuppressed()).toBe(true)
  })

  it("startSuppression → endSuppression → 抑制OFF", () => {
    startSuppression()
    endSuppression()
    expect(isProximitySuppressed()).toBe(false)
  })

  it("endSuppression: 非アクティブ時はno-op", () => {
    endSuppression() // エラーにならない
    expect(isProximitySuppressed()).toBe(false)
  })

  it("タイムアウト: 30秒後に自動解除", () => {
    startSuppression()
    expect(isProximitySuppressed()).toBe(true)

    vi.advanceTimersByTime(29_999)
    expect(isProximitySuppressed()).toBe(true)

    vi.advanceTimersByTime(1)
    expect(isProximitySuppressed()).toBe(false)
  })

  it("endSuppression後のタイムアウトは発火しない", () => {
    startSuppression()
    endSuppression()

    vi.advanceTimersByTime(30_000)
    expect(isProximitySuppressed()).toBe(false) // 二重解除なし
  })

  it("連続startSuppression: タイマーがリセットされる", () => {
    startSuppression()
    vi.advanceTimersByTime(20_000) // 20秒経過
    startSuppression() // リセット

    vi.advanceTimersByTime(20_000) // さらに20秒（計40秒、リセット後20秒）
    expect(isProximitySuppressed()).toBe(true) // リセットから30秒未満

    vi.advanceTimersByTime(10_000) // リセットから30秒
    expect(isProximitySuppressed()).toBe(false)
  })
})
