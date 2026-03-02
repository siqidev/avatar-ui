import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import { loadState, saveState, defaultState, pushMessage } from "./state-repository.js"
import type { PersistedMessage } from "./state-repository.js"
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
    state.participant.lastResponseId = "resp_test_123"
    state.participant.lastResponseAt = "2026-03-01T00:00:00.000Z"
    saveState(state)

    const loaded = loadState()
    expect(loaded.participant.lastResponseId).toBe("resp_test_123")
    expect(loaded.participant.lastResponseAt).toBe("2026-03-01T00:00:00.000Z")
  })

  it("旧形式（{ lastResponseId }）からマイグレーションできる", () => {
    fs.writeFileSync(
      TEST_STATE_FILE,
      JSON.stringify({ lastResponseId: "resp_old_456", memory: { syncCursorId: "old" } }),
    )

    const state = loadState()
    expect(state.participant.lastResponseId).toBe("resp_old_456")
    expect(state.field.state).toBe("generated")
    expect(state.field.messageHistory).toEqual([])
  })

  it("新形式のstate.jsonを正しく読み込める", () => {
    const state = defaultState()
    state.field.state = "paused"
    state.field.messageHistory = [
      { actor: "human", text: "こんにちは" },
      { actor: "ai", text: "はい、こんにちは" },
    ]
    state.participant.lastResponseId = "resp_new_789"
    state.participant.lastResponseAt = "2026-03-02T12:00:00.000Z"
    saveState(state)

    const loaded = loadState()
    expect(loaded.field.state).toBe("paused")
    expect(loaded.field.messageHistory).toHaveLength(2)
    expect(loaded.field.messageHistory[0].text).toBe("こんにちは")
    expect(loaded.participant.lastResponseId).toBe("resp_new_789")
  })

  it("不正なJSONはthrowする（fail-fast）", () => {
    fs.writeFileSync(TEST_STATE_FILE, "invalid json")
    expect(() => loadState()).toThrow(SyntaxError)
  })

  it("atomic write: 書き込み後にtmpファイルが残らない", () => {
    const state = defaultState()
    saveState(state)

    expect(fs.existsSync(TEST_STATE_FILE)).toBe(true)
    expect(fs.existsSync(`${TEST_STATE_FILE}.tmp`)).toBe(false)
  })

  describe("pushMessage", () => {
    it("メッセージを追加できる", () => {
      const history: PersistedMessage[] = []
      pushMessage(history, { actor: "human", text: "テスト" })
      expect(history).toHaveLength(1)
      expect(history[0].text).toBe("テスト")
    })

    it("長すぎるテキストを切り詰める（4000文字上限）", () => {
      const history: PersistedMessage[] = []
      const longText = "a".repeat(5000)
      pushMessage(history, { actor: "ai", text: longText })
      expect(history[0].text).toHaveLength(4000)
    })

    it("toolCallsのresultを切り詰める（800文字上限）", () => {
      const history: PersistedMessage[] = []
      pushMessage(history, {
        actor: "ai",
        text: "応答",
        toolCalls: [{ name: "test_tool", result: "r".repeat(1000) }],
      })
      expect(history[0].toolCalls![0].result).toHaveLength(800)
    })

    it("120件を超えると古いものから削除される", () => {
      const history: PersistedMessage[] = []
      for (let i = 0; i < 130; i++) {
        pushMessage(history, { actor: "human", text: `msg_${i}` })
      }
      expect(history).toHaveLength(120)
      expect(history[0].text).toBe("msg_10") // 最初の10件が削除
    })

    it("sourceとtoolCallsが保持される", () => {
      const history: PersistedMessage[] = []
      pushMessage(history, {
        actor: "ai",
        text: "応答",
        source: "pulse",
        toolCalls: [{ name: "save_memory", result: "ok" }],
      })
      expect(history[0].source).toBe("pulse")
      expect(history[0].toolCalls).toHaveLength(1)
    })
  })
})
