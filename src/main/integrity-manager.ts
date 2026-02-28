// 健全性管理（IntegrityManager）
//
// ⑥の責務: 場の連続運転の保全
// v0.3: 検知+通知+凍結（修復委譲の最小実現）
// 統一パターン: 検知 → alertBar表示 → 壊れた操作を凍結 → 復帰は再起動
//
// 他要素を直接操作しない（PLAN.md制約: ⑥→各要素 直接ミューテーション禁止）

import type { AlertCode } from "../shared/ipc-schema.js"
import * as log from "../logger.js"

type AlertSink = (code: AlertCode, message: string) => void

let sink: AlertSink | null = null
let frozen = false

// AlertSinkを設定する（DI: ipc-handlersからsendToRenderer経由で注入）
export function setAlertSink(s: AlertSink): void {
  sink = s
}

// 検知イベントを報告する
// 1. ログ出力（常に）
// 2. sink経由でRenderer通知（設定済みの場合）
// 3. 凍結ラッチをON（以降の操作を拒否）
export function report(code: AlertCode, message: string): void {
  log.error(`[INTEGRITY] ${code}: ${message}`)
  frozen = true
  sink?.(code, message)
}

// 凍結状態を返す
export function isFrozen(): boolean {
  return frozen
}

// テスト用: 状態リセット
export function _resetForTest(): void {
  sink = null
  frozen = false
}
