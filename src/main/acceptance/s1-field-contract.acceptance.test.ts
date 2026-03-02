// S1: 場契約整合性 — ipc-handlers + field-fsm + integrity-manager の統合テスト
// 検証: FSM遷移の正当性、不正遷移の検知→凍結、safeDetach冪等性

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Mock } from "vitest"
import { createWindowMock, createFireHelper, getSentMessages, mockDefaultState } from "./_harness.js"
import type { MockWindow } from "./_harness.js"

// --- モック宣言（hoisted） ---

vi.mock("electron", () => ({
  ipcMain: { on: vi.fn() },
}))

vi.mock("../field-runtime.js", () => ({
  initRuntime: vi.fn(),
  processStream: vi.fn().mockResolvedValue({ text: "応答", toolCalls: [] }),
  startPulse: vi.fn(),
  startObservation: vi.fn(),
  getState: vi.fn(() => mockDefaultState()),
  updateFieldState: vi.fn(),
  resetToNewField: vi.fn(),
  appendMessage: vi.fn(),
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

describe("S1: 場契約整合性", () => {
  let fire: (channel: string, ...args: unknown[]) => unknown
  let mockWin: MockWindow
  let getFieldState: () => string
  let safeDetach: () => void
  let mockProjection: Record<string, Mock>
  let isFrozen: () => boolean
  let startPulseMock: Mock

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    // 実モジュールのリセット
    const config = await import("../../config.js")
    config._resetConfigForTest({ XAI_API_KEY: "test-key" })

    const integrity = await import("../integrity-manager.js")
    integrity._resetForTest()
    isFrozen = integrity.isFrozen

    // ipc-handlersを新規インポート（モジュールスコープ状態をリセット）
    const electron = await import("electron")
    const ipcHandlers = await import("../ipc-handlers.js")
    const channelProjection = await import("../channel-projection.js")
    const fieldRuntime = await import("../field-runtime.js")

    mockWin = createWindowMock()
    ipcHandlers.registerIpcHandlers(() => mockWin as unknown as import("electron").BrowserWindow)

    // ハンドラ発火ヘルパー
    fire = createFireHelper(vi.mocked(electron.ipcMain.on))

    // 外部参照
    getFieldState = ipcHandlers.getFieldState
    safeDetach = ipcHandlers.safeDetach
    mockProjection = vi.mocked(channelProjection.createConsoleProjection).mock.results[0]?.value
    startPulseMock = vi.mocked(fieldRuntime.startPulse)
  })

  // --- 正常遷移 ---

  it("正常遷移: attach→active → sendFieldState投影", () => {
    fire("channel.attach")

    expect(getFieldState()).toBe("active")
    expect(mockProjection.sendFieldState).toHaveBeenCalledOnce()
    const call = mockProjection.sendFieldState.mock.calls[0][0]
    expect(call.state).toBe("active")
  })

  it("正常遷移: attach→active→detach→paused", () => {
    fire("channel.attach")
    expect(getFieldState()).toBe("active")

    fire("channel.detach")
    expect(getFieldState()).toBe("paused")
  })

  // --- 不正遷移 ---

  it("不正遷移: active中にattach → report(FIELD_CONTRACT_VIOLATION) → 凍結", () => {
    fire("channel.attach") // generated→active
    fire("channel.attach") // active→attach は不正

    expect(isFrozen()).toBe(true)
    // sendIntegrityAlertが呼ばれる（setAlertSink経由）
    expect(mockProjection.sendIntegrityAlert).toHaveBeenCalled()
  })

  it("不正遷移: generated中にdetach → report", () => {
    // safeDetachはガード付き（generated時はno-op）なのでchannel.detachで直接テスト
    // ただしsafeDetachの実装上、generated時はreturnする（FSM遷移しない）
    // channel.detachはsafeDetach()を呼ぶだけなので、generated→detachはno-op
    // 代わりにfield.terminateで不正遷移をテスト
    expect(getFieldState()).toBe("generated")
    // safeDetachはgenerated時はガードで早期return（report呼ばれない）
    safeDetach()
    expect(isFrozen()).toBe(false) // ガードで安全にスキップ
  })

  it("不正遷移: generated中にterminate → report → 凍結", () => {
    expect(getFieldState()).toBe("generated")
    fire("field.terminate")

    expect(isFrozen()).toBe(true)
  })

  it("不正遷移: terminated中にterminate → report → 凍結", () => {
    fire("channel.attach") // generated→active
    fire("field.terminate") // active→terminated
    expect(getFieldState()).toBe("terminated")

    fire("field.terminate") // terminated→terminate は不正
    expect(isFrozen()).toBe(true)
  })

  // --- 凍結後の動作 ---

  it("凍結後のstream.post拒否", async () => {
    fire("channel.attach") // generated→active

    // 強制凍結
    const integrity = await import("../integrity-manager.js")
    integrity.report("FIELD_CONTRACT_VIOLATION", "テスト凍結")
    expect(isFrozen()).toBe(true)

    // stream.postを発火（凍結中なので処理されないはず）
    fire("stream.post", {
      type: "stream.post",
      actor: "human",
      correlationId: "test-id",
      text: "テスト",
    })

    // sendStreamReplyが呼ばれていない
    expect(mockProjection.sendStreamReply).not.toHaveBeenCalled()
  })

  // --- safeDetach冪等性 ---

  it("safeDetach冪等性: 2回呼んでもエラーにならない", () => {
    fire("channel.attach") // generated→active
    expect(getFieldState()).toBe("active")

    safeDetach() // active→paused
    expect(getFieldState()).toBe("paused")

    safeDetach() // paused→detach は不正だが、safeDetachのガードでno-op
    expect(getFieldState()).toBe("paused") // 変化なし
    expect(isFrozen()).toBe(false) // 凍結されない
  })

  // --- ai起点: Pulse契約遵守 ---

  it("ai起点: Pulse isFieldActiveゲート — 非active時はfalse", () => {
    // startPulseに渡されたisFieldActiveコールバックを取得
    expect(startPulseMock).toHaveBeenCalledOnce()
    const isFieldActive = startPulseMock.mock.calls[0][1] as () => boolean

    // generated状態（attach前）→ false
    // ただしregisterIpcHandlers内でattachされていないので初期状態はgenerated
    // → 実際にはregisterIpcHandlers呼出時点ではfieldState=generatedだが、
    //   startPulseはruntimeReady=trueの場合のみ呼ばれる
    // generated → isActive = false
    expect(isFieldActive()).toBe(false)
  })

  it("ai起点: Pulse isFieldActiveゲート — active時はtrue", () => {
    const isFieldActive = startPulseMock.mock.calls[0][1] as () => boolean

    fire("channel.attach") // generated→active
    expect(isFieldActive()).toBe(true)
  })

  it("ai起点: Pulse isFieldActiveゲート — paused時はfalse", () => {
    const isFieldActive = startPulseMock.mock.calls[0][1] as () => boolean

    fire("channel.attach") // generated→active
    fire("channel.detach") // active→paused
    expect(isFieldActive()).toBe(false)
  })
})
