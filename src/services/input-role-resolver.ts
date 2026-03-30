// InputRole: 入力者のロール判定
// 各入口で確定し、後段のInputGateでツール権限制御に使用する

import type { AppConfig } from "../config.js"

// owner: オーナー（全ツール許可）
// external: 外部ユーザー（同一媒体の応答ツールのみ）
export type InputRole = "owner" | "external"

// Console UI: SESSION_WS_TOKEN認証済み → 常にowner
export function resolveConsoleRole(): InputRole {
  return "owner"
}

// Pulse/XPulse: 内部トリガー → 常にowner
export function resolvePulseRole(): InputRole {
  return "owner"
}

// Discord: DISCORD_OWNER_IDとの一致でowner判定
// 未設定時は全てexternal（fail-closed）
export function resolveDiscordRole(authorId: string, config: AppConfig): InputRole {
  if (!config.discordOwnerId) return "external"
  return authorId === config.discordOwnerId ? "owner" : "external"
}

// X: X_OWNER_USER_IDとの一致でowner判定
// 未設定時は全てexternal（fail-closed）
export function resolveXRole(userId: string, config: AppConfig): InputRole {
  if (!config.xOwnerUserId) return "external"
  return userId === config.xOwnerUserId ? "owner" : "external"
}

// Roblox: ROBLOX_OWNER_USER_IDとの一致でowner判定
// payload.isOwnerは信用しない（自己申告）。サーバー側設定値のみで判定
// 未設定時は全てexternal（fail-closed）
export function resolveRobloxRole(userId: string | number | undefined, config: AppConfig): InputRole {
  if (!config.robloxOwnerUserId) return "external"
  if (userId === undefined) return "external"
  return String(userId) === config.robloxOwnerUserId ? "owner" : "external"
}
