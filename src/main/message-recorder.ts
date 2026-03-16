// MessageRecorder: 履歴記録（appendMessageのラッパー）
// ipc-handlers から直接の appendMessage 呼び出しを除去し、ここに集約する

import type { Source } from "../shared/ipc-schema.js"
import type { ChannelId } from "../shared/channel.js"
import type { ToolCallInfo } from "../services/chat-session-service.js"
import { appendMessage } from "./field-runtime.js"

// メッセージ履歴を記録する（永続化付き）
export function recordMessage(
  actor: "human" | "ai",
  text: string,
  source?: Source,
  channel?: ChannelId,
  toolCalls?: ToolCallInfo[],
): void {
  appendMessage({
    actor,
    text,
    ...(source ? { source } : {}),
    ...(channel ? { channel } : {}),
    ...(toolCalls?.length ? {
      toolCalls: toolCalls.map((tc) => ({
        name: tc.name,
        args: tc.args,
        result: tc.result,
      })),
    } : {}),
  })
}
