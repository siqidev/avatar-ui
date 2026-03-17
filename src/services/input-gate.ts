// InputGate: 入力文脈（source + channel）に基づくツール権限制御
// 二重防御: buildToolsでリスト除外 + handleToolCallで実行時reject

import type { Source } from "../shared/ipc-schema.js"
import type { ChannelId } from "../shared/channel.js"
import type { ToolName } from "../shared/tool-approval-schema.js"

// 読み取り専用ツール（全入力から許可）
const READ_ONLY_TOOLS: readonly ToolName[] = [
  "save_memory",
  "fs_list",
  "fs_read",
] as const

// 内部入力（user/pulse）から許可される全ツール
const INTERNAL_TOOLS: readonly ToolName[] = [
  ...READ_ONLY_TOOLS,
  "fs_write",
  "fs_mutate",
  "terminal",
  "roblox_action",
  "x_post",
  "x_reply",
] as const

// Roblox観測入力から許可されるツール
const ROBLOX_OBSERVATION_TOOLS: readonly ToolName[] = [
  ...READ_ONLY_TOOLS,
  "roblox_action",
  "x_post",
] as const

// X観測入力から許可されるツール（x_replyはisXReplyEnabled時のみ）
const X_OBSERVATION_TOOLS: readonly ToolName[] = [
  ...READ_ONLY_TOOLS,
  "x_reply",
] as const

// 入力文脈からの許可ツール一覧を取得する
// buildTools()でツールリストのフィルタリングに使用
export function getAllowedTools(source: Source, channel: ChannelId): readonly ToolName[] {
  // user/pulse: 内部入力 → 全ツール許可
  if (source === "user" || source === "pulse") {
    return INTERNAL_TOOLS
  }

  // observation: チャネルに応じて制限
  if (channel === "roblox") {
    return ROBLOX_OBSERVATION_TOOLS
  }
  if (channel === "x") {
    return X_OBSERVATION_TOOLS
  }

  // console観測（将来の拡張）: 読み取り専用のみ
  return READ_ONLY_TOOLS
}

// ツール実行時の権限チェック（二重防御の2段目）
// buildToolsで除外されていても、万が一AIが呼んだ場合のガード
export function isToolAllowed(toolName: string, source: Source, channel: ChannelId): boolean {
  const allowed = getAllowedTools(source, channel)
  return allowed.includes(toolName as ToolName)
}
