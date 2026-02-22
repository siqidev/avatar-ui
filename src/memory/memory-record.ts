import { z } from "zod/v4"
import * as crypto from "node:crypto"

// メモリレコードのZodスキーマ
export const memoryRecordSchema = z.object({
  id: z.string(),
  at: z.string(), // ISO8601
  text: z.string().min(1).max(2000),
  reason: z.string().min(1).max(240),
  importance: z.number().min(0).max(1),
  tags: z.array(z.string().min(1).max(32)).max(12).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  source: z.object({
    actor: z.enum(["human", "ai", "system"]),
    responseId: z.string().nullable(),
    callId: z.string().nullable(),
  }),
})

export type MemoryRecord = z.infer<typeof memoryRecordSchema>

// save_memoryツールの引数型（Grokが呼ぶ）
export const saveMemoryArgsSchema = z.object({
  text: z.string().min(1).max(2000),
  reason: z.string().min(1).max(240),
  importance: z.number().min(0).max(1),
  tags: z.array(z.string().min(1).max(32)).max(12).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
})

export type SaveMemoryArgs = z.infer<typeof saveMemoryArgsSchema>

// 一意なメモリIDを生成
export function generateMemoryId(): string {
  const ts = Date.now()
  const rand = crypto.randomBytes(4).toString("hex")
  return `mem_${ts}_${rand}`
}

// save_memoryの引数からMemoryRecordを生成
export function createMemoryRecord(
  args: SaveMemoryArgs,
  source: MemoryRecord["source"],
): MemoryRecord {
  return {
    id: generateMemoryId(),
    at: new Date().toISOString(),
    text: args.text,
    reason: args.reason,
    importance: args.importance,
    ...(args.tags ? { tags: args.tags } : {}),
    ...(args.meta ? { meta: args.meta } : {}),
    source,
  }
}
