import { describe, it, expect } from "vitest"
import { normalizeState } from "./state-normalizer.js"
import type { PaneInput, VisualState } from "./state-normalizer.js"

// ヘルパー: 空の入力
function emptyInput(overrides?: Partial<PaneInput>): PaneInput {
  return { ipcEvents: [], hasFocus: false, ...overrides }
}

describe("normalizeState", () => {
  describe("基本状態", () => {
    it("入力なし → NORMAL（モノクロ、バッジなし）", () => {
      const result = normalizeState(emptyInput())
      expect(result).toEqual<VisualState>({
        level: "normal",
        borderColor: "--line-default",
        badge: null,
        showUnreadDot: false,
        showAlertBar: false,
      })
    })

    it("focusのみ → NORMAL + フォーカスボーダー", () => {
      const result = normalizeState(emptyInput({ hasFocus: true }))
      expect(result).toEqual<VisualState>({
        level: "normal",
        borderColor: "--line-focus",
        badge: null,
        showUnreadDot: false,
        showAlertBar: false,
      })
    })
  })

  describe("stream.reply → REPLY", () => {
    it("stream.replyイベント → REPLY（info色、未読ドット）", () => {
      const result = normalizeState({
        ipcEvents: [{ type: "stream.reply" }],
        hasFocus: false,
      })
      expect(result.level).toBe("reply")
      expect(result.borderColor).toBe("--state-info")
      expect(result.showUnreadDot).toBe(true)
      expect(result.badge).toBeNull()
      expect(result.showAlertBar).toBe(false)
    })

    it("stream.reply + focus → REPLY（info色がfocusに勝つ）", () => {
      const result = normalizeState({
        ipcEvents: [{ type: "stream.reply" }],
        hasFocus: true,
      })
      expect(result.borderColor).toBe("--state-info")
    })
  })

  describe("field.state → ACTIVE/WARN", () => {
    it("field.state(active) → ACTIVE（info色、[RUN]バッジ）", () => {
      const result = normalizeState({
        ipcEvents: [{ type: "field.state", state: "active" }],
        hasFocus: false,
      })
      expect(result.level).toBe("active")
      expect(result.borderColor).toBe("--state-info")
      expect(result.badge).toBe("[RUN]")
      expect(result.showUnreadDot).toBe(false)
    })

    it("field.state(resumed) → ACTIVE（activeと同等）", () => {
      const result = normalizeState({
        ipcEvents: [{ type: "field.state", state: "resumed" }],
        hasFocus: false,
      })
      expect(result.level).toBe("active")
      expect(result.badge).toBe("[RUN]")
    })

    it("field.state(paused) → WARN（warn色、[WARN]バッジ）", () => {
      const result = normalizeState({
        ipcEvents: [{ type: "field.state", state: "paused" }],
        hasFocus: false,
      })
      expect(result.level).toBe("warn")
      expect(result.borderColor).toBe("--state-warn")
      expect(result.badge).toBe("[WARN]")
    })

    it("field.state(terminated) → WARN（warn色、[WARN]バッジ）", () => {
      const result = normalizeState({
        ipcEvents: [{ type: "field.state", state: "terminated" }],
        hasFocus: false,
      })
      expect(result.level).toBe("warn")
      expect(result.borderColor).toBe("--state-warn")
      expect(result.badge).toBe("[WARN]")
    })

    it("field.state(generated) → NORMAL（まだ接続前）", () => {
      const result = normalizeState({
        ipcEvents: [{ type: "field.state", state: "generated" }],
        hasFocus: false,
      })
      expect(result.level).toBe("normal")
      expect(result.badge).toBeNull()
    })
  })

  describe("integrity.alert → CRITICAL", () => {
    it("integrity.alert → CRITICAL（critical色、アラートバー、[ALERT]バッジ）", () => {
      const result = normalizeState({
        ipcEvents: [{ type: "integrity.alert", code: "RECIPROCITY_STREAM_ERROR", message: "エラー" }],
        hasFocus: false,
      })
      expect(result).toEqual<VisualState>({
        level: "critical",
        borderColor: "--state-critical",
        badge: "[ALERT]",
        showUnreadDot: false,
        showAlertBar: true,
      })
    })
  })

  describe("優先度解決", () => {
    it("integrity.alert > field.state（criticalが勝つ）", () => {
      const result = normalizeState({
        ipcEvents: [
          { type: "field.state", state: "active" },
          { type: "integrity.alert", code: "FIELD_CONTRACT_VIOLATION", message: "異常" },
        ],
        hasFocus: false,
      })
      expect(result.level).toBe("critical")
      expect(result.badge).toBe("[ALERT]")
    })

    it("field.state > stream.reply（activeが勝つ）", () => {
      const result = normalizeState({
        ipcEvents: [
          { type: "stream.reply" },
          { type: "field.state", state: "active" },
        ],
        hasFocus: false,
      })
      expect(result.level).toBe("active")
      expect(result.badge).toBe("[RUN]")
    })

    it("stream.reply > focus（replyが勝つ）", () => {
      const result = normalizeState({
        ipcEvents: [{ type: "stream.reply" }],
        hasFocus: true,
      })
      expect(result.level).toBe("reply")
      expect(result.borderColor).toBe("--state-info")
    })

    it("integrity.alert > stream.reply + focus（criticalが最優先）", () => {
      const result = normalizeState({
        ipcEvents: [
          { type: "stream.reply" },
          { type: "integrity.alert", code: "RECIPROCITY_STREAM_ERROR", message: "致命的" },
        ],
        hasFocus: true,
      })
      expect(result.level).toBe("critical")
      expect(result.showAlertBar).toBe(true)
      // criticalでも未読ドットは不要（アラートバーで代替）
      expect(result.showUnreadDot).toBe(false)
    })
  })

  describe("エッジケース", () => {
    it("不明なイベントタイプは無視される", () => {
      const result = normalizeState({
        ipcEvents: [{ type: "unknown.event" }],
        hasFocus: false,
      })
      expect(result.level).toBe("normal")
    })

    it("空のipcEventsでfocusなし → NORMAL", () => {
      const result = normalizeState({ ipcEvents: [], hasFocus: false })
      expect(result.level).toBe("normal")
      expect(result.borderColor).toBe("--line-default")
    })
  })
})
