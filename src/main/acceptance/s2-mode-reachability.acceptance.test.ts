// S2: モード可達性 — 3入力経路の区別と投影
// 検証: user/pulse/observation経路、correlationId形式、isFieldActiveゲート、Pulse抑制、roblox_log分岐
// 方式: field-runtimeは実物（実際のID生成経路を通す）、深い依存（API/cron/観測サーバー）をモック

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Mock } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { createWindowMock, createFireHelper, setupTempDataDir, cleanupTempDataDir } from "./_harness.js"
import type { MockWindow } from "./_harness.js"

// --- モック宣言（field-runtimeは実物、深い依存をモック） ---

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
  formatObservation: vi.fn().mockReturnValue("[Chat] Alice: hello"),
}))

vi.mock("../channel-projection.js", () => ({
  createConsoleProjection: vi.fn(() => ({
    sendStreamReply: vi.fn(),
    sendFieldState: vi.fn(),
    sendIntegrityAlert: vi.fn(),
    sendObservationEvent: vi.fn(),
  })),
}))

vi.mock("../message-recorder.js", () => ({
  recordMessage: vi.fn(),
}))

vi.mock("../../logger.js", () => ({
  info: vi.fn(),
  error: vi.fn(),
}))

// --- テスト ---

describe("S2: モード可達性", () => {
  let fire: (channel: string, ...args: unknown[]) => unknown
  let mockWin: MockWindow
  let mockProjection: Record<string, Mock>
  let mockSendMessage: Mock
  let cronCallback: () => void
  let observationHandler: (event: Record<string, unknown>) => void
  let tempDir: string

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    tempDir = setupTempDataDir()

    // テスト用ファイル作成
    fs.writeFileSync(path.join(tempDir, "being.md"), "テスト用BEING")
    fs.writeFileSync(path.join(tempDir, "pulse.md"), "パルスプロンプト")

    // config設定（Roblox有効化含む）
    const config = await import("../../config.js")
    const appConfig = config._resetConfigForTest({
      XAI_API_KEY: "test-key",
      ROBLOX_API_KEY: "test-roblox-key",
      ROBLOX_UNIVERSE_ID: "12345",
    })
    Object.assign(appConfig, {
      beingFile: path.join(tempDir, "being.md"),
      pulseFile: path.join(tempDir, "pulse.md"),
      dataDir: tempDir,
      stateFile: path.join(tempDir, "state.json"),
    })

    const integrity = await import("../integrity-manager.js")
    integrity._resetForTest()

    const electron = await import("electron")
    const ipcHandlers = await import("../ipc-handlers.js")
    const channelProjection = await import("../channel-projection.js")
    const chatService = await import("../../services/chat-session-service.js")
    const cron = await import("node-cron")
    const obsServer = await import("../../roblox/observation-server.js")

    mockWin = createWindowMock()
    ipcHandlers.registerIpcHandlers(() => mockWin as unknown as import("electron").BrowserWindow)

    fire = createFireHelper(vi.mocked(electron.ipcMain.on))
    mockProjection = vi.mocked(channelProjection.createConsoleProjection).mock.results[0]?.value
    mockSendMessage = vi.mocked(chatService.sendMessage)

    // cronコールバック取得（Pulse）
    const cronMock = vi.mocked(cron.default.schedule)
    cronCallback = cronMock.mock.calls[0]?.[1] as () => void

    // 観測ハンドラ取得
    const obsMock = vi.mocked(obsServer.startObservationServer)
    if (obsMock.mock.calls.length > 0) {
      observationHandler = obsMock.mock.calls[0][0] as (event: Record<string, unknown>) => void
    }

    // 場をactiveにする（ほとんどのテストで必要）
    fire("channel.attach")
  })

  afterEach(() => {
    cleanupTempDataDir()
  })

  // フラッシュ: enqueueのPromiseチェーンを完了させる
  async function flushQueue() {
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  // --- human起点: stream.post ---

  it("human起点: stream.post → processStream → sendStreamReply(source='user')", async () => {
    mockSendMessage.mockResolvedValueOnce({
      text: "*Avatar says in Roblox chat:* \"やあ Sito！\"",
      displayText: "やあ Sito！",
      toolCalls: [],
    })

    fire("stream.post", {
      type: "stream.post",
      actor: "human",
      correlationId: "user-test-123",
      text: "こんにちは",
    })

    await flushQueue()

    // sendMessageが呼ばれる
    expect(mockSendMessage).toHaveBeenCalledOnce()

    // sendStreamReplyがsource="user"で呼ばれる
    const replyCall = mockProjection.sendStreamReply.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).actor === "ai",
    )
    expect(replyCall).toBeDefined()
    expect(replyCall![0].source).toBe("user")
    expect(replyCall![0].correlationId).toBe("user-test-123")
    expect(replyCall![0].text).toBe("やあ Sito！")
  })

  // --- ai起点: Pulse ---

  it("ai起点: Pulse応答 → sendStreamReply(source='pulse')", async () => {
    expect(cronCallback).toBeDefined()
    mockSendMessage.mockResolvedValueOnce({
      text: "Pulse内部応答",
      displayText: "Pulse表示文",
      toolCalls: [],
    })

    cronCallback()
    await flushQueue()

    // sendMessageが呼ばれる（Pulse用）
    expect(mockSendMessage).toHaveBeenCalledOnce()

    // sendStreamReplyがsource="pulse"で呼ばれる（human + aiの2回）
    const replyCalls = mockProjection.sendStreamReply.mock.calls
    // attachで呼ばれた分を除外（sendFieldStateは別メソッド）
    expect(replyCalls.length).toBeGreaterThanOrEqual(2)

    const humanPulse = replyCalls.find(
      (c) => { const o = c[0] as Record<string, unknown>; return o.actor === "human" && o.source === "pulse" },
    )
    const aiPulse = replyCalls.find(
      (c) => { const o = c[0] as Record<string, unknown>; return o.actor === "ai" && o.source === "pulse" },
    )
    expect(humanPulse).toBeDefined()
    expect(aiPulse).toBeDefined()
    expect(aiPulse![0].text).toBe("Pulse表示文")
  })

  // --- ai起点: 観測 ---

  it("ai起点: 観測 → Monitor表示 + AI応答はStreamへ（観測入力はStream非表示）", async () => {
    expect(observationHandler).toBeDefined()
    mockSendMessage.mockResolvedValueOnce({
      text: "観測内部応答",
      displayText: "観測表示文",
      toolCalls: [],
    })

    observationHandler({
      type: "player_chat",
      payload: { player: "Alice", message: "hello" },
    })
    await flushQueue()

    // Monitorに観測イベント表示
    expect(mockProjection.sendObservationEvent).toHaveBeenCalled()

    // 観測入力はStreamに出ない（Monitorの役割）
    const humanObs = mockProjection.sendStreamReply.mock.calls.find(
      (c) => {
        const o = c[0] as Record<string, unknown>
        return o.source === "observation" && o.actor === "human"
      },
    )
    expect(humanObs).toBeUndefined()

    // AI応答はStreamに出る（対話の役割）
    const aiObs = mockProjection.sendStreamReply.mock.calls.find(
      (c) => {
        const o = c[0] as Record<string, unknown>
        return o.source === "observation" && o.actor === "ai"
      },
    )
    expect(aiObs).toBeDefined()
    expect(aiObs![0].text).toBe("観測表示文")
  })

  // --- correlationId形式の区別 ---

  it("correlationId形式: pulse='pulse-*', observation='obs-*'", async () => {
    // Pulse
    cronCallback()
    await flushQueue()

    const pulseReply = mockProjection.sendStreamReply.mock.calls.find(
      (c) => { const o = c[0] as Record<string, unknown>; return o.source === "pulse" && o.actor === "human" },
    )
    expect(pulseReply).toBeDefined()
    expect(pulseReply![0].correlationId).toMatch(/^pulse-\d+$/)

    // 観測（AI応答のcorrelationIdで確認）
    vi.mocked(mockSendMessage).mockClear()
    mockProjection.sendStreamReply.mockClear()

    observationHandler({
      type: "player_chat",
      payload: { player: "Bob", message: "hi" },
    })
    await flushQueue()

    const obsReply = mockProjection.sendStreamReply.mock.calls.find(
      (c) => {
        const o = c[0] as Record<string, unknown>
        return o.source === "observation" && o.actor === "ai"
      },
    )
    expect(obsReply).toBeDefined()
    expect(obsReply![0].correlationId).toMatch(/^obs-\d+$/)
  })

  // --- isFieldActiveゲート ---

  it("isFieldActiveゲート: paused時はPulse/観測が実行されない", async () => {
    fire("channel.detach") // active→paused

    // Pulse発火 → isFieldActive()=falseでスキップ
    cronCallback()
    await flushQueue()
    expect(mockSendMessage).not.toHaveBeenCalled()

    // 観測発火 → isFieldActive()=falseでスキップ（roblox_log以外）
    observationHandler({
      type: "player_chat",
      payload: { player: "Alice", message: "hello" },
    })
    await flushQueue()
    // sendMessageは呼ばれない（AIに送らない）
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  // --- Pulse PULSE_OK抑制 ---

  it("Pulse PULSE_OK抑制: 応答がPULSE_OK接頭辞ならonReplyが呼ばれない", async () => {
    mockSendMessage.mockResolvedValueOnce({
      text: "PULSE_OK: 異常なし",
      displayText: "PULSE_OK: 異常なし",
      toolCalls: [],
    })

    cronCallback()
    await flushQueue()

    // sendMessageは呼ばれる
    expect(mockSendMessage).toHaveBeenCalledOnce()

    // sendStreamReplyはsource="pulse"で呼ばれない（PULSE_OK抑制）
    const pulseReply = mockProjection.sendStreamReply.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).source === "pulse",
    )
    expect(pulseReply).toBeUndefined()
  })

  // --- roblox_logはAI未送信 ---

  it("roblox_log: Monitorに表示・Streamには非表示・AI非送信", async () => {
    observationHandler({
      type: "roblox_log",
      payload: { message: "Server started" },
    })
    await flushQueue()

    // Monitorに表示（Roblox世界のログ）
    expect(mockProjection.sendObservationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "roblox_log" }),
    )

    // Streamには送らない（対話ではない）
    expect(mockProjection.sendStreamReply).not.toHaveBeenCalled()

    // AIには送らない
    expect(mockSendMessage).not.toHaveBeenCalled()
  })
})
