// 移動状態追跡: npc_motion実行中のplayer_proximity AI転送を抑制する
//
// 設計根拠（議論ログ 2026-03-13）:
// AIがgo_to_player/follow_playerでNPCを移動 → proximity enterが発火 → AIが「プレイヤーが近づいた」と
// 誤認して二重応答する問題を、フィルタ層（forwarding-policy相当）で解決する。
// 観測層（ObservationSender）は世界事実をそのまま送り、編集はElectron側で行う。
//
// フロー:
// 1. npc_motion intent投影成功 → startSuppression()（chat-session-serviceから呼出）
// 2. go_to_player ACK到着 or npc_follow_event stopped/lost → endSuppression()（field-runtimeから呼出）
// 3. 観測ハンドラがplayer_proximityを受信 → isProximitySuppressed()で判定

import * as log from "../logger.js"

let active = false

/** npc_motion投影成功時に呼ぶ。proximity AI転送を抑制開始 */
export function startSuppression(): void {
  active = true
  log.info("[MOTION] proximity抑制開始")
}

/** 移動完了時に呼ぶ（go_to ACK / follow stopped/lost） */
export function endSuppression(): void {
  if (!active) return
  active = false
  log.info("[MOTION] proximity抑制解除")
}

/** player_proximity受信時に呼ぶ。trueなら自己起因としてAI転送をスキップ */
export function isProximitySuppressed(): boolean {
  return active
}

/** テスト用リセット */
export function _resetForTest(): void {
  active = false
}
