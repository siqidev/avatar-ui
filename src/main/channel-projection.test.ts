import { describe, it, expect, vi, beforeEach } from "vitest"
import { createConsoleProjection } from "./channel-projection.js"
import type { ChannelProjection } from "./channel-projection.js"
import type { PersistedMessage } from "../state/state-repository.js"

// BrowserWindowモック
function createMockWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
    },
  }
}

describe("channel-projection", () => {
  let mockWin: ReturnType<typeof createMockWindow>
  let projection: ChannelProjection

  beforeEach(() => {
    mockWin = createMockWindow()
    projection = createConsoleProjection(
      () => mockWin as unknown as import("electron").BrowserWindow,
    )
  })

  describe("sendStreamReply", () => {
    it("stream.replyメッセージをRendererに送信する", () => {
      projection.sendStreamReply({
        actor: "ai",
        correlationId: "test-123",
        text: "こんにちは",
        source: "user",
        toolCalls: [],
      })

      expect(mockWin.webContents.send).toHaveBeenCalledOnce()
      expect(mockWin.webContents.send).toHaveBeenCalledWith("stream.reply", {
        type: "stream.reply",
        actor: "ai",
        correlationId: "test-123",
        text: "こんにちは",
        source: "user",
        toolCalls: [],
      })
    })

    it("toolCallsを含むstream.replyを送信する", () => {
      projection.sendStreamReply({
        actor: "ai",
        correlationId: "test-456",
        text: "保存しました",
        source: "pulse",
        toolCalls: [{ name: "save_memory", args: {}, result: "ok" }],
      })

      const sent = mockWin.webContents.send.mock.calls[0][1]
      expect(sent.toolCalls).toEqual([{ name: "save_memory", args: {}, result: "ok" }])
    })
  })

  describe("sendFieldState", () => {
    it("履歴なしでfield.stateを送信する", () => {
      projection.sendFieldState({
        state: "active",
        avatarName: "Spectra",
        userName: "shito",
        history: [],
      })

      const sent = mockWin.webContents.send.mock.calls[0][1]
      expect(sent.type).toBe("field.state")
      expect(sent.state).toBe("active")
      expect(sent.avatarName).toBe("Spectra")
      expect(sent.lastMessages).toBeUndefined()
    })

    it("履歴ありでlastMessagesを整形して送信する", () => {
      const history: PersistedMessage[] = [
        { actor: "human", text: "テスト" },
        { actor: "ai", text: "応答", source: "user", toolCalls: [{ name: "save_memory", result: "ok" }] },
      ]

      projection.sendFieldState({
        state: "active",
        avatarName: "Spectra",
        userName: "shito",
        history,
      })

      const sent = mockWin.webContents.send.mock.calls[0][1]
      expect(sent.lastMessages).toHaveLength(2)
      expect(sent.lastMessages[0]).toEqual({
        actor: "human",
        text: "テスト",
        correlationId: "restored",
        source: undefined,
        toolCalls: undefined,
      })
      expect(sent.lastMessages[1].toolCalls).toEqual([
        { name: "save_memory", args: {}, result: "ok" },
      ])
    })
  })

  describe("sendIntegrityAlert", () => {
    it("integrity.alertを送信する（メッセージに再起動案内を追加）", () => {
      projection.sendIntegrityAlert("FIELD_CONTRACT_VIOLATION", "FSM違反")

      const sent = mockWin.webContents.send.mock.calls[0][1]
      expect(sent.type).toBe("integrity.alert")
      expect(sent.code).toBe("FIELD_CONTRACT_VIOLATION")
      expect(sent.message).toBe("FSM違反。再起動してください")
    })
  })

  describe("sendObservationEvent", () => {
    it("observation.eventを送信する（timestampが自動付与される）", () => {
      projection.sendObservationEvent({
        eventType: "chat",
        payload: { player: "Alice", message: "hello" },
        formatted: "[Chat] Alice: hello",
      })

      const sent = mockWin.webContents.send.mock.calls[0][1]
      expect(sent.type).toBe("observation.event")
      expect(sent.eventType).toBe("chat")
      expect(sent.formatted).toBe("[Chat] Alice: hello")
      expect(sent.timestamp).toBeDefined()
    })
  })

  describe("ウィンドウが無効な場合", () => {
    it("ウィンドウがnullなら送信しない", () => {
      const nullProjection = createConsoleProjection(() => null)
      nullProjection.sendStreamReply({
        actor: "ai",
        correlationId: "x",
        text: "test",
        source: "user",
        toolCalls: [],
      })
      // クラッシュしないことが確認できればOK
    })

    it("ウィンドウが破棄済みなら送信しない", () => {
      mockWin.isDestroyed.mockReturnValue(true)
      projection.sendStreamReply({
        actor: "ai",
        correlationId: "x",
        text: "test",
        source: "user",
        toolCalls: [],
      })
      expect(mockWin.webContents.send).not.toHaveBeenCalled()
    })
  })
})
