// ツール承認フロー: スキーマ定義（Main ↔ Renderer間のIPC + config用）

import { z } from "zod/v4"

// AIが呼び出すツール名（file_searchはGrok内部ツールのため対象外）
export const toolNameSchema = z.enum([
  "save_memory",
  "fs_list",
  "fs_read",
  "fs_write",
  "fs_mutate",
  "terminal",
  "roblox_action",
  "x_post",
  "x_reply",
])
export type ToolName = z.infer<typeof toolNameSchema>

export const TOOL_NAMES = toolNameSchema.options

// Main → Renderer: 承認リクエスト
export type ToolApprovalRequest = {
  type: "tool.approval.request"
  requestId: string
  toolName: ToolName
  args: Record<string, unknown>
}

// Renderer → Main: 承認応答
export const toolApprovalRespondSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["approve", "deny"]),
})
export type ToolApprovalRespond = z.infer<typeof toolApprovalRespondSchema>

// 内部判定結果
export type ToolApprovalDecision = {
  approved: boolean
  reason: "AUTO_APPROVED" | "USER_APPROVED" | "USER_DENIED" | "NO_APPROVER"
}
