// FS RPC（WS経路）契約: ブラウザ版Console UIからWS経由でFS操作を行うための転送エンベロープ
// 注: fs.importFile はブラウザWSから公開しない（任意絶対パスをサーバーに受け取らせる入口を作らないため）

import { z } from "zod/v4"

// --- WS公開subset ---

export const fsRpcMethodSchema = z.enum([
  "fs.rootName",
  "fs.list",
  "fs.read",
  "fs.write",
  "fs.mutate",
])

export type FsRpcMethod = z.infer<typeof fsRpcMethodSchema>

// --- request ---

export const fsRequestSchema = z.object({
  type: z.literal("fs.request"),
  reqId: z.string().min(1),
  method: fsRpcMethodSchema,
  args: z.unknown().optional(),
})

export type FsRequest = z.infer<typeof fsRequestSchema>

// --- response ---

export const fsResponseErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
})

export type FsResponseError = z.infer<typeof fsResponseErrorSchema>

export const fsResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    type: z.literal("fs.response"),
    reqId: z.string(),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    type: z.literal("fs.response"),
    reqId: z.string(),
    ok: z.literal(false),
    error: fsResponseErrorSchema,
  }),
])

export type FsResponse = z.infer<typeof fsResponseSchema>
