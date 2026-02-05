import type { AgentSubscriber } from "@ag-ui/client";
import { logError, logInfo } from "./logger";
import { config } from "../renderer/config";

// エージェントイベントを受け取りログに記録するサブスクライバー
export const loggerSubscriber: AgentSubscriber = {
  // アシスタントが返答を生成し始めたときの通知
  onTextMessageStartEvent({ event }) {
    logInfo(`assistant response started${event.messageId ? ` id=${event.messageId}` : ""}`);
  },
  // 返答生成が終わったときの通知
  onTextMessageEndEvent({ event, textMessageBuffer }) {
    const suffix = event.messageId ? ` id=${event.messageId}` : "";
    logInfo(`assistant response completed${suffix} length=${textMessageBuffer.length}`);
  },
  // ツール実行が始まったときの通知
  onToolCallStartEvent({ event }) {
    logInfo(`tool call started name=${event.toolCallName}`);
  },
  // ツール実行結果を受け取ったときの通知（詳細は verbose 設定に応じる）
  onToolCallResultEvent({ event }) {
    if (config.clientLogVerbose && event.content) {
      logInfo(`tool call result id=${event.toolCallId} content=${event.content}`);
    } else {
      logInfo(`tool call result id=${event.toolCallId}`);
    }
  },
  // エージェント実行が失敗したときの通知
  onRunFailed({ error }: { error: Error }) {
    logError(`agent run failed: ${error.message}`);
  },
};
