import { describe, expect, it } from "vitest"
import {
  getBaseName,
  getParentDir,
  isDescendant,
  joinPath,
  rewritePathPrefix,
  validateTreeMove,
} from "./filesystem-dnd.js"

describe("filesystem-dnd", () => {
  describe("isDescendant", () => {
    it("子孫パスを判定する", () => {
      expect(isDescendant("src", "src/components/button.ts")).toBe(true)
    })

    it("同一パスはfalse", () => {
      expect(isDescendant("src", "src")).toBe(false)
    })

    it("無関係なパスはfalse", () => {
      expect(isDescendant("src", "docs/readme.md")).toBe(false)
    })
  })

  describe("validateTreeMove", () => {
    it("有効な移動", () => {
      expect(validateTreeMove("docs/readme.md", "archive")).toEqual({
        ok: true,
        destPath: "archive/readme.md",
      })
    })

    it("自分自身への移動を拒否", () => {
      const r = validateTreeMove("docs", "docs")
      expect(r.ok).toBe(false)
    })

    it("同一親への移動を拒否", () => {
      const r = validateTreeMove("docs/readme.md", "docs")
      expect(r.ok).toBe(false)
    })

    it("親→子孫への移動を拒否", () => {
      const r = validateTreeMove("docs", "docs/archive")
      expect(r.ok).toBe(false)
    })

    it("ルートへの移動", () => {
      expect(validateTreeMove("sub/file.md", ".")).toEqual({
        ok: true,
        destPath: "file.md",
      })
    })
  })

  describe("補助関数", () => {
    it("getParentDir", () => {
      expect(getParentDir("docs/readme.md")).toBe("docs")
      expect(getParentDir("readme.md")).toBe(".")
    })

    it("getBaseName", () => {
      expect(getBaseName("docs/readme.md")).toBe("readme.md")
      expect(getBaseName("readme.md")).toBe("readme.md")
    })

    it("joinPath", () => {
      expect(joinPath(".", "readme.md")).toBe("readme.md")
      expect(joinPath("docs", "readme.md")).toBe("docs/readme.md")
    })

    it("rewritePathPrefix", () => {
      expect(rewritePathPrefix("docs/a/b.txt", "docs", "archive/docs")).toBe("archive/docs/a/b.txt")
      expect(rewritePathPrefix("notes.txt", "docs", "archive/docs")).toBe("notes.txt")
    })
  })
})
