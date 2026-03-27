import { describe, it, expect } from "vitest"
import {
  sessionEventSchema,
  streamItemEventSchema,
  approvalRequestedEventSchema,
  approvalResolvedEventSchema,
  monitorItemEventSchema,
  sessionStateEventSchema,
  historyItemSchema,
  createSessionEvent,
} from "./session-event-schema.js"

// --- 共通テストデータ ---

const baseEnvelope = {
  eventId: "550e8400-e29b-41d4-a716-446655440000",
  ts: "2026-03-21T12:00:00.000Z",
}

describe("session-event-schema", () => {
  describe("stream.item", () => {
    const valid = {
      ...baseEnvelope,
      kind: "stream.item" as const,
      payload: {
        actor: "ai" as const,
        correlationId: "corr-1",
        text: "こんにちは",
        source: "user" as const,
        channel: "console" as const,
        toolCalls: [],
      },
    }

    it("有効なstream.itemを受理する", () => {
      expect(streamItemEventSchema.safeParse(valid).success).toBe(true)
      expect(sessionEventSchema.safeParse(valid).success).toBe(true)
    })

    it("displayTextは省略可能", () => {
      const withDisplay = {
        ...valid,
        payload: { ...valid.payload, displayText: "表示用テキスト" },
      }
      expect(streamItemEventSchema.safeParse(withDisplay).success).toBe(true)
    })

    it("toolCallsのデフォルトは空配列", () => {
      const { toolCalls: _, ...payloadWithout } = valid.payload
      const withoutToolCalls = { ...valid, payload: payloadWithout }
      const result = streamItemEventSchema.safeParse(withoutToolCalls)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.payload.toolCalls).toEqual([])
      }
    })

    it("discordチャネルを受理する", () => {
      const discord = {
        ...valid,
        payload: { ...valid.payload, channel: "discord" as const },
      }
      expect(streamItemEventSchema.safeParse(discord).success).toBe(true)
    })

    it("xpulse sourceを受理する", () => {
      const xpulse = {
        ...valid,
        payload: { ...valid.payload, source: "xpulse" as const, channel: "x" as const },
      }
      expect(streamItemEventSchema.safeParse(xpulse).success).toBe(true)
    })

    it("不正なactorを拒否する", () => {
      const invalid = {
        ...valid,
        payload: { ...valid.payload, actor: "system" },
      }
      expect(streamItemEventSchema.safeParse(invalid).success).toBe(false)
    })

    it("空のcorrelationIdを拒否する", () => {
      const invalid = {
        ...valid,
        payload: { ...valid.payload, correlationId: "" },
      }
      expect(streamItemEventSchema.safeParse(invalid).success).toBe(false)
    })
  })

  describe("approval.requested", () => {
    const valid = {
      ...baseEnvelope,
      kind: "approval.requested" as const,
      payload: {
        requestId: "req-1",
        toolName: "x_post" as const,
        args: { text: "テスト投稿" },
        requestedAt: "2026-03-21T12:00:00.000Z",
      },
    }

    it("有効なapproval.requestedを受理する", () => {
      expect(approvalRequestedEventSchema.safeParse(valid).success).toBe(true)
      expect(sessionEventSchema.safeParse(valid).success).toBe(true)
    })

    it("不正なtoolNameを拒否する", () => {
      const invalid = {
        ...valid,
        payload: { ...valid.payload, toolName: "unknown_tool" },
      }
      expect(approvalRequestedEventSchema.safeParse(invalid).success).toBe(false)
    })
  })

  describe("approval.resolved", () => {
    const valid = {
      ...baseEnvelope,
      kind: "approval.resolved" as const,
      payload: {
        requestId: "req-1",
        toolName: "x_post" as const,
        args: { text: "テスト投稿" },
        approved: true,
        reason: "USER_APPROVED" as const,
      },
    }

    it("有効なapproval.resolvedを受理する", () => {
      expect(approvalResolvedEventSchema.safeParse(valid).success).toBe(true)
      expect(sessionEventSchema.safeParse(valid).success).toBe(true)
    })

    it("deny結果を受理する", () => {
      const denied = {
        ...valid,
        payload: { ...valid.payload, approved: false, reason: "USER_DENIED" as const },
      }
      expect(approvalResolvedEventSchema.safeParse(denied).success).toBe(true)
    })

    it("AUTO_APPROVEDを受理する", () => {
      const auto = {
        ...valid,
        payload: { ...valid.payload, reason: "AUTO_APPROVED" as const },
      }
      expect(approvalResolvedEventSchema.safeParse(auto).success).toBe(true)
    })

    it("不正なreasonを拒否する", () => {
      const invalid = {
        ...valid,
        payload: { ...valid.payload, reason: "INVALID_REASON" },
      }
      expect(approvalResolvedEventSchema.safeParse(invalid).success).toBe(false)
    })
  })

  describe("monitor.item", () => {
    const valid = {
      ...baseEnvelope,
      kind: "monitor.item" as const,
      payload: {
        channel: "roblox" as const,
        eventType: "npc_speech",
        formatted: "[npc_speech] Raziel: こんにちは",
        timestamp: "2026-03-21T12:00:00.000Z",
      },
    }

    it("有効なmonitor.item (roblox)を受理する", () => {
      expect(monitorItemEventSchema.safeParse(valid).success).toBe(true)
      expect(sessionEventSchema.safeParse(valid).success).toBe(true)
    })

    it("有効なmonitor.item (x)を受理する", () => {
      const xEvent = {
        ...valid,
        payload: {
          channel: "x" as const,
          eventType: "mention",
          formatted: "[mention] @user: テスト",
          timestamp: "2026-03-21T12:00:00.000Z",
        },
      }
      expect(monitorItemEventSchema.safeParse(xEvent).success).toBe(true)
    })

    it("payloadは省略可能", () => {
      // payload（Record）フィールドは省略可能
      const withPayload = {
        ...valid,
        payload: { ...valid.payload, payload: { key: "value" } },
      }
      expect(monitorItemEventSchema.safeParse(withPayload).success).toBe(true)
    })

    it("不正なchannelを拒否する", () => {
      const invalid = {
        ...valid,
        payload: { ...valid.payload, channel: "console" },
      }
      expect(monitorItemEventSchema.safeParse(invalid).success).toBe(false)
    })
  })

  describe("session.state", () => {
    const valid = {
      ...baseEnvelope,
      kind: "session.state" as const,
      payload: {
        fieldState: "active" as const,
        settings: {
          avatarName: "Spectra",
          userName: "Sito",
        },
        history: [],
      },
    }

    it("有効なsession.stateを受理する", () => {
      expect(sessionStateEventSchema.safeParse(valid).success).toBe(true)
      expect(sessionEventSchema.safeParse(valid).success).toBe(true)
    })

    it("全fieldState値を受理する", () => {
      for (const state of ["generated", "active", "paused", "resumed", "terminated"]) {
        const event = {
          ...valid,
          payload: { ...valid.payload, fieldState: state },
        }
        expect(sessionStateEventSchema.safeParse(event).success).toBe(true)
      }
    })

    it("stream履歴アイテムを含むhistoryを受理する", () => {
      const withHistory = {
        ...valid,
        payload: {
          ...valid.payload,
          history: [
            {
              type: "stream" as const,
              actor: "ai" as const,
              text: "テスト",
              source: "user" as const,
              channel: "console" as const,
            },
          ],
        },
      }
      expect(sessionStateEventSchema.safeParse(withHistory).success).toBe(true)
    })

    it("monitor履歴アイテムを含むhistoryを受理する", () => {
      const withMonitor = {
        ...valid,
        payload: {
          ...valid.payload,
          history: [
            {
              type: "monitor" as const,
              channel: "roblox" as const,
              eventType: "npc_action",
              formatted: "[npc_action] テスト",
              timestamp: "2026-03-21T12:00:00.000Z",
            },
          ],
        },
      }
      expect(sessionStateEventSchema.safeParse(withMonitor).success).toBe(true)
    })

    it("混合履歴を受理する", () => {
      const mixed = {
        ...valid,
        payload: {
          ...valid.payload,
          history: [
            { type: "stream" as const, actor: "human" as const, text: "入力" },
            { type: "stream" as const, actor: "ai" as const, text: "応答" },
            {
              type: "monitor" as const,
              channel: "x" as const,
              eventType: "post",
              formatted: "[post] テスト",
              timestamp: "2026-03-21T12:00:00.000Z",
            },
          ],
        },
      }
      expect(sessionStateEventSchema.safeParse(mixed).success).toBe(true)
    })
  })

  describe("historyItem", () => {
    it("stream型を受理する", () => {
      const result = historyItemSchema.safeParse({
        type: "stream",
        actor: "ai",
        text: "テスト",
      })
      expect(result.success).toBe(true)
    })

    it("monitor型を受理する", () => {
      const result = historyItemSchema.safeParse({
        type: "monitor",
        channel: "roblox",
        eventType: "npc_speech",
        formatted: "テスト",
        timestamp: "2026-03-21T12:00:00.000Z",
      })
      expect(result.success).toBe(true)
    })

    it("不正なtypeを拒否する", () => {
      const result = historyItemSchema.safeParse({
        type: "unknown",
        text: "テスト",
      })
      expect(result.success).toBe(false)
    })
  })

  describe("discriminated union", () => {
    it("kindで正しく判別される", () => {
      const events = [
        { ...baseEnvelope, kind: "stream.item", payload: { actor: "ai", correlationId: "c1", text: "t", source: "user", channel: "console" } },
        { ...baseEnvelope, kind: "approval.requested", payload: { requestId: "r1", toolName: "x_post", args: {}, requestedAt: "2026-03-21T12:00:00.000Z" } },
        { ...baseEnvelope, kind: "approval.resolved", payload: { requestId: "r1", toolName: "x_post", args: {}, approved: true, reason: "USER_APPROVED" } },
        { ...baseEnvelope, kind: "monitor.item", payload: { channel: "roblox", eventType: "e", formatted: "f", timestamp: "2026-03-21T12:00:00.000Z" } },
        { ...baseEnvelope, kind: "session.state", payload: { fieldState: "active", settings: { avatarName: "A", userName: "U" }, history: [] } },
      ]
      for (const event of events) {
        const result = sessionEventSchema.safeParse(event)
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.kind).toBe(event.kind)
        }
      }
    })

    it("不正なkindを拒否する", () => {
      const invalid = {
        ...baseEnvelope,
        kind: "unknown.event",
        payload: {},
      }
      expect(sessionEventSchema.safeParse(invalid).success).toBe(false)
    })
  })

  describe("createSessionEvent", () => {
    it("stream.itemイベントを生成する", () => {
      const event = createSessionEvent("stream.item", {
        actor: "ai",
        correlationId: "c1",
        text: "テスト",
        source: "user",
        channel: "console",
        toolCalls: [],
      })
      expect(event.kind).toBe("stream.item")
      expect(event.eventId).toBeTruthy()
      expect(event.ts).toBeTruthy()
      expect(event.payload.text).toBe("テスト")
      // スキーマバリデーション通過
      expect(sessionEventSchema.safeParse(event).success).toBe(true)
    })

    it("approval.requestedイベントを生成する", () => {
      const event = createSessionEvent("approval.requested", {
        requestId: "r1",
        toolName: "terminal",
        args: { command: "ls" },
        requestedAt: new Date().toISOString(),
      })
      expect(event.kind).toBe("approval.requested")
      expect(event.payload.toolName).toBe("terminal")
      expect(sessionEventSchema.safeParse(event).success).toBe(true)
    })

    it("session.stateイベントを生成する", () => {
      const event = createSessionEvent("session.state", {
        fieldState: "active",
        settings: { avatarName: "Spectra", userName: "Sito" },
        history: [
          { type: "stream", actor: "human", text: "入力" },
        ],
        pendingApprovals: [],
      })
      expect(event.kind).toBe("session.state")
      expect(event.payload.history).toHaveLength(1)
      expect(sessionEventSchema.safeParse(event).success).toBe(true)
    })
  })
})
