// S5: ライフサイクル完走 — 全遷移の統合テスト
// 検証: generated→active→paused→resumed→terminated + 終端後の新規場リセット

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Mock } from "vitest"
import { createWindowMock, createFireHelper, mockDefaultState } from "./_harness.js"
import type { MockWindow } from "./_harness.js"

// --- モック宣言（S1と同一構成: field-runtimeをモック、FSM/integrityは実物） ---

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

describe("S5: ライフサイクル完走", () => {
  let fire: (channel: string, ...args: unknown[]) => unknown
  let mockWin: MockWindow
  let getFieldState: () => string
  let mockProjection: Record<string, Mock>
  let updateFieldStateMock: Mock
  let resetToNewFieldMock: Mock
  let startPulseMock: Mock

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    const config = await import("../../config.js")
    config._resetConfigForTest({ XAI_API_KEY: "test-key" })

    const integrity = await import("../integrity-manager.js")
    integrity._resetForTest()

    const electron = await import("electron")
    const ipcHandlers = await import("../ipc-handlers.js")
    const channelProjection = await import("../channel-projection.js")
    const fieldRuntime = await import("../field-runtime.js")

    mockWin = createWindowMock()
    ipcHandlers.registerIpcHandlers(() => mockWin as unknown as import("electron").BrowserWindow)

    fire = createFireHelper(vi.mocked(electron.ipcMain.on))
    getFieldState = ipcHandlers.getFieldState
    mockProjection = vi.mocked(channelProjection.createConsoleProjection).mock.results[0]?.value
    updateFieldStateMock = vi.mocked(fieldRuntime.updateFieldState)
    resetToNewFieldMock = vi.mocked(fieldRuntime.resetToNewField)
    startPulseMock = vi.mocked(fieldRuntime.startPulse)
  })

  // --- 完全走行 ---

  it("完全走行: generated→active→paused→resumed→active→terminated", () => {
    expect(getFieldState()).toBe("generated")

    // 1. attach: generated→active
    fire("channel.attach")
    expect(getFieldState()).toBe("active")

    // 2. detach: active→paused
    fire("channel.detach")
    expect(getFieldState()).toBe("paused")

    // 3. attach: paused→resumed→active（resumed は一時状態で即active遷移）
    fire("channel.attach")
    expect(getFieldState()).toBe("active")

    // 4. terminate: active→terminated
    fire("field.terminate")
    expect(getFieldState()).toBe("terminated")
  })

  // --- 各遷移でupdateFieldState呼出 ---

  it("各遷移でupdateFieldStateが呼ばれる", () => {
    fire("channel.attach") // generated→active
    expect(updateFieldStateMock).toHaveBeenCalledWith("active")

    fire("channel.detach") // active→paused
    expect(updateFieldStateMock).toHaveBeenCalledWith("paused")

    fire("channel.attach") // paused→resumed→active
    // resumed→active の自動遷移でactiveが呼ばれる
    expect(updateFieldStateMock).toHaveBeenCalledWith("active")

    fire("field.terminate") // active→terminated
    expect(updateFieldStateMock).toHaveBeenCalledWith("terminated")
  })

  // --- terminated後の動作 ---

  it("terminated後stream.post拒否: isActive=falseで処理されない", () => {
    fire("channel.attach")
    fire("field.terminate")
    expect(getFieldState()).toBe("terminated")

    fire("stream.post", {
      type: "stream.post",
      actor: "human",
      correlationId: "test-id",
      text: "テスト",
    })

    // 非アクティブなのでsendStreamReplyは呼ばれない
    expect(mockProjection.sendStreamReply).not.toHaveBeenCalled()
  })

  it("terminated後attach→新規場: resetToNewField + generated→active", () => {
    fire("channel.attach") // generated→active
    fire("field.terminate") // active→terminated
    expect(getFieldState()).toBe("terminated")

    // terminated後のattach → resetToNewField() → generated → active
    fire("channel.attach")
    expect(resetToNewFieldMock).toHaveBeenCalledOnce()
    expect(getFieldState()).toBe("active")

    // sendFieldStateが呼ばれる（新規場の状態を投影）
    const lastCall = mockProjection.sendFieldState.mock.calls.at(-1)?.[0]
    expect(lastCall.state).toBe("active")
  })

  // --- 横断: ai起点を含む完走 ---

  it("横断: Pulse isFieldActiveゲートがライフサイクル各段階で正しく動作する", () => {
    const isFieldActive = startPulseMock.mock.calls[0][1] as () => boolean

    // generated → false
    expect(isFieldActive()).toBe(false)

    // active → true
    fire("channel.attach")
    expect(isFieldActive()).toBe(true)

    // paused → false
    fire("channel.detach")
    expect(isFieldActive()).toBe(false)

    // resumed→active → true
    fire("channel.attach")
    expect(isFieldActive()).toBe(true)

    // terminated → false
    fire("field.terminate")
    expect(isFieldActive()).toBe(false)
  })
})
