// Discord表示整形: SessionEventペイロードをDiscordメッセージに変換
// 純粋関数のみ。Discord APIの呼び出しは行わない

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js"
import type { StreamItemPayload, ApprovalRequestedPayload, ApprovalResolvedPayload } from "../shared/session-event-schema.js"

// --- 定数 ---

const DISCORD_MAX_LENGTH = 2000
const SENSITIVE_KEYS = ["token", "secret", "apikey", "api_key", "authorization", "cookie", "password", "key"]

// --- human発話 → Discord表示 ---

export function renderHumanMessage(payload: StreamItemPayload): string {
  const text = payload.displayText ?? payload.text
  return truncate(`💬 **console** > ${text}`)
}

// --- stream.item → Discord本文 ---

export function renderStreamItem(payload: StreamItemPayload): string {
  const text = payload.displayText ?? payload.text

  let body = text

  // ツール呼び出し（名前のみ）
  if (payload.toolCalls.length > 0) {
    const tools = payload.toolCalls.map((tc) => `\`${tc.name}\``).join(", ")
    body += `\n🔧 ${tools}`
  }

  return truncate(body)
}

// --- approval.requested → Discordメッセージ + ボタン ---

export type ApprovalMessage = {
  content: string
  components: ActionRowBuilder<ButtonBuilder>[]
}

export function renderApprovalRequest(payload: ApprovalRequestedPayload): ApprovalMessage {
  const argsStr = renderArgs(payload.args)
  const content = truncate(`⚠️ **承認リクエスト**: \`${payload.toolName}\`\n${argsStr}`)

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve:${payload.requestId}`)
      .setLabel("承認")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`deny:${payload.requestId}`)
      .setLabel("拒否")
      .setStyle(ButtonStyle.Danger),
  )

  return { content, components: [row] }
}

// --- approval.resolved → 解決済みテキスト ---

export function renderApprovalResolved(payload: ApprovalResolvedPayload): string {
  const status = payload.approved ? "✅ 承認済み" : "❌ 拒否済み"
  return `${status}: \`${payload.toolName}\` (${payload.reason})`
}

// --- ヘルパー ---

function truncate(text: string): string {
  if (text.length <= DISCORD_MAX_LENGTH) return text
  return text.substring(0, DISCORD_MAX_LENGTH - 3) + "..."
}

function renderArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return "(引数なし)"

  const parts = entries.map(([k, v]) => {
    const value = isSensitiveKey(k) ? "***" : formatValue(v)
    return `  ${k}: ${value}`
  })
  return parts.join("\n")
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SENSITIVE_KEYS.some((s) => lower.includes(s))
}

function formatValue(v: unknown): string {
  if (typeof v === "string") {
    return v.length > 100 ? v.substring(0, 100) + "…" : v
  }
  const json = JSON.stringify(v)
  return json.length > 100 ? json.substring(0, 100) + "…" : json
}
