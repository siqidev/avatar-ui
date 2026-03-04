// 健全性管理（IntegrityManager）
//
// ⑥の責務: 場の連続運転の保全
// v0.3: 検知+通知+凍結+修復ポリシー宣言
// 修復フロー: 各AlertCodeに対してcontinue（続行）/ freeze（凍結→再起動）を定義
// RuntimeCoordinator（復旧操作の自動発行）はv0.4以降
//
// 他要素を直接操作しない（docs/PLAN.md制約: ⑥→各要素 直接ミューテーション禁止）

import type { AlertCode } from "../shared/ipc-schema.js"
import { t } from "../shared/i18n.js"
import * as log from "../logger.js"

type AlertSink = (code: AlertCode, message: string) => void

let sink: AlertSink | null = null
let frozen = false

// AlertSinkを設定する（DI: ipc-handlersからsendToRenderer経由で注入）
export function setAlertSink(s: AlertSink): void {
  sink = s
}

// 検知イベントを報告する（凍結あり: 場の整合性破壊）
// 用途: FSM不正遷移、state.json保存失敗
// 1. ログ出力（常に）
// 2. sink経由でRenderer通知（ポリシーのuserMessageを使用）
// 3. 凍結ラッチをON（以降の操作を拒否）
export function report(code: AlertCode, message: string): void {
  log.error(`[INTEGRITY] ${code}: ${message}`)
  frozen = true
  sink?.(code, t(`alert.${code}`))
}

// 警告を通知する（凍結なし: 外部障害等の一時的な問題）
// 用途: APIタイムアウト、通信エラー、state.json破損復帰等。次の入力は受け付ける
// 1. ログ出力（常に）
// 2. sink経由でRenderer通知（t()で翻訳済みメッセージを送信）
export function warn(code: AlertCode, message: string): void {
  log.error(`[INTEGRITY:WARN] ${code}: ${message}`)
  sink?.(code, t(`alert.${code}`))
}

// 凍結状態を返す
export function isFrozen(): boolean {
  return frozen
}

// --- 修復ポリシー宣言 ---
// AlertCode → 修復方針のマッピング
// action: "continue" = 次の入力で自然回復, "freeze" = 再起動が必要
// ユーザー向けメッセージはi18n辞書（alert.${code}）から取得

export type RecoveryAction = "continue" | "freeze"

export const RECOVERY_POLICY: Record<AlertCode, { action: RecoveryAction }> = {
  FIELD_CONTRACT_VIOLATION: { action: "freeze" },
  RECIPROCITY_STREAM_ERROR: { action: "continue" },
  RECIPROCITY_PULSE_ERROR: { action: "continue" },
  RECIPROCITY_OBSERVATION_ERROR: { action: "continue" },
  COEXISTENCE_STATE_LOAD_CORRUPTED: { action: "continue" },
  COEXISTENCE_STATE_SAVE_FAILED: { action: "freeze" },
}

// テスト用: 状態リセット
export function _resetForTest(): void {
  sink = null
  frozen = false
}
