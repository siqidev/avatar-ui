import type { AgentSubscriber } from "@ag-ui/client";
import { logError, logInfo } from "./logger";
import { config } from "../renderer/config";

export const loggerSubscriber: AgentSubscriber = {
  onTextMessageStartEvent({ event }) {
    logInfo(`assistant response started${event.messageId ? ` id=${event.messageId}` : ""}`);
  },
  onTextMessageEndEvent({ event, textMessageBuffer }) {
    const suffix = event.messageId ? ` id=${event.messageId}` : "";
    logInfo(`assistant response completed${suffix} length=${textMessageBuffer.length}`);
  },
  onToolCallStartEvent({ event }) {
    logInfo(`tool call started name=${event.toolCallName}`);
  },
  onToolCallResultEvent({ event }) {
    if (config.clientLogVerbose && event.content) {
      logInfo(`tool call result name=${event.toolCallName ?? "unknown"} content=${event.content}`);
    } else {
      logInfo(`tool call result name=${event.toolCallName ?? "unknown"}`);
    }
  },
  onRunFailedEvent({ error }) {
    logError(`agent run failed: ${error instanceof Error ? error.message : String(error)}`);
  },
};
