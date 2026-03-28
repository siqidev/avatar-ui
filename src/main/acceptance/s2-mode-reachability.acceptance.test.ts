// S2: モード可達性 — 3入力経路の区別と投影
// 検証: user/pulse/observation経路、correlationId形式、isFieldActiveゲート、Pulse抑制、roblox_log分岐
// 方式: field-runtimeは実物（実際のID生成経路を通す）、深い依存（API/cron/観測サーバー）をモック

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Mock } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { createWindowMock, createFireHelper, setupTempDataDir, cleanupTempDataDir } from "./_harness.js"
import type { MockWindow } from "./_harness.js"
import type { SessionEvent } from "../../shared/session-event-schema.js"

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
  let mockSendMessage: Mock
  let cronCallback: () => void
  let observationHandler: (event: Record<string, unknown>) => void
  let tempDir: string
  // イベントバスから収集したイベント
  let capturedEvents: SessionEvent[]
  let unsubscribe: () => void
  // handleStreamPost（stream.postのIPC廃止に伴い直接呼出）
  let handleStreamPost: (text: string, correlationId: string, actor: "human" | "ai") => Promise<void>

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

    // settings-store初期化（共振=on: 既存テストはAI転送を前提とする）
    const settingsStore = await import("../../runtime/settings-store.js")
    settingsStore.loadSettings(tempDir)
    settingsStore.updateSettings({ resonance: true })

    const integrity = await import("../../runtime/integrity-manager.js")
    integrity._resetForTest()

    // イベントバス購読（session-event-busは非モック。publishされたイベントを収集する）
    const eventBus = await import("../../runtime/session-event-bus.js")
    eventBus._resetForTest()
    capturedEvents = []
    unsubscribe = eventBus.subscribe((event) => capturedEvents.push(event))

    const electron = await import("electron")
    const ipcHandlers = await import("../ipc-handlers.js")
    const chatService = await import("../../services/chat-session-service.js")
    const cron = await import("node-cron")
    const obsServer = await import("../../roblox/observation-server.js")

    mockWin = createWindowMock()
    ipcHandlers.registerIpcHandlers(() => mockWin as unknown as import("electron").BrowserWindow)
    handleStreamPost = ipcHandlers.handleStreamPost

    fire = createFireHelper(vi.mocked(electron.ipcMain.on), vi.mocked(electron.ipcMain.handle))
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
    unsubscribe?.()
    cleanupTempDataDir()
  })

  // フラッシュ: enqueueのPromiseチェーンを完了させる
  async function flushQueue() {
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  // イベントバスから stream.item を抽出
  function streamItems() {
    return capturedEvents
      .filter((e) => e.kind === "stream.item")
      .map((e) => e.payload as import("../../shared/session-event-schema.js").StreamItemPayload)
  }

  // イベントバスから monitor.item を抽出
  function monitorItems() {
    return capturedEvents
      .filter((e) => e.kind === "monitor.item")
      .map((e) => e.payload as import("../../shared/session-event-schema.js").MonitorItemPayload)
  }

  // --- human起点: stream.post ---

  it("human起点: handleStreamPost → processStream → stream.item(source='user')", async () => {
    mockSendMessage.mockResolvedValueOnce({
      text: "*Avatar says in Roblox chat:* \"やあ Sito！\"",
      displayText: "やあ Sito！",
      toolCalls: [],
    })

    await handleStreamPost("こんにちは", "user-test-123", "human")

    await flushQueue()

    // sendMessageが呼ばれる
    expect(mockSendMessage).toHaveBeenCalledOnce()

    // stream.itemがsource="user"で発行される（human入力 + ai応答の2件）
    const aiReply = streamItems().find((p) => p.actor === "ai")
    expect(aiReply).toBeDefined()
    expect(aiReply!.source).toBe("user")
    expect(aiReply!.correlationId).toBe("user-test-123")
    expect(aiReply!.text).toBe("やあ Sito！")
  })

  // --- ai起点: Pulse ---

  it("ai起点: Pulse応答 → stream.item(source='pulse')", async () => {
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

    // stream.itemがsource="pulse"で発行される（ai応答のみ、human側は不要）
    const pulseStreams = streamItems().filter((p) => p.source === "pulse")
    expect(pulseStreams).toHaveLength(1)

    const aiPulse = pulseStreams.find((p) => p.actor === "ai")
    expect(aiPulse).toBeDefined()
    expect(aiPulse!.text).toBe("Pulse表示文")
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

    // Monitorに観測イベント(monitor.item)が発行される
    const monitors = monitorItems()
    expect(monitors.some((m) => m.eventType === "player_chat")).toBe(true)

    // 観測入力はStreamに出ない（Monitorの役割）
    const humanObs = streamItems().find(
      (p) => p.source === "observation" && p.actor === "human",
    )
    expect(humanObs).toBeUndefined()

    // AI応答はStreamに出る（対話の役割）
    const aiObs = streamItems().find(
      (p) => p.source === "observation" && p.actor === "ai",
    )
    expect(aiObs).toBeDefined()
    expect(aiObs!.text).toBe("観測表示文")
  })

  // --- correlationId形式の区別 ---

  it("correlationId形式: pulse='pulse-*', observation='obs-*'", async () => {
    // Pulse
    cronCallback()
    await flushQueue()

    const pulseReply = streamItems().find(
      (p) => p.source === "pulse" && p.actor === "ai",
    )
    expect(pulseReply).toBeDefined()
    expect(pulseReply!.correlationId).toMatch(/^pulse-\d+$/)

    // 観測（AI応答のcorrelationIdで確認）
    vi.mocked(mockSendMessage).mockClear()
    capturedEvents = []

    observationHandler({
      type: "player_chat",
      payload: { player: "Bob", message: "hi" },
    })
    await flushQueue()

    const obsReply = streamItems().find(
      (p) => p.source === "observation" && p.actor === "ai",
    )
    expect(obsReply).toBeDefined()
    expect(obsReply!.correlationId).toMatch(/^obs-\d+$/)
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

  it("Pulse PULSE_OK抑制: 応答がPULSE_OK接頭辞ならstream.itemが発行されない", async () => {
    mockSendMessage.mockResolvedValueOnce({
      text: "PULSE_OK: 異常なし",
      displayText: "PULSE_OK: 異常なし",
      toolCalls: [],
    })

    cronCallback()
    await flushQueue()

    // sendMessageは呼ばれる
    expect(mockSendMessage).toHaveBeenCalledOnce()

    // stream.itemはsource="pulse"で発行されない（PULSE_OK抑制）
    const pulseReply = streamItems().find((p) => p.source === "pulse")
    expect(pulseReply).toBeUndefined()
  })

  // --- 共振ゲート ---

  it("共振OFF: 観測はMonitorに表示されるがAIには転送されない", async () => {
    // 共振をoffに切替
    const settingsStore = await import("../../runtime/settings-store.js")
    settingsStore.updateSettings({ resonance: false })

    observationHandler({
      type: "player_chat",
      payload: { player: "Alice", message: "hello" },
    })
    await flushQueue()

    // Monitorには表示（知覚は常時ON）
    const monitors = monitorItems()
    expect(monitors.some((m) => m.eventType === "player_chat")).toBe(true)

    // AIには転送しない（注意+表出は停止）
    expect(mockSendMessage).not.toHaveBeenCalled()

    // Streamにも出ない
    expect(streamItems()).toHaveLength(0)

    // 元に戻す
    settingsStore.updateSettings({ resonance: true })
  })

  // --- roblox_logはAI未送信 ---

  it("roblox_log: Monitorに表示・Streamには非表示・AI非送信", async () => {
    observationHandler({
      type: "roblox_log",
      payload: { message: "Server started" },
    })
    await flushQueue()

    // Monitorに表示（Roblox世界のログ）
    const monitors = monitorItems()
    expect(monitors.some((m) => m.eventType === "roblox_log")).toBe(true)

    // Streamには送らない（対話ではない）
    expect(streamItems()).toHaveLength(0)

    // AIには送らない
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  // --- 移動中proximity抑制 ---

  it("移動中proximity抑制: npc_motion中のplayer_proximityはAIに転送されない", async () => {
    // motion-stateを直接操作してnpc_motion実行中を模擬
    const motionState = await import("../../roblox/motion-state.js")
    motionState.startSuppression()

    observationHandler({
      type: "player_proximity",
      payload: { player: "SitoSiqi", action: "enter", distance: 9, userId: 123, isOwner: true },
    })
    await flushQueue()

    // Monitorには表示（知覚は常時ON）
    const monitors = monitorItems()
    expect(monitors.some((m) => m.eventType === "player_proximity")).toBe(true)

    // AIには転送しない（自己起因）
    expect(mockSendMessage).not.toHaveBeenCalled()

    // クリーンアップ
    motionState.endSuppression()
  })

  it("移動完了後のproximityは通常通りAIに転送される", async () => {
    const motionState = await import("../../roblox/motion-state.js")
    motionState.startSuppression()

    // go_to_player ACK到着 → 抑制解除
    observationHandler({
      type: "command_ack",
      payload: { intent_id: "test-intent", op_index: 0, op: "go_to_player", success: true, schema_version: "3", category: "", data: {} },
    })
    await flushQueue()

    // 抑制解除後のproximity
    mockSendMessage.mockResolvedValueOnce({
      text: "挨拶",
      displayText: "挨拶",
      toolCalls: [],
    })

    observationHandler({
      type: "player_proximity",
      payload: { player: "SitoSiqi", action: "enter", distance: 9, userId: 123, isOwner: true },
    })
    await flushQueue()

    // AIに転送される（新規の観測）
    expect(mockSendMessage).toHaveBeenCalledOnce()
  })
})
