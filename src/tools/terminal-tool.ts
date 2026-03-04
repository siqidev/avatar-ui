import type { Tool } from "openai/resources/responses/responses"
import { z } from "zod"

// terminalツール — シェルコマンド実行 + 直近出力取得
export const terminalToolDef: Tool = {
  type: "function",
  name: "terminal",
  description:
    "ターミナル操作ツール。" +
    "cmdを指定するとシェルコマンドを実行し結果を返す。" +
    "cmdを省略すると直近のコマンド出力を取得する。" +
    "humanがターミナルで実行した結果を確認するときは必ずcmd省略で呼ぶこと（会話履歴の出力は古い可能性がある）。" +
    "Avatar SpaceのCRUDにはfs_*ツールを使うこと。",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: [],
    properties: {
      cmd: {
        type: "string",
        description: "実行するシェルコマンド（省略時は直近の出力を取得）",
      },
      timeoutMs: {
        type: "number",
        description: "タイムアウト（ms、1000-120000、デフォルト30000）",
      },
    },
  },
  strict: false,
}

// バリデーションスキーマ
export const terminalArgsSchema = z.object({
  cmd: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
})

export type TerminalArgs = z.infer<typeof terminalArgsSchema>
