// ツール承認サービス: auto-approve判定 + Renderer往復でユーザー承認を取得

import type { BrowserWindow } from "electron"
import { getConfig } from "../config.js"
import type { ToolName, ToolApprovalRequest, ToolApprovalDecision } from "../shared/tool-approval-schema.js"
import * as log from "../logger.js"

type PendingApproval = {
  resolve: (decision: ToolApprovalDecision) => void
}

let getMainWindow: (() => BrowserWindow | null) | null = null
const pending = new Map<string, PendingApproval>()

/** 初期化: BrowserWindow参照を受け取る */
export function initApprovalService(getter: () => BrowserWindow | null): void {
  getMainWindow = getter
}

/** ツール実行前に承認を取得する */
export function requestApproval(
  toolName: ToolName,
  args: Record<string, unknown>,
): Promise<ToolApprovalDecision> {
  const config = getConfig()

  // auto-approveリスト判定
  if (config.toolAutoApprove.includes(toolName)) {
    return Promise.resolve({ approved: true, reason: "AUTO_APPROVED" })
  }

  // Rendererが利用不可
  const win = getMainWindow?.()
  if (!win || win.isDestroyed()) {
    log.info(`[APPROVAL] Renderer利用不可 — 拒否 (${toolName})`)
    return Promise.resolve({ approved: false, reason: "RENDERER_UNAVAILABLE" })
  }

  const requestId = crypto.randomUUID()

  return new Promise<ToolApprovalDecision>((resolve) => {
    pending.set(requestId, { resolve })

    const payload: ToolApprovalRequest = {
      type: "tool.approval.request",
      requestId,
      toolName,
      args,
    }

    win.webContents.send("tool.approval.request", payload)
    log.info(`[APPROVAL] リクエスト送信: ${toolName} (${requestId})`)
  })
}

/** Rendererからの承認応答を処理する */
export function resolveApproval(
  requestId: string,
  decision: "approve" | "deny",
): { ok: boolean } {
  const entry = pending.get(requestId)
  if (!entry) {
    log.info(`[APPROVAL] 不明なrequestId: ${requestId}`)
    return { ok: false }
  }

  pending.delete(requestId)
  const approved = decision === "approve"
  entry.resolve({
    approved,
    reason: approved ? "USER_APPROVED" : "USER_DENIED",
  })

  log.info(`[APPROVAL] ${decision}: ${requestId}`)
  return { ok: true }
}

/** 全pending承認を拒否する（detach/ウィンドウ破棄時） */
export function cancelAllPending(): void {
  if (pending.size === 0) return
  log.info(`[APPROVAL] 全pending取消: ${pending.size}件`)
  for (const [id, entry] of pending) {
    entry.resolve({ approved: false, reason: "RENDERER_UNAVAILABLE" })
    pending.delete(id)
  }
}
