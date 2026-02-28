import { describe, it, expect } from "vitest"
import { ok, fail } from "./types/result.js"
import { buildConfig, isCollectionsEnabled, type AppConfig } from "./config.js"

// テスト用の最小env（XAI_API_KEYのみ必須）
const BASE_ENV = { XAI_API_KEY: "test-key" }

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
  it("buildConfigがデフォルト値で正しい定数を持つ", () => {
    const config = buildConfig(BASE_ENV)
    expect(config.model).toBe("grok-4-1-fast-non-reasoning")
    expect(config.beingFile).toBe("BEING.md")
    expect(config.dataDir).toBe("data")
    expect(config.avatarName).toBe("Avatar")
    expect(config.userName).toBe("User")
  })

  it("isCollectionsEnabled: 両方のキーがあればtrue", () => {
    const config = buildConfig({
      ...BASE_ENV,
      XAI_MANAGEMENT_API_KEY: "mgmt-key",
      XAI_COLLECTION_ID: "col-id",
    })
    expect(isCollectionsEnabled(config)).toBe(true)
  })

  it("isCollectionsEnabled: 管理キーがなければfalse", () => {
    const config = buildConfig(BASE_ENV)
    expect(isCollectionsEnabled(config)).toBe(false)
  })

  it("isCollectionsEnabled: コレクションIDがなければfalse", () => {
    const config = buildConfig({
      ...BASE_ENV,
      XAI_MANAGEMENT_API_KEY: "mgmt-key",
    })
    expect(isCollectionsEnabled(config)).toBe(false)
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
