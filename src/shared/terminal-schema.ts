import { z } from "zod/v4"

// --- 共通型 ---

const actorSchema = z.enum(["human", "ai"])

// --- Renderer → Main (invoke) ---

export const terminalExecSchema = z.object({
  actor: actorSchema,
  correlationId: z.string().min(1),
  cmd: z.string().min(1),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
})

export type TerminalExecArgs = z.infer<typeof terminalExecSchema>

export const terminalStdinSchema = z.object({
  actor: actorSchema,
  correlationId: z.string().min(1),
  data: z.string(),
})

export type TerminalStdinArgs = z.infer<typeof terminalStdinSchema>

export const terminalStopSchema = z.object({
  actor: actorSchema,
  correlationId: z.string().min(1),
  signal: z.enum(["SIGTERM", "SIGKILL"]).optional(),
})

export type TerminalStopArgs = z.infer<typeof terminalStopSchema>

export const terminalResizeSchema = z.object({
  cols: z.number().int().min(1),
  rows: z.number().int().min(1),
})

export type TerminalResizeArgs = z.infer<typeof terminalResizeSchema>

// --- Main → Renderer (event) ---

export type TerminalOutputEvent = {
  type: "terminal.output"
  stream: "stdout" | "stderr"
  chunk: string
  at: number
}

export type TerminalLifecycleEvent = {
  type: "terminal.lifecycle"
  phase: "started" | "exited"
  actor: "human" | "ai"
  correlationId: string
  cmd?: string
  exitCode?: number | null
  signal?: string | null
  durationMs?: number
  cwdAfter?: string
}

export type TerminalSnapshotEvent = {
  type: "terminal.snapshot"
  snapshot: TerminalSnapshot
}

export type TerminalToRendererEvent =
  | TerminalOutputEvent
  | TerminalLifecycleEvent
  | TerminalSnapshotEvent

// --- スナップショット ---

export type TerminalSnapshot = {
  cwd: string
  busy: boolean
  scrollback: string[]
  lastCmd?: string
  lastExitCode?: number | null
}

// --- IPCチャンネル名 ---

export const TERMINAL_CHANNELS = {
  exec: "terminal.exec",
  stdin: "terminal.stdin",
  stop: "terminal.stop",
  resize: "terminal.resize",
  snapshot: "terminal.snapshot",
  // Main → Renderer イベント
  output: "terminal.output",
  lifecycle: "terminal.lifecycle",
} as const
