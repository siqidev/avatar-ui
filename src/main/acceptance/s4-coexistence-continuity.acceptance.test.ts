// S4: 共存連続性 — state-repository + field-runtime の永続化・復元
// 検証: 永続化→復元、起動時補正、チェーンTTL、terminated後リセット、messageHistory復元投影
// 方式: 実ファイルI/O（tmpディレクトリ）+ vi.resetModules()でMain再起動をシミュレート

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { createWindowMock, createFireHelper, setupTempDataDir, cleanupTempDataDir } from "./_harness.js"

// --- モック宣言（S2/S3と同一: field-runtimeは実物） ---

vi.mock("electron", () => ({
  ipcMain: { on: vi.fn(), handle: vi.fn() },
}))

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(_opts: unknown) { /* noop */ }
  },
}))

vi.mock("node-cron", () => ({
  default: { schedule: vi.fn() },
}))

vi.mock("../../services/chat-session-service.js", () => ({
  sendMessage: vi.fn().mockResolvedValue({
    text: "AI応答",
    displayText: "AI応答",
    toolCalls: [],
  }),
}))

vi.mock("../../roblox/observation-server.js", () => ({
  startObservationServer: vi.fn().mockReturnValue({ close: vi.fn() }),
}))

vi.mock("../../roblox/observation-formatter.js", () => ({
  formatObservation: vi.fn().mockReturnValue("[Chat] test: hello"),
}))

vi.mock("../../x/x-webhook-server.js", () => ({
  startXWebhookServer: vi.fn().mockReturnValue({ close: vi.fn() }),
}))

vi.mock("../../x/x-event-formatter.js", () => ({
  formatXEvent: vi.fn().mockReturnValue("[X] @user: hello"),
  formatXEventForAI: vi.fn().mockReturnValue("[X_MENTION] @user: hello"),
}))

vi.mock("../../x/x-forwarding-policy.js", () => ({
  shouldForwardXEventToAI: vi.fn().mockReturnValue(true),
}))

vi.mock("../channel-projection.js", () => ({
  createConsoleProjection: vi.fn(() => ({
    sendIntegrityAlert: vi.fn(),
  })),
}))

// message-recorder: S4ではモックしない（実際のappendMessage→永続化を検証するため）

vi.mock("../../logger.js", () => ({
  info: vi.fn(),
  error: vi.fn(),
}))

// --- ヘルパー ---

let tempDir: string

// テスト環境を初期化し、registerIpcHandlersを実行する
async function setupRuntime() {
  const config = await import("../../config.js")
  const appConfig = config._resetConfigForTest({ XAI_API_KEY: "test-key" })
  Object.assign(appConfig, {
    beingFile: path.join(tempDir, "being.md"),
    pulseDir: path.join(tempDir, "pulse"),
    dataDir: tempDir,
    stateFile: path.join(tempDir, "state.json"),
  })

  const integrity = await import("../../runtime/integrity-manager.js")
  integrity._resetForTest()

  const electron = await import("electron")
  const ipcHandlers = await import("../ipc-handlers.js")

  const mockWin = createWindowMock()
  ipcHandlers.registerIpcHandlers(() => mockWin as unknown as import("electron").BrowserWindow)

  const fire = createFireHelper(vi.mocked(electron.ipcMain.on), vi.mocked(electron.ipcMain.handle))

  return {
    fire,
    getFieldState: ipcHandlers.getFieldState,
    handleStreamPost: ipcHandlers.handleStreamPost,
    getStateSnapshot: ipcHandlers.getStateSnapshot,
  }
}

function readStateJson() {
  const stateFile = path.join(tempDir, "state.json")
  if (!fs.existsSync(stateFile)) return null
  return JSON.parse(fs.readFileSync(stateFile, "utf-8"))
}

function writeStateJson(state: Record<string, unknown>) {
  fs.writeFileSync(path.join(tempDir, "state.json"), JSON.stringify(state))
}

// --- テスト ---

