// 観測イベントをAIへの入力テキストに変換する
// cli.tsから抽出した共通モジュール（CLI/Electron両方で使用）
// v3: command_ack, npc_follow_eventを追加

import type { ObservationEvent } from "./observation-server.js"

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
    return `[Roblox ACK] ${String(op)} 成功${intentId}${data}`
  }

  const err = p.error as Record<string, unknown> | undefined
  const code = err?.code ?? "UNKNOWN"
  const msg = err?.message ?? ""
  const retryable = err?.retryable === true ? "（再試行可能）" : ""
  const validation = p.meta
    ? `\n検証結果: ${JSON.stringify((p.meta as Record<string, unknown>).validation)}`
    : ""
  return `[Roblox ACK] ${String(op)} 失敗${intentId}: ${String(code)} - ${String(msg)}${retryable}${validation}`
}

// 追従イベントのテキスト変換
function formatFollowEvent(p: Record<string, unknown>): string {
  const state = String(p.state ?? "unknown")
  const followId = p.follow_id ? ` (${String(p.follow_id)})` : ""

  switch (state) {
    case "started":
      return `[Roblox観測] NPC追従開始${followId}`
    case "stopped":
      return `[Roblox観測] NPC追従停止${followId}`
    case "lost":
      return `[Roblox観測] NPC追従: プレイヤーを見失った${followId}`
    case "path_failed":
      return `[Roblox観測] NPC追従: 経路計算失敗${followId}`
    default:
      return `[Roblox観測] NPC追従: ${state}${followId}`
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
      return `[Roblox観測] ${name}がRoblox内チャットで話しかけた: 「${p.message}」\nRoblox内で応答するにはroblox_actionのnpc sayを使うこと。`
    }
    case "player_proximity": {
      const name = resolvePlayerName(p, ownerDisplayName)
      return p.action === "enter"
        ? `[Roblox観測] ${name}が近づいてきた（距離: ${p.distance}スタッド）`
        : `[Roblox観測] ${name}が離れた`
    }
    case "command_ack":
      return formatAckResult(p)
    case "npc_follow_event":
      return formatFollowEvent(p)
    case "projection_ack":
      return `[Roblox観測] 投影結果: ${JSON.stringify(p)}`
    case "roblox_log": {
      const level = p.level === "MessageWarning" ? "WARN" : p.level === "MessageError" ? "ERR" : "LOG"
      return `[Roblox ${level}] ${String(p.message)}`
    }
    default:
      return `[Roblox観測] ${event.type}: ${JSON.stringify(p)}`
  }
}
