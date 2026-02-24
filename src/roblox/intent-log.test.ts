import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import { APP_CONFIG } from "../config.js"
import {
  appendIntent,
  readIntentsByStatus,
  updateIntentStatus,
} from "./intent-log.js"

describe("intent-log", () => {
  const testFile = APP_CONFIG.intentLogFile

  beforeEach(() => {
    // テスト前にファイルを削除
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile)
    }
  })

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile)
    }
  })

  it("意図をpendingとして記録できる", () => {
    const result = appendIntent({
      category: "part",
      ops: [{ op: "create", shape: "Block", pos: [0, 0, 0] }],
      reason: "テスト",
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.id).toBeTruthy()
    expect(result.data.status).toBe("pending")
    expect(result.data.category).toBe("part")
    expect(result.data.ops).toHaveLength(1)

    // ファイルに書き込まれていることを確認
    const content = fs.readFileSync(testFile, "utf-8")
    const parsed = JSON.parse(content.trim())
    expect(parsed.id).toBe(result.data.id)
  })

  it("ステータスでフィルタ読み出しできる", () => {
    appendIntent({ category: "part", ops: [{ op: "create" }], reason: "1" })
    appendIntent({ category: "npc", ops: [{ op: "move_to" }], reason: "2" })

    const pending = readIntentsByStatus("pending")
    expect(pending.success).toBe(true)
    if (!pending.success) return
    expect(pending.data).toHaveLength(2)

    const sent = readIntentsByStatus("sent")
    expect(sent.success).toBe(true)
    if (!sent.success) return
    expect(sent.data).toHaveLength(0)
  })

  it("ステータスを更新できる", () => {
    const result = appendIntent({
      category: "effect",
      ops: [{ op: "create" }],
      reason: "テスト",
    })
    if (!result.success) return

    const id = result.data.id

    // sentに更新
    const updateResult = updateIntentStatus(id, "sent")
    expect(updateResult.success).toBe(true)

    // pendingは0件、sentは1件
    const pending = readIntentsByStatus("pending")
    if (!pending.success) return
    expect(pending.data).toHaveLength(0)

    const sent = readIntentsByStatus("sent")
    if (!sent.success) return
    expect(sent.data).toHaveLength(1)
    expect(sent.data[0].sentAt).toBeTruthy()
  })

  it("failedに更新するとエラーメッセージが記録される", () => {
    const result = appendIntent({
      category: "terrain",
      ops: [{ op: "fill" }],
      reason: "テスト",
    })
    if (!result.success) return

    updateIntentStatus(result.data.id, "failed", "送信エラー")

    const failed = readIntentsByStatus("failed")
    if (!failed.success) return
    expect(failed.data).toHaveLength(1)
    expect(failed.data[0].error).toBe("送信エラー")
  })

  it("ファイルが存在しない場合は空配列を返す", () => {
    const result = readIntentsByStatus("pending")
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toHaveLength(0)
  })
})
