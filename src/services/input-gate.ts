// InputGate: source + channel + role に基づくツール権限制御
// 二重防御: buildToolsでリスト除外 + handleToolCallで実行時reject
// ホワイトリストはハードコード（.envで緩和不可 = プロンプトインジェクション耐性）

import type { Source } from "../shared/ipc-schema.js"
import type { ChannelId } from "../shared/channel.js"
import type { ToolName } from "../shared/tool-approval-schema.js"
import type { InputRole } from "./input-role-resolver.js"

// owner（+ 内部トリガー）から許可される全ツール
const ALL_TOOLS: readonly ToolName[] = [
  "save_memory",
  "fs_list",
  "fs_read",
  "fs_write",
  "fs_mutate",
  "terminal",
  "roblox_action",
  "x_post",
  "x_reply",
] as const

// external: 同一媒体の応答ツールのみ許可（ハードコード）
const EXTERNAL_WHITELIST: Readonly<Record<string, readonly ToolName[]>> = {
  roblox: ["roblox_action"],
  x: ["x_reply"],
  // discord: なし（テキスト応答のみ）
  // console: なし（externalがconsoleに来ることは通常ない）
}

// 入力文脈からの許可ツール一覧を取得する
// buildTools()でツールリストのフィルタリングに使用
export function getAllowedTools(source: Source, channel: ChannelId, role: InputRole = "owner"): readonly ToolName[] {
  // owner / 内部トリガー（user/pulse/xpulse）→ 全ツール許可
  if (role === "owner" || source === "user" || source === "pulse" || source === "xpulse") {
    return ALL_TOOLS
  }

  // external → 同一媒体の応答ツールのみ
  return EXTERNAL_WHITELIST[channel] ?? []
}

// ツール実行時の権限チェック（二重防御の2段目）
// buildToolsで除外されていても、万が一AIが呼んだ場合のガード
export function isToolAllowed(toolName: string, source: Source, channel: ChannelId, role: InputRole = "owner"): boolean {
  const allowed = getAllowedTools(source, channel, role)
  return allowed.includes(toolName as ToolName)
}
