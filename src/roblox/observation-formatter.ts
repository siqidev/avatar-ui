// 観測イベントをAIへの入力テキストに変換する
// v3: command_ack, npc_follow_eventを追加

import type { ObservationEvent } from "./observation-server.js"
import { t } from "../shared/i18n.js"

// プレイヤー名の解決（isOwner=trueなら表示名に変換）
export function resolvePlayerName(
  payload: Record<string, unknown>,
  ownerDisplayName?: string,
): string {
  if (payload.isOwner === true && ownerDisplayName) return ownerDisplayName
  return String(payload.player)
}

// ACKの成功/失敗を簡潔なテキストに変換
function formatAckResult(p: Record<string, unknown>): string {
  const op = p.op ?? p.category ?? "unknown"
  const intentId = p.intent_id ? ` (intent: ${String(p.intent_id).slice(0, 8)})` : ""

  if (p.success === true) {
    const data = p.data ? ` ${JSON.stringify(p.data)}` : ""
    return t("obs.ack.success", op, intentId, data)
  }

  const err = p.error as Record<string, unknown> | undefined
  const code = err?.code ?? "UNKNOWN"
  const msg = err?.message ?? ""
  const retryable = err?.retryable === true ? t("obs.ack.retryable") : ""
  const validation = p.meta
    ? t("obs.ack.validation", JSON.stringify((p.meta as Record<string, unknown>).validation))
    : ""
  return t("obs.ack.fail", op, intentId, code, msg, retryable, validation)
}

// 追従イベントのテキスト変換
function formatFollowEvent(p: Record<string, unknown>): string {
  const state = String(p.state ?? "unknown")
  const followId = p.follow_id ? ` (${String(p.follow_id)})` : ""

  switch (state) {
    case "started":
      return t("obs.follow.started", followId)
    case "stopped":
      return t("obs.follow.stopped", followId)
    case "lost":
      return t("obs.follow.lost", followId)
    case "path_failed":
      return t("obs.follow.pathFailed", followId)
    default:
      return t("obs.follow.default", state, followId)
  }
}

// 観測イベントをAIに渡すプロンプトテキストに変換
export function formatObservation(
  event: ObservationEvent,
  ownerDisplayName?: string,
): string {
  const p = event.payload as Record<string, unknown>

  switch (event.type) {
    case "player_chat": {
      const name = resolvePlayerName(p, ownerDisplayName)
      return t("obs.chat", name, p.message)
    }
    case "player_proximity": {
      const name = resolvePlayerName(p, ownerDisplayName)
      return p.action === "enter"
        ? t("obs.proximity.enter", name, p.distance)
        : t("obs.proximity.leave", name)
    }
    case "command_ack":
      return formatAckResult(p)
    case "npc_follow_event":
      return formatFollowEvent(p)
    case "projection_ack":
      return t("obs.projection", JSON.stringify(p))
    case "roblox_log": {
      const level = p.level === "MessageWarning" ? "WARN" : p.level === "MessageError" ? "ERR" : "LOG"
      return `[Roblox ${level}] ${String(p.message)}`
    }
    default:
      return t("obs.default", event.type, JSON.stringify(p))
  }
}
