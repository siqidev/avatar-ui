import type { AgentSubscriber } from "@ag-ui/client";
import { TerminalEngine } from "./engine/TerminalEngine";
import { config } from "./config";

interface UiSubscriberOptions {
  outputEl: HTMLElement;
  engine: TerminalEngine;
}

export function createUiSubscriber(options: UiSubscriberOptions): AgentSubscriber {
  const { outputEl, engine } = options;

  let activeToolLine: HTMLElement | null = null;

  const scrollToBottom = () => {
    outputEl.scrollTop = outputEl.scrollHeight;
  };

  const appendLine = (className: string, text: string) => {
    const line = document.createElement("p");
    line.className = `text-line ${className}`;
    line.textContent = text;
    outputEl.appendChild(line);
    scrollToBottom();
    return line;
  };

  return {
    onTextMessageStartEvent() {
      // アシスタントのメッセージ開始：新しい行を作成してエンジンにセット
      engine.startNewMessage("text-line text-line--assistant");
      
      // 設定されたアシスタントタグを表示
      const tag = config.ui.nameTags.assistant ? `${config.ui.nameTags.assistant}> ` : "";
      if (tag) {
        engine.pushText(tag);
      }
    },
    onTextMessageContentEvent({ event }) {
      // 文字列をエンジンに渡す（エンジンが少しずつ表示する）
      engine.pushText(event.delta);
    },
    onTextMessageEndEvent() {
      // 今のところ特になし (エンジンのキューが空になれば止まる)
    },
    
    // ツール実行イベント (これは即時表示したいので直接DOM操作)
    onToolCallStartEvent({ event }) {
      activeToolLine = appendLine("text-line--tool", `🔧 Tool call: ${event.toolCallName}`);
    },
    onToolCallArgsEvent({ event }) {
      if (event.delta && activeToolLine) {
        activeToolLine.textContent += event.delta;
        scrollToBottom();
      }
    },
    onToolCallResultEvent({ event }) {
      appendLine("text-line--tool", `🔍 Result: ${event.content ?? ""}`);
    },
    onToolCallEndEvent() {
      activeToolLine = null;
    },
    
    onRunFailedEvent({ error }) {
      engine.reset(); // 喋ってる途中なら止める
      appendLine(
        "text-line--error",
        `❌ ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  };
}
