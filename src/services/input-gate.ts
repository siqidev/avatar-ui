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
  "x_quote_repost",
] as const

// external: 同一媒体の応答ツールのみ許可（ハードコード）
const EXTERNAL_WHITELIST: Readonly<Record<string, readonly ToolName[]>> = {
  roblox: ["roblox_action"],
  x: ["x_reply"],
  // discord: テキスト応答のみ（同一媒体ツールなし）
  // console: externalがconsoleに来ることは通常ない
}

// 入力文脈からの許可ツール一覧を取得する
// buildTools()でツールリストのフィルタリングに使用
export function getAllowedTools(source: Source, channel: ChannelId, role: InputRole = "owner"): readonly ToolName[] {
  // external → 同一媒体の応答ツールのみ（roleが最優先、fail-closed）
  if (role === "external") {
    return EXTERNAL_WHITELIST[channel] ?? []
  }

  // owner / 内部トリガー → 全ツール許可
  if (role === "owner" || source === "pulse") {
    return ALL_TOOLS
  }

  // フォールバック: sourceが不明な場合もexternalとして扱う
  return EXTERNAL_WHITELIST[channel] ?? []
}

// ツール実行時の権限チェック（二重防御の2段目）
// buildToolsで除外されていても、万が一AIが呼んだ場合のガード
export function isToolAllowed(toolName: string, source: Source, channel: ChannelId, role: InputRole = "owner"): boolean {
  const allowed = getAllowedTools(source, channel, role)
  return allowed.includes(toolName as ToolName)
}
