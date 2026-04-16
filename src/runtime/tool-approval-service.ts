// ツール承認サービス: auto-approve判定 + approval-hubへの委譲
// auto-approve対象ならhubを経由せず即承認。それ以外はhubに委譲する

import { getConfig } from "../config.js"
import type { ToolName, ToolApprovalDecision } from "../shared/tool-approval-schema.js"
import { request as hubRequest } from "../runtime/approval-hub.js"

/** ツール実行前に承認を取得する */
export function requestApproval(
  toolName: ToolName,
  args: Record<string, unknown>,
): Promise<ToolApprovalDecision> {
  const config = getConfig()

  // auto-approveリスト判定（hubを経由しない）
  if (config.toolAutoApprove.includes(toolName)) {
    return Promise.resolve({ approved: true, reason: "AUTO_APPROVED" })
  }

  // hubに委譲（登録済み承認者に配送、first-response-wins）
  return hubRequest(toolName, args, config.approvalTimeoutMs)
}
