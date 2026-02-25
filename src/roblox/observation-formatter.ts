// 観測イベントをSpectraへの入力テキストに変換する
// cli.tsから抽出した共通モジュール（CLI/Electron両方で使用）

import type { ObservationEvent } from "./observation-server.js"

// プレイヤー名の解決（isOwner=trueなら表示名に変換）
export function resolvePlayerName(
  payload: Record<string, unknown>,
  ownerDisplayName?: string,
): string {
  if (payload.isOwner === true && ownerDisplayName) return ownerDisplayName
  return String(payload.player)
}

// 観測イベントをSpectraに渡すプロンプトテキストに変換
export function formatObservation(
  event: ObservationEvent,
  ownerDisplayName?: string,
): string {
  const p = event.payload as Record<string, unknown>
  const name = resolvePlayerName(p, ownerDisplayName)

  switch (event.type) {
    case "player_chat":
      return `[Roblox観測] ${name}がRoblox内チャットで話しかけた: 「${p.message}」\nRoblox内で応答するにはroblox_actionのnpc sayを使うこと。`
    case "player_proximity":
      return p.action === "enter"
        ? `[Roblox観測] ${name}が近づいてきた（距離: ${p.distance}スタッド）`
        : `[Roblox観測] ${name}が離れた`
    case "projection_ack":
      return `[Roblox観測] 投影結果: ${JSON.stringify(p)}`
    default:
      return `[Roblox観測] ${event.type}: ${JSON.stringify(p)}`
  }
}
