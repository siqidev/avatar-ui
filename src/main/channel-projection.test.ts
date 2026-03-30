import { describe, it, expect, vi, beforeEach } from "vitest"
import { createConsoleProjection } from "./channel-projection.js"
import type { ChannelProjection } from "./channel-projection.js"

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

  describe("sendIntegrityAlert", () => {
    it("integrity.alertを送信する（メッセージに再起動案内を追加）", () => {
      projection.sendIntegrityAlert("FIELD_CONTRACT_VIOLATION", "FSM違反")

      const sent = mockWin.webContents.send.mock.calls[0][1]
      expect(sent.type).toBe("integrity.alert")
      expect(sent.code).toBe("FIELD_CONTRACT_VIOLATION")
      expect(sent.message).toBe("FSM違反。再起動してください")
    })
  })

  describe("ウィンドウが無効な場合", () => {
    it("ウィンドウがnullなら送信しない", () => {
      const nullProjection = createConsoleProjection(() => null)
      nullProjection.sendIntegrityAlert("FIELD_CONTRACT_VIOLATION", "test")
      // クラッシュしないことが確認できればOK
    })

    it("ウィンドウが破棄済みなら送信しない", () => {
      mockWin.isDestroyed.mockReturnValue(true)
      projection.sendIntegrityAlert("FIELD_CONTRACT_VIOLATION", "test")
      expect(mockWin.webContents.send).not.toHaveBeenCalled()
    })
  })
})
