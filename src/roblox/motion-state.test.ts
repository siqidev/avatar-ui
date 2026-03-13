// motion-state: 移動中proximity抑制の単体テスト

import { describe, it, expect, beforeEach, vi } from "vitest"
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
    _resetForTest()
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
})
