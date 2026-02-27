import type { Tool } from "openai/resources/responses/responses"

// exec_commandツール — シェルコマンド実行
export const execCommandToolDef: Tool = {
  type: "function",
  name: "exec_command",
  description:
    "シェルコマンドを実行する。zsh -lc で実行され、stdout/stderrの末尾を返す。" +
    "Avatar SpaceのCRUDにはfs_*ツールを使うこと。" +
    "exec_commandは汎用シェル操作（npm, git, curl, 外部ツール等）に使う。",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["cmd"],
    properties: {
      cmd: {
        type: "string",
        description: "実行するシェルコマンド",
      },
      timeoutMs: {
        type: "number",
        description: "タイムアウト（ms、1000-120000、デフォルト30000）",
      },
    },
  },
  strict: true,
}
