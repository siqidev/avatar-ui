import { describe, it, expect } from "vitest"
import { transition, initialState, isActive } from "./field-fsm.js"

describe("field-fsm", () => {
  describe("initialState", () => {
    it("generatedを返す", () => {
      expect(initialState()).toBe("generated")
    })
  })

  describe("正常遷移", () => {
    it("generated + attach → active", () => {
      expect(transition("generated", "attach")).toBe("active")
    })

    it("active + detach → paused", () => {
      expect(transition("active", "detach")).toBe("paused")
    })

    it("paused + attach → resumed", () => {
      expect(transition("paused", "attach")).toBe("resumed")
    })

    it("resumed + detach → paused（再度閉じる）", () => {
      expect(transition("resumed", "detach")).toBe("paused")
    })

    it("active + terminate → terminated", () => {
      expect(transition("active", "terminate")).toBe("terminated")
    })

    it("paused + terminate → terminated", () => {
      expect(transition("paused", "terminate")).toBe("terminated")
    })

    it("resumed + terminate → terminated", () => {
      expect(transition("resumed", "terminate")).toBe("terminated")
    })
  })

  describe("ライフサイクル完走（S5シナリオ）", () => {
    it("generated → active → paused → resumed → paused → terminated", () => {
      let state = initialState()
      state = transition(state, "attach")    // generated → active
      expect(state).toBe("active")

      state = transition(state, "detach")    // active → paused
      expect(state).toBe("paused")

      state = transition(state, "attach")    // paused → resumed
      expect(state).toBe("resumed")

      state = transition(state, "detach")    // resumed → paused
      expect(state).toBe("paused")

      state = transition(state, "terminate") // paused → terminated
      expect(state).toBe("terminated")
    })
  })

  describe("不正遷移（fail-fast）", () => {
    it("generated + detach → throw", () => {
      expect(() => transition("generated", "detach")).toThrow("不正な状態遷移")
    })

    it("generated + terminate → throw", () => {
      expect(() => transition("generated", "terminate")).toThrow("不正な状態遷移")
    })

    it("active + attach → throw（二重接続）", () => {
      expect(() => transition("active", "attach")).toThrow("不正な状態遷移")
    })

    it("paused + detach → throw（二重切断）", () => {
      expect(() => transition("paused", "detach")).toThrow("不正な状態遷移")
    })

    it("terminated + attach → throw（不可逆）", () => {
      expect(() => transition("terminated", "attach")).toThrow("不正な状態遷移")
    })

    it("terminated + detach → throw（不可逆）", () => {
      expect(() => transition("terminated", "detach")).toThrow("不正な状態遷移")
    })

    it("terminated + terminate → throw（不可逆）", () => {
      expect(() => transition("terminated", "terminate")).toThrow("不正な状態遷移")
    })
  })

  describe("isActive", () => {
    it("activeはtrue", () => {
      expect(isActive("active")).toBe(true)
    })

    it("resumedはtrue（activeと同等）", () => {
      expect(isActive("resumed")).toBe(true)
    })

    it("generatedはfalse", () => {
      expect(isActive("generated")).toBe(false)
    })

    it("pausedはfalse", () => {
      expect(isActive("paused")).toBe(false)
    })

    it("terminatedはfalse", () => {
      expect(isActive("terminated")).toBe(false)
    })
  })
})
