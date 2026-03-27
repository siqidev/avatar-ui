// FieldOrchestrator: 場の起動・FSM遷移・stream処理を統括
// Electron非依存。ipc-handlers.ts（Electron）とheadless/index.ts（Node.js）の両方から利用される

import type { FieldState } from "../shared/ipc-schema.js"
import type { SessionStatePayload, HistoryItem } from "../shared/session-event-schema.js"
import { transition, isActive } from "./field-fsm.js"
import {
  initRuntime,
  processStream,
  startPulse,
  startXpulse,
  startObservation,
  startXWebhook,
  getState,
  updateFieldState,
  resetToNewField,
  emitStreamItem,
  publishXToolResults,
} from "./field-runtime.js"
import { isFrozen, report, warn } from "./integrity-manager.js"
import { getPendingRequests } from "./approval-hub.js"
import { getConfig } from "../config.js"
import * as log from "../logger.js"

// --- 場の状態 ---

let fieldState: FieldState = "generated"

export function getFieldState(): FieldState {
  return fieldState
}

// --- 起動 ---

// FieldRuntime初期化 + 永続化状態の復元 + サービス起動
// 成功時true、失敗時false
export function boot(): boolean {
  try {
    initRuntime()

    // 永続化された場状態を復元
    const restored = getState()
    fieldState = restored.field.state as FieldState
    log.info(`[ORCHESTRATOR] 状態復元: fieldState=${fieldState}, history=${restored.field.messageHistory.length}件`)
  } catch (err) {
    log.error(`[ORCHESTRATOR] 初期化失敗: ${err instanceof Error ? err.message : err}`)
    return false
  }

  // サービス起動
  startPulse()
  startXpulse()
  startObservation()
  startXWebhook()
  return true
}

// --- FSM遷移 ---

// attach: 場をアクティブ化する
export function attach(): void {
  // terminated → 新規場にリセット
  if (fieldState === "terminated") {
    resetToNewField()
    fieldState = "generated"
  }

  try {
    fieldState = transition(fieldState, "attach")
    log.info(`[FSM] ${fieldState} (attach)`)
    // resumed は一時状態: ログ記録後に active へ自動遷移
    if (fieldState === "resumed") {
      fieldState = "active"
      log.info(`[FSM] ${fieldState} (resumed→active)`)
    }
    updateFieldState(fieldState)
  } catch (err) {
    report("FIELD_CONTRACT_VIOLATION",
      `attach失敗: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// safeDetach: 冪等なdetach処理（複数箇所から安全に呼べる）
export function safeDetach(): void {
  if (fieldState !== "active" && fieldState !== "resumed") return

  try {
    fieldState = transition(fieldState, "detach")
    log.info(`[FSM] ${fieldState} (detach)`)
    updateFieldState(fieldState)
  } catch (err) {
    report("FIELD_CONTRACT_VIOLATION",
      `safeDetach失敗: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// terminate: 場を終了する
export function terminate(): void {
  try {
    fieldState = transition(fieldState, "terminate")
    log.info(`[FSM] ${fieldState} (terminate)`)
    updateFieldState(fieldState)
  } catch (err) {
    report("FIELD_CONTRACT_VIOLATION",
      `terminate失敗: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// --- 状態スナップショット ---

// 場の状態スナップショット（SessionStatePayload形式）を返す
// WSサーバーの初回接続時配信に使用
export function getStateSnapshot(): SessionStatePayload {
  const config = getConfig()
  const restored = getState()

  const streamHistory: HistoryItem[] = restored.field.messageHistory.map((m) => ({
    type: "stream" as const,
    actor: m.actor,
    text: m.text,
    ...(m.source ? { source: m.source } : {}),
    ...(m.channel ? { channel: m.channel } : {}),
    ...(m.toolCalls ? { toolCalls: m.toolCalls.map((tc) => ({ name: tc.name, args: tc.args ?? {}, result: tc.result })) } : {}),
  }))

  const robloxHistory: HistoryItem[] = restored.field.observationHistory.map((e) => ({
    type: "monitor" as const,
    channel: "roblox" as const,
    eventType: e.eventType,
    formatted: e.formatted,
    timestamp: e.timestamp,
  }))

  const xHistory: HistoryItem[] = restored.field.xEventHistory.map((e) => ({
    type: "monitor" as const,
    channel: "x" as const,
    eventType: e.eventType,
    formatted: e.formatted,
    timestamp: e.timestamp,
  }))

  const pendingApprovals = getPendingRequests().map((e) => ({
    requestId: e.requestId,
    toolName: e.toolName,
    args: e.args,
    requestedAt: e.requestedAt,
  }))

  return {
    fieldState: fieldState as SessionStatePayload["fieldState"],
    settings: {
      avatarName: config.avatarName,
      userName: config.userName,
    },
    history: [...streamHistory, ...robloxHistory, ...xHistory],
    pendingApprovals,
  }
}

// --- stream処理 ---

// stream.post共通処理（WS経由で呼ばれる）
export async function handleStreamPost(text: string, correlationId: string, actor: "human" | "ai"): Promise<void> {
  if (isFrozen()) {
    log.error("[STREAM] stream.post拒否: 凍結中")
    return
  }

  if (!isActive(fieldState)) {
    log.error(`[STREAM] stream.post拒否: 場が非アクティブ (${fieldState})`)
    return
  }

  emitStreamItem(actor, text, correlationId, "user", "console")
  log.info(`[STREAM] ${actor}: ${text.substring(0, 80)}`)

  try {
    const streamResult = await processStream(text)
    log.info(`[STREAM] ai: ${streamResult.text.substring(0, 80)}`)
    emitStreamItem("ai", streamResult.text, correlationId, "user", "console", streamResult.toolCalls, streamResult.displayText)
    publishXToolResults(streamResult.toolCalls)
  } catch (err) {
    warn("RECIPROCITY_STREAM_ERROR",
      `Stream処理エラー: ${err instanceof Error ? err.message : String(err)}`)
    // エラー時もstream.itemを送信してUIを復帰させる
    emitStreamItem("ai", `エラー: ${err instanceof Error ? err.message : String(err)}`,
      correlationId, "user", "console")
  }
}
