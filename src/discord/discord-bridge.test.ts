// Discord Bridge テスト
// discord.js と WS接続を依存注入で切り離し、純粋なロジックをテスト

import { describe, it, expect, vi } from "vitest"
import {
  renderStreamItem,
  renderApprovalRequest,
  renderApprovalResolved,
} from "./discord-message-renderer.js"
import type {
  StreamItemPayload,
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
} from "../shared/session-event-schema.js"

// --- discord-message-renderer テスト ---

describe("discord-message-renderer", () => {
  describe("renderStreamItem", () => {
    it("human/userメッセージ: 絵文字プレフィックスのみ", () => {
      const payload: StreamItemPayload = {
        actor: "human",
        correlationId: "test-1",
        text: "こんにちは",
        source: "user",
        channel: "console",
        toolCalls: [],
      }
      const result = renderStreamItem(payload)
      expect(result).toBe("👤 こんにちは")
    })

    it("ai/userメッセージ: ロボット絵文字", () => {
      const payload: StreamItemPayload = {
        actor: "ai",
        correlationId: "test-2",
        text: "応答テスト",
        source: "user",
        channel: "console",
        toolCalls: [],
      }
      const result = renderStreamItem(payload)
      expect(result).toBe("🤖 応答テスト")
    })

    it("pulse sourceタグ付き", () => {
      const payload: StreamItemPayload = {
        actor: "ai",
        correlationId: "test-3",
        text: "Pulse応答",
        source: "pulse",
        channel: "console",
        toolCalls: [],
      }
      const result = renderStreamItem(payload)
      expect(result).toBe("🤖 [pulse] Pulse応答")
    })

    it("displayTextが優先される", () => {
      const payload: StreamItemPayload = {
        actor: "ai",
        correlationId: "test-4",
        text: "内部テキスト",
        displayText: "表示テキスト",
        source: "user",
        channel: "console",
        toolCalls: [],
      }
      const result = renderStreamItem(payload)
      expect(result).toBe("🤖 表示テキスト")
    })

    it("toolCallsがある場合ツール名を表示", () => {
      const payload: StreamItemPayload = {
        actor: "ai",
        correlationId: "test-5",
        text: "ファイル操作完了",
        source: "user",
        channel: "console",
        toolCalls: [
          { name: "fs_write", args: { path: "test.txt" }, result: '{"status":"ok"}' },
          { name: "fs_read", args: { path: "test.txt" }, result: '{"content":"hi"}' },
        ],
      }
      const result = renderStreamItem(payload)
      expect(result).toContain("🔧 `fs_write`, `fs_read`")
    })

    it("2000文字超は切り詰め", () => {
      const payload: StreamItemPayload = {
        actor: "ai",
        correlationId: "test-6",
        text: "a".repeat(2100),
        source: "user",
        channel: "console",
        toolCalls: [],
      }
      const result = renderStreamItem(payload)
      expect(result.length).toBeLessThanOrEqual(2000)
      expect(result).toMatch(/\.\.\.$/u)
    })
  })

  describe("renderApprovalRequest", () => {
    it("承認リクエストメッセージとボタンを生成", () => {
      const payload: ApprovalRequestedPayload = {
        requestId: "req-123",
        toolName: "fs_write",
        args: { path: "/test.txt", content: "hello" },
        requestedAt: new Date().toISOString(),
      }
      const result = renderApprovalRequest(payload)
      expect(result.content).toContain("承認リクエスト")
      expect(result.content).toContain("`fs_write`")
      expect(result.content).toContain("path: /test.txt")
      expect(result.components).toHaveLength(1)
    })

    it("機密キーはマスクされる", () => {
      const payload: ApprovalRequestedPayload = {
        requestId: "req-456",
        toolName: "terminal",
        args: { token: "secret-value", apiKey: "my-key", cmd: "echo hi" },
        requestedAt: new Date().toISOString(),
      }
      const result = renderApprovalRequest(payload)
      expect(result.content).not.toContain("secret-value")
      expect(result.content).not.toContain("my-key")
      expect(result.content).toContain("***")
      expect(result.content).toContain("echo hi")
    })
  })

  describe("renderApprovalResolved", () => {
    it("承認済み表示", () => {
      const payload: ApprovalResolvedPayload = {
        requestId: "req-789",
        toolName: "fs_write",
        args: {},
        approved: true,
        reason: "USER_APPROVED",
      }
      const result = renderApprovalResolved(payload)
      expect(result).toContain("✅ 承認済み")
      expect(result).toContain("`fs_write`")
    })

    it("拒否済み表示", () => {
      const payload: ApprovalResolvedPayload = {
        requestId: "req-000",
        toolName: "roblox_action",
        args: {},
        approved: false,
        reason: "USER_DENIED",
      }
      const result = renderApprovalResolved(payload)
      expect(result).toContain("❌ 拒否済み")
    })
  })
})
