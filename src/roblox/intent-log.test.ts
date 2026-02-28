import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import { _resetConfigForTest, getConfig } from "../config.js"
import {
  appendIntent,
  readIntentsByStatus,
  updateIntentStatus,
} from "./intent-log.js"

const TEST_DATA_DIR = "data-test-intent"
const TEST_INTENT_FILE = `${TEST_DATA_DIR}/roblox-intents.jsonl`

describe("intent-log", () => {
  beforeEach(() => {
    const config = _resetConfigForTest({ XAI_API_KEY: "test-key" })
    Object.assign(config, { dataDir: TEST_DATA_DIR, intentLogFile: TEST_INTENT_FILE })
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true })
    // テスト前にファイルを削除
    if (fs.existsSync(TEST_INTENT_FILE)) {
      fs.unlinkSync(TEST_INTENT_FILE)
    }
  })

  afterEach(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true })
    _resetConfigForTest({ XAI_API_KEY: "test-key" })
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
    const content = fs.readFileSync(TEST_INTENT_FILE, "utf-8")
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
