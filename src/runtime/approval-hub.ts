// 承認ハブ: 複数の承認者（Console, Discord等）を管理し、first-response-winsで承認を解決する
// Electron非依存 — src/runtime/ はElectronを参照しない

import type { ToolName, ToolApprovalRequest, ToolApprovalDecision } from "../shared/tool-approval-schema.js"
import * as log from "../logger.js"

// --- 型定義 ---

export type ApprovalVote = "approve" | "deny"

export type ApprovalEnvelope = ToolApprovalRequest & {
  requestedAt: string
}

export type Approver = {
  approverId: string
  label: string
  sendRequest: (request: ApprovalEnvelope) => void | Promise<void>
}

export type RespondResult =
  | { ok: true }
  | { ok: false; reason: "REQUEST_NOT_FOUND" | "ALREADY_RESOLVED" }

// --- 内部状態 ---

type PendingEntry = {
  envelope: ApprovalEnvelope
  resolve: (decision: ToolApprovalDecision) => void
  /** このリクエストに配送された承認者IDセット */
  deliveredTo: Set<string>
}

const approvers = new Map<string, Approver>()
const pending = new Map<string, PendingEntry>()

// --- 公開API ---

/** 承認者を登録する。戻り値は登録解除関数 */
export function registerApprover(approver: Approver): () => void {
  approvers.set(approver.approverId, approver)
  log.info(`[APPROVAL_HUB] 承認者登録: ${approver.approverId} (${approver.label})`)

  return () => unregisterApprover(approver.approverId)
}

/** 承認者を登録解除する */
export function unregisterApprover(approverId: string): void {
  if (!approvers.delete(approverId)) return
  log.info(`[APPROVAL_HUB] 承認者解除: ${approverId}`)

  // この承認者が唯一の配送先だったpendingを即deny
  for (const [requestId, entry] of pending) {
    entry.deliveredTo.delete(approverId)
    if (entry.deliveredTo.size === 0) {
      pending.delete(requestId)
      entry.resolve({ approved: false, reason: "NO_APPROVER" })
      log.info(`[APPROVAL_HUB] 全承認者離脱 — 拒否: ${requestId}`)
    }
  }
}

/** 承認をリクエストする（auto-approve判定は呼び出し側で行う） */
export function request(
  toolName: ToolName,
  args: Record<string, unknown>,
): Promise<ToolApprovalDecision> {
  const currentApprovers = [...approvers.values()]

  // 承認者がいない → 即deny
  if (currentApprovers.length === 0) {
    log.info(`[APPROVAL_HUB] 承認者なし — 拒否 (${toolName})`)
    return Promise.resolve({ approved: false, reason: "NO_APPROVER" })
  }

  const requestId = crypto.randomUUID()
  const envelope: ApprovalEnvelope = {
    type: "tool.approval.request",
    requestId,
    toolName,
    args,
    requestedAt: new Date().toISOString(),
  }

  return new Promise<ToolApprovalDecision>((resolve) => {
    const deliveredTo = new Set<string>()

    // 各承認者に配送
    for (const approver of currentApprovers) {
      try {
        const result = approver.sendRequest(envelope)
        // 同期・非同期両対応: throwしなければ配送成功
        if (result instanceof Promise) {
          result.catch((err) => {
            log.error(`[APPROVAL_HUB] 配送失敗(async): ${approver.approverId} — ${err}`)
            deliveredTo.delete(approver.approverId)
            // 配送成功先が0になったら即deny
            const entry = pending.get(requestId)
            if (entry && entry.deliveredTo.size === 0) {
              pending.delete(requestId)
              resolve({ approved: false, reason: "NO_APPROVER" })
            }
          })
        }
        deliveredTo.add(approver.approverId)
      } catch (err) {
        log.error(`[APPROVAL_HUB] 配送失敗(sync): ${approver.approverId} — ${err}`)
      }
    }

    // 配送成功先が0 → 即deny
    if (deliveredTo.size === 0) {
      resolve({ approved: false, reason: "NO_APPROVER" })
      return
    }

    pending.set(requestId, { envelope, resolve, deliveredTo })
    log.info(`[APPROVAL_HUB] リクエスト送信: ${toolName} (${requestId}) → ${deliveredTo.size}件`)
  })
}

/** 承認応答を処理する（first-response-wins） */
export function respond(
  requestId: string,
  decision: ApprovalVote,
): RespondResult {
  const entry = pending.get(requestId)
  if (!entry) {
    return { ok: false, reason: "REQUEST_NOT_FOUND" }
  }

  pending.delete(requestId)
  const approved = decision === "approve"
  entry.resolve({
    approved,
    reason: approved ? "USER_APPROVED" : "USER_DENIED",
  })

  log.info(`[APPROVAL_HUB] ${decision}: ${requestId}`)
  return { ok: true }
}

/** 現在の承認者数を取得する */
export function getApproverCount(): number {
  return approvers.size
}

/** 全pendingリクエストを取消す（シャットダウン時） */
export function cancelAll(): void {
  if (pending.size === 0) return
  log.info(`[APPROVAL_HUB] 全pending取消: ${pending.size}件`)
  for (const [id, entry] of pending) {
    entry.resolve({ approved: false, reason: "NO_APPROVER" })
    pending.delete(id)
  }
}

// テスト用: 状態リセット
export function _resetForTest(): void {
  approvers.clear()
  pending.clear()
}
