import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import {
  appendMemory,
  readRecentMemories,
  readMemoriesAfter,
  backupMemoryLog,
} from "./memory-log-repository.js"
import { createMemoryRecord, type SaveMemoryArgs } from "./memory-record.js"
import { _resetConfigForTest } from "../config.js"

const TEST_DATA_DIR = "data-test-memory"
const TEST_MEMORY_FILE = `${TEST_DATA_DIR}/memory.jsonl`

// テスト用のメモリレコードを生成
function testRecord(text: string, id?: string) {
  const args: SaveMemoryArgs = {
    text,
    reason: "テスト",
    importance: 0.5,
  }
  const record = createMemoryRecord(args, {
    actor: "ai",
    responseId: "resp_test",
    callId: "call_test",
  })
  if (id) record.id = id
  return record
}

describe("memory-log-repository", () => {
  beforeEach(() => {
    const config = _resetConfigForTest({ XAI_API_KEY: "test-key" })
    Object.assign(config, { dataDir: TEST_DATA_DIR, memoryFile: TEST_MEMORY_FILE })
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true })
    _resetConfigForTest({ XAI_API_KEY: "test-key" })
  })

  it("メモリをappendして読み込める", () => {
    const record = testRecord("TypeScript学習中")
    const writeResult = appendMemory(record)
    expect(writeResult.success).toBe(true)

    const readResult = readRecentMemories(10)
    expect(readResult.success).toBe(true)
    if (readResult.success) {
      expect(readResult.data).toHaveLength(1)
      expect(readResult.data[0].text).toBe("TypeScript学習中")
    }
  })

  it("複数件appendして直近N件を取得できる", () => {
    for (let i = 0; i < 5; i++) {
      appendMemory(testRecord(`記憶${i}`, `mem_${i}`))
    }

    const result = readRecentMemories(3)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(3)
      expect(result.data[0].text).toBe("記憶2")
      expect(result.data[2].text).toBe("記憶4")
    }
  })

  it("指定IDより後のレコードを取得できる", () => {
    for (let i = 0; i < 5; i++) {
      appendMemory(testRecord(`記憶${i}`, `mem_${i}`))
    }

    const result = readMemoriesAfter("mem_2")
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(2)
      expect(result.data[0].id).toBe("mem_3")
      expect(result.data[1].id).toBe("mem_4")
    }
  })

  it("cursorId=nullで全件取得", () => {
    for (let i = 0; i < 3; i++) {
      appendMemory(testRecord(`記憶${i}`, `mem_${i}`))
    }

    const result = readMemoriesAfter(null)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(3)
    }
  })

  it("ファイルが存在しない場合は空配列を返す", () => {
    const result = readRecentMemories(10)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(0)
    }
  })

  it("バックアップを作成できる", () => {
    appendMemory(testRecord("テストデータ"))
    const result = backupMemoryLog()
    expect(result.success).toBe(true)
    expect(fs.existsSync(`${TEST_MEMORY_FILE}.bak`)).toBe(true)
  })
})
