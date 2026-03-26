// セッションイベントバス: FieldRuntime → 購読者へのイベント配信
// トランスポート非依存（IPC/WebSocket両方の購読者が接続可能）

import type { SessionEvent } from "../shared/session-event-schema.js"

type Listener = (event: SessionEvent) => void

const listeners: Listener[] = []

/** イベントを購読する。戻り値は購読解除関数 */
export function subscribe(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    const idx = listeners.indexOf(listener)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

/** イベントを全購読者に配信する */
export function publish(event: SessionEvent): void {
  for (const listener of listeners) {
    listener(event)
  }
}

/** 購読者数を取得する */
export function getListenerCount(): number {
  return listeners.length
}

// テスト用: 状態リセット
export function _resetForTest(): void {
  listeners.length = 0
}
