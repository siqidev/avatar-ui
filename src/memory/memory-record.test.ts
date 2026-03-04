import { describe, it, expect } from "vitest"
import {
  memoryRecordSchema,
  saveMemoryArgsSchema,
  generateMemoryId,
  createMemoryRecord,
} from "./memory-record.js"

describe("memory-record", () => {
  it("有効なsave_memory引数を検証できる", () => {
    const args = {
      text: "ユーザーはTypeScriptを学習中",
      reason: "学習状況の把握",
      importance: 0.5,
      tags: ["学習", "技術"],
    }
    const result = saveMemoryArgsSchema.safeParse(args)
    expect(result.success).toBe(true)
  })

  it("textが空の場合は検証失敗", () => {
    const args = {
      text: "",
      reason: "テスト",
      importance: 0.5,
    }
    const result = saveMemoryArgsSchema.safeParse(args)
    expect(result.success).toBe(false)
  })

  it("importanceが範囲外の場合は検証失敗", () => {
    const args = {
      text: "テスト",
      reason: "テスト",
      importance: 1.5,
    }
    const result = saveMemoryArgsSchema.safeParse(args)
    expect(result.success).toBe(false)
  })

  it("メモリIDはユニークに生成される", () => {
    const id1 = generateMemoryId()
    const id2 = generateMemoryId()
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^mem_\d+_[0-9a-f]+$/)
  })

  it("createMemoryRecordが正しいレコードを生成する", () => {
    const record = createMemoryRecord(
      { text: "テスト記憶", reason: "テスト", importance: 0.7 },
      { actor: "ai", responseId: "resp_123", callId: "call_456" },
    )

    expect(record.text).toBe("テスト記憶")
    expect(record.reason).toBe("テスト")
    expect(record.importance).toBe(0.7)
    expect(record.source.actor).toBe("ai")
    expect(record.source.responseId).toBe("resp_123")
    expect(record.id).toMatch(/^mem_/)
    expect(record.at).toBeTruthy()

    // Zodスキーマで検証できること
    const validation = memoryRecordSchema.safeParse(record)
    expect(validation.success).toBe(true)
  })

  it("tagsとmetaはオプショナル", () => {
    const record = createMemoryRecord(
      { text: "シンプルな記憶", reason: "テスト", importance: 0.3 },
      { actor: "human", responseId: null, callId: null },
    )
    expect(record.tags).toBeUndefined()
    expect(record.meta).toBeUndefined()

    const validation = memoryRecordSchema.safeParse(record)
    expect(validation.success).toBe(true)
  })
})
