import { z } from "zod/v4"

// --- fs.list ---

export const fsListArgsSchema = z.object({
  path: z.string().min(1),
  depth: z.number().int().min(1).max(10).optional(),
})

export type FsListArgs = z.infer<typeof fsListArgsSchema>

export const fsEntrySchema = z.object({
  name: z.string(),
  type: z.enum(["file", "directory"]),
  size: z.number(),
  mtimeMs: z.number(),
})

export type FsEntry = z.infer<typeof fsEntrySchema>

export const fsListResultSchema = z.object({
  path: z.string(),
  entries: z.array(fsEntrySchema),
})

export type FsListResult = z.infer<typeof fsListResultSchema>

// --- fs.read ---

export const fsReadArgsSchema = z.object({
  path: z.string().min(1),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).optional(),
})

export type FsReadArgs = z.infer<typeof fsReadArgsSchema>

export const fsReadResultSchema = z.object({
  path: z.string(),
  content: z.string(),
  mtimeMs: z.number(),
})

export type FsReadResult = z.infer<typeof fsReadResultSchema>

// --- fs.write ---

export const fsWriteArgsSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
})

export type FsWriteArgs = z.infer<typeof fsWriteArgsSchema>

export const fsWriteResultSchema = z.object({
  path: z.string(),
  bytes: z.number(),
  mtimeMs: z.number(),
})

export type FsWriteResult = z.infer<typeof fsWriteResultSchema>

// --- fs.mutate ---

export const fsMutateDeleteSchema = z.object({
  op: z.literal("delete"),
  path: z.string().min(1),
})

export const fsMutateRenameSchema = z.object({
  op: z.literal("rename"),
  path: z.string().min(1),
  newPath: z.string().min(1),
})

export const fsMutateMkdirSchema = z.object({
  op: z.literal("mkdir"),
  path: z.string().min(1),
})

export const fsMutateArgsSchema = z.discriminatedUnion("op", [
  fsMutateDeleteSchema,
  fsMutateRenameSchema,
  fsMutateMkdirSchema,
])

export type FsMutateArgs = z.infer<typeof fsMutateArgsSchema>

export const fsMutateResultSchema = z.object({
  message: z.string(),
})

export type FsMutateResult = z.infer<typeof fsMutateResultSchema>

// --- IPCチャンネル名 ---

export const FS_CHANNELS = {
  list: "fs.list",
  read: "fs.read",
  write: "fs.write",
  mutate: "fs.mutate",
} as const
