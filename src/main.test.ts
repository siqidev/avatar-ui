import { describe, it, expect } from "vitest"
import { ok, fail } from "./types/result.js"
import { APP_CONFIG, isCollectionsEnabled, type Env } from "./config.js"

describe("types/result", () => {
  it("ok()が成功結果を返す", () => {
    const result = ok("data")
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe("data")
    }
  })

  it("fail()がエラー結果を返す", () => {
    const result = fail("ERR_CODE", "エラーメッセージ")
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe("ERR_CODE")
      expect(result.error.message).toBe("エラーメッセージ")
    }
  })
})

describe("config", () => {
  it("APP_CONFIGが正しい定数を持つ", () => {
    expect(APP_CONFIG.model).toBe("grok-4-1-fast-non-reasoning")
    expect(APP_CONFIG.beingFile).toBe("BEING.md")
    expect(APP_CONFIG.dataDir).toBe("data")
  })

  it("isCollectionsEnabled: 両方のキーがあればtrue", () => {
    const env: Env = {
      XAI_API_KEY: "key",
      XAI_MANAGEMENT_API_KEY: "mgmt-key",
      XAI_COLLECTION_ID: "col-id",
    }
    expect(isCollectionsEnabled(env)).toBe(true)
  })

  it("isCollectionsEnabled: 管理キーがなければfalse", () => {
    const env: Env = {
      XAI_API_KEY: "key",
    }
    expect(isCollectionsEnabled(env)).toBe(false)
  })

  it("isCollectionsEnabled: コレクションIDがなければfalse", () => {
    const env: Env = {
      XAI_API_KEY: "key",
      XAI_MANAGEMENT_API_KEY: "mgmt-key",
    }
    expect(isCollectionsEnabled(env)).toBe(false)
  })
})

describe("save-memory-tool", () => {
  it("ツール定義が正しい構造を持つ", async () => {
    const { saveMemoryToolDef } = await import("./tools/save-memory-tool.js")
    expect(saveMemoryToolDef.type).toBe("function")
    if (saveMemoryToolDef.type === "function") {
      expect(saveMemoryToolDef.name).toBe("save_memory")
      expect(saveMemoryToolDef.parameters).toBeDefined()
    }
  })
})