describe("S4: 共存連続性", () => {
  beforeEach(() => {
    tempDir = setupTempDataDir()
    fs.writeFileSync(path.join(tempDir, "being.md"), "テスト用BEING")
  })

  afterEach(() => {
    cleanupTempDataDir()
  })

  // --- 永続化 ---

  it("永続化: attach→stream.post→detach後、state.jsonにfieldState='paused' + messageHistory保存", async () => {
    vi.resetModules()
    vi.clearAllMocks()

    const { fire, handleStreamPost } = await setupRuntime()

    fire("channel.attach") // generated→active

    // stream.postでメッセージ送信（WS移行後はhandleStreamPost直接呼出）
    await handleStreamPost("こんにちは", "test-id", "human")

    fire("channel.detach") // active→paused

    // state.jsonを確認
    const state = readStateJson()
    expect(state).not.toBeNull()
    expect(state.field.state).toBe("paused")
    expect(state.field.messageHistory.length).toBeGreaterThan(0)
  })

  // --- 復元 ---

  it("復元: state.jsonから再init → paused → attach → active", async () => {
    // 1回目: 接続→メッセージ→切断
    vi.resetModules()
    vi.clearAllMocks()
    const { fire: fire1, handleStreamPost: post1 } = await setupRuntime()
    fire1("channel.attach")
    await post1("テスト", "test-id", "human")
    fire1("channel.detach")

    // 2回目: Main再起動シミュレート
    vi.resetModules()
    vi.clearAllMocks()
    const { fire: fire2, getFieldState } = await setupRuntime()

    // initRuntime後、paused に復元されている
    // attach: paused→resumed→active
    fire2("channel.attach")
    expect(getFieldState()).toBe("active")
  })

  // --- 起動時補正 ---

  it("起動時補正: fieldState=active状態のstate.json → initRuntime() → paused", async () => {
    // activeのままのstate.jsonを書き込む（異常終了シミュレート）
    writeStateJson({
      schemaVersion: 1,
      field: { state: "active", messageHistory: [] },
      participant: { lastResponseId: "resp-123", lastResponseAt: new Date().toISOString() },
    })

    vi.resetModules()
    vi.clearAllMocks()
    const { getFieldState } = await setupRuntime()

    // 起動時補正: active → paused
    // getFieldStateはipc-handlers側の状態。registerIpcHandlers内でgetState()から復元される
    expect(getFieldState()).toBe("paused")

    // state.jsonにも補正が反映されている
    const state = readStateJson()
    expect(state.field.state).toBe("paused")
  })

  // --- チェーンTTL超過 ---

  it("チェーンTTL超過: 30日超のlastResponseAt → lastResponseId null化", async () => {
    // 31日前のタイムスタンプでstate.jsonを作成
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    writeStateJson({
      schemaVersion: 1,
      field: { state: "paused", messageHistory: [] },
      participant: { lastResponseId: "old-resp-id", lastResponseAt: oldDate },
    })

    vi.resetModules()
    vi.clearAllMocks()
    await setupRuntime()

    // TTL超過でlastResponseIdがnull化されている
    const state = readStateJson()
    expect(state.participant.lastResponseId).toBeNull()
    expect(state.participant.lastResponseAt).toBeNull()
  })

  // --- terminated後リセット ---

  it("terminated後リセット: terminated→attach → resetToNewField → 新規場", async () => {
    // terminatedのstate.jsonを作成
    writeStateJson({
      schemaVersion: 1,
      field: {
        state: "terminated",
        messageHistory: [{ actor: "human", text: "旧メッセージ" }],
      },
      participant: { lastResponseId: "old-resp", lastResponseAt: new Date().toISOString() },
    })

    vi.resetModules()
    vi.clearAllMocks()
    const { fire, getFieldState } = await setupRuntime()

    // terminatedから復元
    expect(getFieldState()).toBe("terminated")

    // attach → resetToNewField → generated → active
    fire("channel.attach")
    expect(getFieldState()).toBe("active")

    // state.jsonが新規場にリセットされている
    const state = readStateJson()
    expect(state.field.messageHistory).toEqual([])
    expect(state.participant.lastResponseId).toBeNull()
  })

  // --- messageHistory復元投影 ---

  it("messageHistory復元投影: attach後にgetStateSnapshotで履歴が取得できる", async () => {
    // 履歴付きのstate.jsonを作成
    writeStateJson({
      schemaVersion: 1,
      field: {
        state: "paused",
        messageHistory: [
          { actor: "human", text: "テスト入力" },
          { actor: "ai", text: "テスト応答" },
        ],
      },
      participant: { lastResponseId: "resp-123", lastResponseAt: new Date().toISOString() },
    })

    vi.resetModules()
    vi.clearAllMocks()
    const { fire, getStateSnapshot } = await setupRuntime()

    // attach: paused→resumed→active
    fire("channel.attach")

    // getStateSnapshotで履歴が正しく取得できる
    const snapshot = getStateSnapshot()
    const streamItems = snapshot.history.filter((h) => h.type === "stream")
    expect(streamItems.length).toBe(2)
    expect(streamItems[0].text).toBe("テスト入力")
    expect(streamItems[1].text).toBe("テスト応答")
  })
})
