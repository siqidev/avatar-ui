import { z } from "zod/v4"

// --- Renderer → Main (invoke) ---

// PTYへの生データ入力（人間のキー入力）
export const terminalInputSchema = z.object({
  data: z.string(),
})

export type TerminalInputArgs = z.infer<typeof terminalInputSchema>

// PTYリサイズ
export const terminalResizeSchema = z.object({
  cols: z.number().int().min(1),
  rows: z.number().int().min(1),
})

export type TerminalResizeArgs = z.infer<typeof terminalResizeSchema>

// --- Main → Renderer (event) ---

// PTYからの生データ出力
export type TerminalDataEvent = {
  type: "terminal.data"
  data: string
}

// PTY状態変化
export type TerminalStateEvent = {
  type: "terminal.state"
  state: "ready" | "exited"
}

export type TerminalToRendererEvent =
  | TerminalDataEvent
  | TerminalStateEvent

// --- スナップショット ---

export type TerminalSnapshot = {
  alive: boolean
}

// --- IPCチャンネル名 ---

export const TERMINAL_CHANNELS = {
  input: "terminal.input",
  resize: "terminal.resize",
  snapshot: "terminal.snapshot",
  // Main → Renderer イベント
  data: "terminal.data",
  state: "terminal.state",
} as const
