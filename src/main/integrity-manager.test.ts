import { describe, it, expect, beforeEach, vi } from "vitest"
import { report, warn, setAlertSink, isFrozen, _resetForTest, RECOVERY_POLICY } from "./integrity-manager.js"
import { _resetConfigForTest } from "../config.js"

describe("integrity-manager", () => {
  beforeEach(() => {
    _resetConfigForTest({ XAI_API_KEY: "test-key" })
    _resetForTest()
  })

  describe("report", () => {
    it("sinkが設定済みなら呼ばれる（userMessageを使用）", () => {
      const sink = vi.fn()
      setAlertSink(sink)

      report("RECIPROCITY_STREAM_ERROR", "APIエラー")

      expect(sink).toHaveBeenCalledOnce()
      expect(sink).toHaveBeenCalledWith(
        "RECIPROCITY_STREAM_ERROR",
        RECOVERY_POLICY.RECIPROCITY_STREAM_ERROR.userMessage,
      )
    })

    it("sink未設定でもクラッシュしない", () => {
      expect(() => report("FIELD_CONTRACT_VIOLATION", "FSM違反")).not.toThrow()
    })

    it("報告後に凍結される", () => {
      expect(isFrozen()).toBe(false)
      report("RECIPROCITY_STREAM_ERROR", "エラー")
      expect(isFrozen()).toBe(true)
    })

    it("複数回reportしても全てsinkに転送される", () => {
      const sink = vi.fn()
      setAlertSink(sink)

      report("RECIPROCITY_STREAM_ERROR", "1回目")
      report("RECIPROCITY_PULSE_ERROR", "2回目")

      expect(sink).toHaveBeenCalledTimes(2)
      expect(sink).toHaveBeenNthCalledWith(1,
        "RECIPROCITY_STREAM_ERROR",
        RECOVERY_POLICY.RECIPROCITY_STREAM_ERROR.userMessage,
      )
      expect(sink).toHaveBeenNthCalledWith(2,
        "RECIPROCITY_PULSE_ERROR",
        RECOVERY_POLICY.RECIPROCITY_PULSE_ERROR.userMessage,
      )
    })
  })

  describe("warn", () => {
    it("sinkに通知するが凍結しない", () => {
      const sink = vi.fn()
      setAlertSink(sink)

      warn("RECIPROCITY_STREAM_ERROR", "タイムアウト")

      expect(sink).toHaveBeenCalledOnce()
      expect(sink).toHaveBeenCalledWith(
        "RECIPROCITY_STREAM_ERROR",
        RECOVERY_POLICY.RECIPROCITY_STREAM_ERROR.userMessage,
      )
      expect(isFrozen()).toBe(false)
    })

    it("warn後もreportで凍結できる", () => {
      warn("RECIPROCITY_PULSE_ERROR", "一時障害")
      expect(isFrozen()).toBe(false)

      report("FIELD_CONTRACT_VIOLATION", "整合性破壊")
      expect(isFrozen()).toBe(true)
    })
  })

  describe("isFrozen", () => {
    it("初期状態はfalse", () => {
      expect(isFrozen()).toBe(false)
    })

    it("report後はtrue", () => {
      report("COEXISTENCE_STATE_LOAD_CORRUPTED", "破損")
      expect(isFrozen()).toBe(true)
    })
  })

  describe("_resetForTest", () => {
    it("凍結とsinkをリセットする", () => {
      const sink = vi.fn()
      setAlertSink(sink)
      report("FIELD_CONTRACT_VIOLATION", "テスト")

      _resetForTest()

      expect(isFrozen()).toBe(false)
      report("RECIPROCITY_STREAM_ERROR", "リセット後")
      expect(sink).toHaveBeenCalledTimes(1) // リセット前の1回のみ
    })
  })
})
