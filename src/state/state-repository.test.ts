import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import { loadState, saveState, defaultState, pushMessage, pushMonitorEvent } from "./state-repository.js"
import type { PersistedMessage, PersistedMonitorEvent } from "./state-repository.js"
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
    const result = loadState()
    expect(result.state).toEqual(defaultState())
    expect(result.recoveredFromPrev).toBe(false)
  })

  it("保存した状態を読み込める", () => {
    const state = defaultState()
    state.participant.lastResponseId = "resp_test_123"
    state.participant.lastResponseAt = "2026-03-01T00:00:00.000Z"
    saveState(state)

    const result = loadState()
    expect(result.state.participant.lastResponseId).toBe("resp_test_123")
    expect(result.state.participant.lastResponseAt).toBe("2026-03-01T00:00:00.000Z")
    expect(result.recoveredFromPrev).toBe(false)
  })

  it("旧形式（{ lastResponseId }）からマイグレーションできる", () => {
    fs.writeFileSync(
      TEST_STATE_FILE,
      JSON.stringify({ lastResponseId: "resp_old_456", memory: { syncCursorId: "old" } }),
    )

    const result = loadState()
    expect(result.state.participant.lastResponseId).toBe("resp_old_456")
    expect(result.state.field.state).toBe("generated")
    expect(result.state.field.messageHistory).toEqual([])
    expect(result.recoveredFromPrev).toBe(false)
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

    const result = loadState()
    expect(result.state.field.state).toBe("paused")
    expect(result.state.field.messageHistory).toHaveLength(2)
    expect(result.state.field.messageHistory[0].text).toBe("こんにちは")
    expect(result.state.participant.lastResponseId).toBe("resp_new_789")
    expect(result.recoveredFromPrev).toBe(false)
  })

  it("不正なJSONは.prevフォールバック → デフォルト状態で復帰", () => {
    fs.writeFileSync(TEST_STATE_FILE, "invalid json")
    const result = loadState()
    // .prevも存在しないためdefaultState()にフォールバック
    expect(result.state).toEqual(defaultState())
    expect(result.recoveredFromPrev).toBe(true)
    // 破損ファイルは.corruptedにリネームされる
    expect(fs.existsSync(`${TEST_STATE_FILE}.corrupted`)).toBe(true)
  })

  it("不正なJSON + .prevが存在する場合、.prevから復帰", () => {
    // .prevに正常な状態を保存
    const prevState = defaultState()
    prevState.field.state = "paused"
    prevState.participant.lastResponseId = "resp_prev_123"
    fs.writeFileSync(`${TEST_STATE_FILE}.prev`, JSON.stringify(prevState, null, 2))

    // state.jsonを破損させる
    fs.writeFileSync(TEST_STATE_FILE, "corrupted!!!")

    const result = loadState()
    expect(result.state.field.state).toBe("paused")
    expect(result.state.participant.lastResponseId).toBe("resp_prev_123")
    expect(result.recoveredFromPrev).toBe(true)
  })

  it("atomic write: 書き込み後にtmpファイルが残らない", () => {
    const state = defaultState()
    saveState(state)

    expect(fs.existsSync(TEST_STATE_FILE)).toBe(true)
    expect(fs.existsSync(`${TEST_STATE_FILE}.tmp`)).toBe(false)
  })

  it("saveState: 1世代バックアップ（.prev）を作成する", () => {
    const state1 = defaultState()
    state1.participant.lastResponseId = "resp_v1"
    saveState(state1)

    const state2 = defaultState()
    state2.participant.lastResponseId = "resp_v2"
    saveState(state2)

    // state.jsonは最新版
    const current = JSON.parse(fs.readFileSync(TEST_STATE_FILE, "utf-8"))
    expect(current.participant.lastResponseId).toBe("resp_v2")

    // .prevは1つ前の版
    const prev = JSON.parse(fs.readFileSync(`${TEST_STATE_FILE}.prev`, "utf-8"))
    expect(prev.participant.lastResponseId).toBe("resp_v1")
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
        toolCalls: [{ name: "save_memory", args: { text: "記憶内容", importance: 0.7 }, result: "ok" }],
      })
      expect(history[0].source).toBe("pulse")
      expect(history[0].toolCalls).toHaveLength(1)
      expect(history[0].toolCalls![0].args).toEqual({ text: "記憶内容", importance: 0.7 })
    })
  })

  describe("pushMonitorEvent", () => {
    it("イベントを追加できる", () => {
      const history: PersistedMonitorEvent[] = []
      pushMonitorEvent(history, { eventType: "chat", formatted: "[Chat] test", timestamp: "2026-03-17T10:00:00Z" })
      expect(history).toHaveLength(1)
      expect(history[0].eventType).toBe("chat")
      expect(history[0].formatted).toBe("[Chat] test")
      expect(history[0].timestamp).toBe("2026-03-17T10:00:00Z")
    })

    it("長すぎるformattedを切り詰める（500文字上限）", () => {
      const history: PersistedMonitorEvent[] = []
      pushMonitorEvent(history, { eventType: "chat", formatted: "x".repeat(600), timestamp: "2026-03-17T10:00:00Z" })
      expect(history[0].formatted).toHaveLength(500)
    })

    it("50件を超えると古いものから削除される", () => {
      const history: PersistedMonitorEvent[] = []
      for (let i = 0; i < 60; i++) {
        pushMonitorEvent(history, { eventType: "chat", formatted: `msg_${i}`, timestamp: `2026-03-17T10:${String(i).padStart(2, "0")}:00Z` })
      }
      expect(history).toHaveLength(50)
      expect(history[0].formatted).toBe("msg_10")
    })
  })
})
