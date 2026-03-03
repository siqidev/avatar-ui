// S3: 往復連接性 — enqueue直列化 + エラー耐性
// 検証: 同時投入の直列化、エラー後継続、凍結時スキップ、凍結時完了保証、ai起点の連接
// 方式: field-runtimeは実物、sendMessageをモックしてPromise制御

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Mock } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { createWindowMock, createFireHelper, setupTempDataDir, cleanupTempDataDir } from "./_harness.js"

// --- モック宣言（S2と同一構成: field-runtimeは実物） ---

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
  sendMessage: vi.fn().mockResolvedValue({ text: "応答", toolCalls: [] }),
}))

vi.mock("../../roblox/observation-server.js", () => ({
  startObservationServer: vi.fn().mockReturnValue({ close: vi.fn() }),
}))

vi.mock("../../roblox/observation-formatter.js", () => ({
  formatObservation: vi.fn().mockReturnValue("[Chat] test: hello"),
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

describe("S3: 往復連接性", () => {
  let fire: (channel: string, ...args: unknown[]) => unknown
  let mockSendMessage: Mock
  let tempDir: string

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    tempDir = setupTempDataDir()
    fs.writeFileSync(path.join(tempDir, "being.md"), "テスト用BEING")
    fs.writeFileSync(path.join(tempDir, "pulse.md"), "パルスプロンプト")

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
    const chatService = await import("../../services/chat-session-service.js")

    mockSendMessage = vi.mocked(chatService.sendMessage)

    const mockWin = createWindowMock()
    ipcHandlers.registerIpcHandlers(() => mockWin as unknown as import("electron").BrowserWindow)

    fire = createFireHelper(vi.mocked(electron.ipcMain.on))

    // 場をactiveにする
    fire("channel.attach")
  })

  afterEach(() => {
    cleanupTempDataDir()
  })

  function makeStreamPost(id: string, text: string) {
    return {
      type: "stream.post",
      actor: "human",
      correlationId: id,
      text,
    }
  }

  // --- 直列化: 同時2件 ---

  it("直列化: 同時2件投入 → sendMessage呼出が直列（1件目完了後に2件目開始）", async () => {
    const callOrder: string[] = []
    let resolveFirst!: (value: { text: string; toolCalls: never[] }) => void

    // 1件目: Promiseを手動制御
    mockSendMessage.mockImplementationOnce(() => {
      callOrder.push("first-start")
      return new Promise(resolve => {
        resolveFirst = (val) => {
          callOrder.push("first-end")
          resolve(val)
        }
      })
    })

    // 2件目: 即座にresolve
    mockSendMessage.mockImplementationOnce(() => {
      callOrder.push("second-start")
      return Promise.resolve({ text: "応答2", toolCalls: [] })
    })

    // 同時に2件投入
    fire("stream.post", makeStreamPost("id-1", "テスト1"))
    fire("stream.post", makeStreamPost("id-2", "テスト2"))

    // 1件目が開始されるのを待つ
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(callOrder).toEqual(["first-start"]) // 2件目はまだ開始されていない

    // 1件目を完了させる
    resolveFirst({ text: "応答1", toolCalls: [] as never[] })
    await new Promise(resolve => setTimeout(resolve, 10))

    // 直列実行: first-start → first-end → second-start
    expect(callOrder).toEqual(["first-start", "first-end", "second-start"])
  })

  // --- 凍結遷移時の待機ジョブ完了保証 ---

  it("凍結遷移時の待機ジョブ完了保証: キュー待ちのprocessStreamがrejectで完了する", async () => {
    let resolveFirst!: (value: { text: string; toolCalls: never[] }) => void

    // 1件目: Promiseを手動制御
    mockSendMessage.mockImplementationOnce(() => {
      return new Promise(resolve => { resolveFirst = resolve })
    })

    // 1件目を投入（実行開始、await中）
    fire("stream.post", makeStreamPost("id-1", "テスト1"))
    await new Promise(resolve => setTimeout(resolve, 10))

    // 2件目を投入（キュー待ち）
    // processStreamが返すPromiseをキャプチャ（stream.postハンドラはfire-and-forget）
    // 代わりにfield-runtimeのprocessStreamを直接呼ぶ
    const fieldRuntime = await import("../field-runtime.js")
    const pendingPromise = fieldRuntime.processStream("テスト2")

    // 凍結する
    const integrity = await import("../integrity-manager.js")
    integrity.report("FIELD_CONTRACT_VIOLATION", "テスト凍結")

    // 1件目を完了（キューが2件目に移る→凍結チェック→スキップ→reject）
    resolveFirst({ text: "応答1", toolCalls: [] as never[] })

    // 2件目のPromiseがrejectされることを確認（ハングしない）
    await expect(pendingPromise).rejects.toThrow("凍結中")
  })

  // --- エラー後継続 ---

  it("エラー後継続: 1件目がAPIエラー → warn発火 → 2件目は正常処理", async () => {
    // 1件目: エラーを投げる
    mockSendMessage.mockRejectedValueOnce(new Error("API障害"))

    // 2件目: 正常応答
    mockSendMessage.mockResolvedValueOnce({ text: "応答2", toolCalls: [] })

    // 同時に2件投入
    fire("stream.post", makeStreamPost("id-1", "テスト1"))
    fire("stream.post", makeStreamPost("id-2", "テスト2"))

    await new Promise(resolve => setTimeout(resolve, 20))

    // 2件目が正常に処理された（sendMessageが2回呼ばれた）
    expect(mockSendMessage).toHaveBeenCalledTimes(2)

    // 凍結はしていない（warnはfreezeしない）
    const integrity = await import("../integrity-manager.js")
    expect(integrity.isFrozen()).toBe(false)
  })

  // --- 凍結時スキップ ---

  it("凍結時スキップ: 凍結後のstream.postはenqueueされない", async () => {
    // 先に凍結する
    const integrity = await import("../integrity-manager.js")
    integrity.report("FIELD_CONTRACT_VIOLATION", "テスト凍結")

    // stream.postを発火
    fire("stream.post", makeStreamPost("id-frozen", "凍結中テスト"))
    await new Promise(resolve => setTimeout(resolve, 10))

    // ipc-handlers側のisFrozen()ガードで弾かれるため、sendMessageは呼ばれない
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  // --- ai起点の連接 ---

  it("ai起点の連接: Pulse発火中にstream.post → 直列化される", async () => {
    const callOrder: string[] = []
    let resolvePulse!: (value: { text: string; toolCalls: never[] }) => void

    // Pulse用のsendMessage: 手動制御
    mockSendMessage.mockImplementationOnce(() => {
      callOrder.push("pulse-start")
      return new Promise(resolve => {
        resolvePulse = (val) => {
          callOrder.push("pulse-end")
          resolve(val)
        }
      })
    })

    // stream.post用: 即座にresolve
    mockSendMessage.mockImplementationOnce(() => {
      callOrder.push("user-start")
      return Promise.resolve({ text: "ユーザー応答", toolCalls: [] })
    })

    // Pulse発火（cron.scheduleのコールバック取得）
    const cron = await import("node-cron")
    const cronCallback = vi.mocked(cron.default.schedule).mock.calls[0]?.[1] as () => void
    expect(cronCallback).toBeDefined()

    cronCallback()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(callOrder).toEqual(["pulse-start"]) // Pulseが実行中

    // Pulse実行中にstream.postを投入
    fire("stream.post", makeStreamPost("id-user", "ユーザー入力"))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(callOrder).toEqual(["pulse-start"]) // まだPulse実行中、userは待ち

    // Pulseを完了させる
    resolvePulse({ text: "Pulse応答", toolCalls: [] as never[] })
    await new Promise(resolve => setTimeout(resolve, 10))

    // 直列: pulse-start → pulse-end → user-start
    expect(callOrder).toEqual(["pulse-start", "pulse-end", "user-start"])
  })
})
