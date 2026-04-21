// セッションイベントスキーマ: サーバー→クライアント共通イベント定義
// トランスポート非依存（IPC/WebSocket両方で使用）
// Console固有のIPC型（ipc-schema.ts）とは独立

import { z } from "zod/v4"

// --- 共通エンベロープ ---

export const sessionEventKindSchema = z.enum([
  "stream.item",
  "approval.requested",
  "approval.resolved",
  "monitor.item",
  "session.state",
])
export type SessionEventKind = z.infer<typeof sessionEventKindSchema>

// --- stream.item ---

export const streamActorSchema = z.enum(["human", "ai"])
export type StreamActor = z.infer<typeof streamActorSchema>

export const streamSourceSchema = z.enum(["user", "pulse", "observation"])
export type StreamSource = z.infer<typeof streamSourceSchema>

export const streamChannelSchema = z.enum(["console", "roblox", "x", "discord"])
export type StreamChannel = z.infer<typeof streamChannelSchema>

export const toolCallSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.string(),
})
export type ToolCall = z.infer<typeof toolCallSchema>

export const streamItemPayloadSchema = z.object({
  actor: streamActorSchema,
  correlationId: z.string().min(1),
  text: z.string(),
  displayText: z.string().optional(), // 省略時 = text と同一
  source: streamSourceSchema,
  channel: streamChannelSchema,
  toolCalls: z.array(toolCallSchema).default([]),
})
export type StreamItemPayload = z.infer<typeof streamItemPayloadSchema>

// --- approval.requested ---

export const toolNameSchema = z.enum([
  "save_memory",
  "fs_list",
  "fs_read",
  "fs_write",
  "fs_mutate",
  "terminal",
  "roblox_action",
  "x_post",
  "x_reply",
  "x_quote_repost",
])
export type ToolName = z.infer<typeof toolNameSchema>

export const approvalRequestedPayloadSchema = z.object({
  requestId: z.string().min(1),
  toolName: toolNameSchema,
  args: z.record(z.string(), z.unknown()),
  requestedAt: z.string(), // ISO 8601
})
export type ApprovalRequestedPayload = z.infer<typeof approvalRequestedPayloadSchema>

// --- approval.resolved ---

export const approvalReasonSchema = z.enum([
  "AUTO_APPROVED",
  "USER_APPROVED",
  "USER_DENIED",
  "NO_APPROVER",
  "TIMEOUT",
])
export type ApprovalReason = z.infer<typeof approvalReasonSchema>

export const approvalResolvedPayloadSchema = z.object({
  requestId: z.string().min(1),
  toolName: toolNameSchema,
  args: z.record(z.string(), z.unknown()),
  approved: z.boolean(),
  reason: approvalReasonSchema,
})
export type ApprovalResolvedPayload = z.infer<typeof approvalResolvedPayloadSchema>

// --- monitor.item ---

export const monitorChannelSchema = z.enum(["roblox", "x"])
export type MonitorChannel = z.infer<typeof monitorChannelSchema>

export const monitorItemPayloadSchema = z.object({
  channel: monitorChannelSchema,
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  formatted: z.string(),
  timestamp: z.string(), // ISO 8601
})
export type MonitorItemPayload = z.infer<typeof monitorItemPayloadSchema>

// --- session.state ---

export const fieldStateValueSchema = z.enum([
  "generated",
  "active",
  "paused",
  "resumed",
  "terminated",
])
export type FieldStateValue = z.infer<typeof fieldStateValueSchema>

// 統合履歴アイテム: stream.itemとmonitor.itemの共通表現
export const historyItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stream"),
    actor: streamActorSchema,
    text: z.string(),
    source: streamSourceSchema.optional(),
    channel: streamChannelSchema.optional(),
    toolCalls: z.array(toolCallSchema).optional(),
  }),
  z.object({
    type: z.literal("monitor"),
    channel: monitorChannelSchema,
    eventType: z.string(),
    formatted: z.string(),
    timestamp: z.string(),
  }),
])
export type HistoryItem = z.infer<typeof historyItemSchema>

// サーバー設定（クライアントに公開する部分のみ）
export const serverSettingsSchema = z.object({
  avatarName: z.string(),
  userName: z.string(),
})
export type ServerSettings = z.infer<typeof serverSettingsSchema>

export const pendingApprovalSchema = z.object({
  requestId: z.string().min(1),
  toolName: toolNameSchema,
  args: z.record(z.string(), z.unknown()),
  requestedAt: z.string(),
})
export type PendingApproval = z.infer<typeof pendingApprovalSchema>

export const sessionStatePayloadSchema = z.object({
  fieldState: fieldStateValueSchema,
  settings: serverSettingsSchema,
  history: z.array(historyItemSchema),
  pendingApprovals: z.array(pendingApprovalSchema).default([]),
})
export type SessionStatePayload = z.infer<typeof sessionStatePayloadSchema>

// --- セッションイベント（discriminated union） ---

export const streamItemEventSchema = z.object({
  eventId: z.string().min(1),
  ts: z.string(), // ISO 8601
  kind: z.literal("stream.item"),
  payload: streamItemPayloadSchema,
})

export const approvalRequestedEventSchema = z.object({
  eventId: z.string().min(1),
  ts: z.string(),
  kind: z.literal("approval.requested"),
  payload: approvalRequestedPayloadSchema,
})

export const approvalResolvedEventSchema = z.object({
  eventId: z.string().min(1),
  ts: z.string(),
  kind: z.literal("approval.resolved"),
  payload: approvalResolvedPayloadSchema,
})

export const monitorItemEventSchema = z.object({
  eventId: z.string().min(1),
  ts: z.string(),
  kind: z.literal("monitor.item"),
  payload: monitorItemPayloadSchema,
})

export const sessionStateEventSchema = z.object({
  eventId: z.string().min(1),
  ts: z.string(),
  kind: z.literal("session.state"),
  payload: sessionStatePayloadSchema,
})

export const sessionEventSchema = z.discriminatedUnion("kind", [
  streamItemEventSchema,
  approvalRequestedEventSchema,
  approvalResolvedEventSchema,
  monitorItemEventSchema,
  sessionStateEventSchema,
])
export type SessionEvent = z.infer<typeof sessionEventSchema>

// --- ファクトリ関数 ---

/** セッションイベントを生成する */
export function createSessionEvent<K extends SessionEventKind>(
  kind: K,
  payload: Extract<SessionEvent, { kind: K }>["payload"],
): Extract<SessionEvent, { kind: K }> {
  return {
    eventId: crypto.randomUUID(),
    ts: new Date().toISOString(),
    kind,
    payload,
  } as Extract<SessionEvent, { kind: K }>
}
