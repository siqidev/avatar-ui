import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import { loadState, saveState, defaultState } from "./state-repository.js"
import { _resetConfigForTest } from "../config.js"

const TEST_DATA_DIR = "data-test-state"
const TEST_STATE_FILE = `${TEST_DATA_DIR}/state.json`

describe("state-repository", () => {
  beforeEach(() => {
    _resetConfigForTest({ XAI_API_KEY: "test-key" })
    // dataDir/stateFileを上書き（_resetConfigForTestで生成した後にパッチ）
    const config = _resetConfigForTest({ XAI_API_KEY: "test-key" })
    Object.assign(config, { dataDir: TEST_DATA_DIR, stateFile: TEST_STATE_FILE })
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true })
    _resetConfigForTest({ XAI_API_KEY: "test-key" })
  })

  it("ファイルが存在しない場合、デフォルト状態を返す", () => {
    const state = loadState()
    expect(state).toEqual(defaultState())
  })

  it("保存した状態を読み込める", () => {
    const state = defaultState()
    state.lastResponseId = "resp_test_123"
    saveState(state)

    const loaded = loadState()
    expect(loaded.lastResponseId).toBe("resp_test_123")
  })

  it("旧形式（余分なフィールド含む）でもlastResponseIdを読み込める", () => {
    fs.writeFileSync(
      TEST_STATE_FILE,
      JSON.stringify({ lastResponseId: "resp_old_456", memory: { syncCursorId: "old" } }),
    )

    const state = loadState()
    expect(state.lastResponseId).toBe("resp_old_456")
  })

  it("不正なJSONはthrowする（fail-fast）", () => {
    fs.writeFileSync(TEST_STATE_FILE, "invalid json")
    expect(() => loadState()).toThrow(SyntaxError)
  })
})
