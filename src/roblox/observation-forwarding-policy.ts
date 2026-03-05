// 観測イベントのAI転送ポリシー
// AIに転送すべきイベントだけを通す（表示は常にRenderer側で行う）

import type { ObservationEvent } from "./observation-server.js"

// ObservationEventのtype列挙と一致させること
type EventType = ObservationEvent["type"]

/**
 * 観測イベントをAIに転送すべきか判定する
 *
 * ルール:
 * - player_chat / player_proximity: 常にAI送信（本来の観測入力）
 * - command_ack: 失敗のみAI送信（成功はツールループで既知。冗長）
 * - npc_follow_event: lost / path_failed のみAI送信（エラー対応）
 * - projection_ack: 失敗のみAI送信
 * - roblox_log: 呼び出し元で除外済み（ここには到達しない）
 */
export function shouldForwardToAI(event: ObservationEvent): boolean {
  const t: EventType = event.type
  const p = event.payload as Record<string, unknown>

  switch (t) {
    case "player_chat":
    case "player_proximity":
      return true

    case "command_ack":
      return p.success !== true

    case "npc_follow_event": {
      const state = String(p.state ?? "")
      return state === "lost" || state === "path_failed"
    }

    case "projection_ack":
      return p.success !== true

    case "roblox_log":
      // roblox_logはfield-runtime.tsで事前フィルタ済み
      // 万が一到達した場合はAIに送らない
      return false
  }

  // exhaustive check: 新イベント追加時にコンパイルエラー
  const _exhaustive: never = t
  throw new Error(`未知の観測イベントタイプ: ${String(_exhaustive)}`)
}
