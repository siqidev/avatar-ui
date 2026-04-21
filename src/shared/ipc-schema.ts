import { z } from "zod/v4"

// --- 共通 ---

export const actorSchema = z.enum(["human", "ai"])
export type Actor = z.infer<typeof actorSchema>

export const channelIdSchema = z.enum(["console", "roblox", "x", "discord"])

export const sourceSchema = z.enum(["user", "pulse", "observation"])
export type Source = z.infer<typeof sourceSchema>

// --- Renderer → Main ---

export const channelAttachSchema = z.object({
  type: z.literal("channel.attach"),
})

export const channelDetachSchema = z.object({
  type: z.literal("channel.detach"),
})

export const streamPostSchema = z.object({
  type: z.literal("stream.post"),
  actor: actorSchema,
  correlationId: z.string().min(1),
  text: z.string().min(1),
  channel: channelIdSchema.optional(),
  inputRole: z.enum(["owner", "external"]).optional(),
})

export const fieldTerminateSchema = z.object({
  type: z.literal("field.terminate"),
})

// Renderer → Main の全メッセージ
export const toMainSchema = z.discriminatedUnion("type", [
  channelAttachSchema,
  channelDetachSchema,
  streamPostSchema,
  fieldTerminateSchema,
])

export type ToMainMessage = z.infer<typeof toMainSchema>

// --- Main → Renderer ---

export const toolCallIpcSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.string(),
})

export const streamReplySchema = z.object({
  type: z.literal("stream.reply"),
  actor: actorSchema,
  correlationId: z.string().min(1),
  text: z.string(),
  source: sourceSchema,
  channel: channelIdSchema.default("console"),
  toolCalls: z.array(toolCallIpcSchema).default([]),
})

export const monitorEventIpcSchema = z.object({
  eventType: z.string(),
  formatted: z.string(),
  timestamp: z.string(),
})

export const fieldStateSchema = z.object({
  type: z.literal("field.state"),
  state: z.enum(["generated", "active", "paused", "resumed", "terminated"]),
  avatarName: z.string(),
  userName: z.string(),
  lastMessages: z.array(z.object({
    actor: actorSchema,
    text: z.string(),
    source: sourceSchema.optional(),
    channel: channelIdSchema.optional(),
    toolCalls: z.array(toolCallIpcSchema).optional(),
  })).optional(),
  lastObservations: z.array(monitorEventIpcSchema).optional(),
  lastXEvents: z.array(monitorEventIpcSchema).optional(),
})

// 健全性管理: AlertCode（不変条件と対応づけた検知コード）
export const alertCodeSchema = z.enum([
  "FIELD_CONTRACT_VIOLATION",       // 場契約整合性: FSM不正遷移
  "RECIPROCITY_STREAM_ERROR",       // 往復連接性: Stream処理エラー
  "RECIPROCITY_PULSE_ERROR",        // 往復連接性+起点対称性: Pulse失敗
  "RECIPROCITY_OBSERVATION_ERROR",  // 往復連接性: 観測AI応答エラー
  "COEXISTENCE_STATE_LOAD_CORRUPTED", // 共存連続性: state.json破損
  "COEXISTENCE_STATE_SAVE_FAILED",  // 共存連続性: state.json保存失敗
])
export type AlertCode = z.infer<typeof alertCodeSchema>

export const integrityAlertSchema = z.object({
  type: z.literal("integrity.alert"),
  code: alertCodeSchema,
  message: z.string(),
})

export const observationEventIpcSchema = z.object({
  type: z.literal("observation.event"),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  formatted: z.string(),
  timestamp: z.string(),
})

export const xEventIpcSchema = z.object({
  type: z.literal("x.event"),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  formatted: z.string(),
  timestamp: z.string(),
})

// Main → Renderer の全メッセージ
export const toRendererSchema = z.discriminatedUnion("type", [
  streamReplySchema,
  fieldStateSchema,
  integrityAlertSchema,
  observationEventIpcSchema,
  xEventIpcSchema,
])

export type ToRendererMessage = z.infer<typeof toRendererSchema>

// --- 場の状態（FSMで使用） ---

export const fieldStates = [
  "generated",
  "active",
  "paused",
  "resumed",
  "terminated",
] as const

export type FieldState = (typeof fieldStates)[number]

export const fieldEvents = [
  "attach",
  "detach",
  "terminate",
] as const

export type FieldEvent = (typeof fieldEvents)[number]
