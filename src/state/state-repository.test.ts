import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { loadState, saveState, defaultState } from "./state-repository.js"
import { APP_CONFIG } from "../config.js"

// テスト用の一時ディレクトリ
const TEST_DATA_DIR = "data-test-state"
const TEST_STATE_FILE = `${TEST_DATA_DIR}/state.json`

describe("state-repository", () => {
  beforeEach(() => {
    // テスト用ディレクトリに切り替え
    Object.defineProperty(APP_CONFIG, "dataDir", { value: TEST_DATA_DIR, writable: true })
    Object.defineProperty(APP_CONFIG, "stateFile", { value: TEST_STATE_FILE, writable: true })
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true })
  })

  afterEach(() => {
    // テスト用ディレクトリを削除
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true })
    // 元に戻す
    Object.defineProperty(APP_CONFIG, "dataDir", { value: "data", writable: true })
    Object.defineProperty(APP_CONFIG, "stateFile", { value: "data/state.json", writable: true })
  })

  it("ファイルが存在しない場合、デフォルト状態を返す", () => {
    const state = loadState()
    expect(state).toEqual(defaultState())
  })

  it("保存した状態を読み込める", () => {
    const state = defaultState()
    state.lastResponseId = "resp_test_123"
    state.memory.syncCursorId = "mem_123"
    saveState(state)

    const loaded = loadState()
    expect(loaded.lastResponseId).toBe("resp_test_123")
    expect(loaded.memory.syncCursorId).toBe("mem_123")
  })

  it("旧形式（lastResponseIdのみ）からマイグレーションできる", () => {
    // v0.3以前の旧形式を直接書き込む
    fs.writeFileSync(
      TEST_STATE_FILE,
      JSON.stringify({ lastResponseId: "resp_old_456" }),
    )

    const state = loadState()
    expect(state.lastResponseId).toBe("resp_old_456")
    expect(state.memory.syncCursorId).toBeNull()
    expect(state.memory.stagedUpload).toBeNull()
    expect(state.memory.consecutiveSyncFailures).toBe(0)
  })

  it("不正なJSONはデフォルト状態を返す", () => {
    fs.writeFileSync(TEST_STATE_FILE, "invalid json")
    const state = loadState()
    expect(state).toEqual(defaultState())
  })
})
