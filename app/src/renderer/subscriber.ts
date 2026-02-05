// エージェントイベントを受け取り、レンダラーの表示・音・ログを更新する購読処理
import type { AgentSubscriber } from "@ag-ui/client";
import { TerminalEngine } from "./engine/TerminalEngine";
import { config } from "./config";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { AutoScrollController } from "./autoScroll";

/**
 * Markdown → サニタイズ済み HTML へ変換（共通関数）
 */
export function renderMarkdown(md: string): string {
  let html = marked.parse(md) as string;
  // タグ間・末尾の空白を除去（white-space: pre-wrap 対策）
  html = html.replace(/>\s+</g, "><").trimEnd();
  return DOMPurify.sanitize(html);
}

// UI サブスクライバーの初期化オプション
interface UiSubscriberOptions {
  outputEl: HTMLElement;  // テキスト出力先
  engine: TerminalEngine; // タイプライターエンジン
  autoScroll: AutoScrollController; // 下端追従コントロール
}

/**
 * エージェントイベントを購読し、UI を更新するサブスクライバーを生成
 */
export function createUiSubscriber(options: UiSubscriberOptions): AgentSubscriber {
  const { outputEl, engine, autoScroll } = options;

  // ツール呼び出し表示用の状態
  let activeToolDetails: HTMLDetailsElement | null = null;
  let activeToolName = "";
  let argsBuffer = "";

  // テキスト行を追加
  const appendLine = (className: string, text: string) => {
    const line = document.createElement("div");
    line.className = `text-line ${className}`;
    line.textContent = text;
    outputEl.appendChild(line);
    autoScroll.maybeScroll();
    return line;
  };

  // オブジェクトから最初に見つかった文字列値を取り出す（汎用）
  const extractFirstString = (obj: unknown): string => {
    if (typeof obj === "string") return obj;
    if (obj && typeof obj === "object") {
      for (const v of Object.values(obj as Record<string, unknown>)) {
        if (typeof v === "string") return v;
      }
    }
    return JSON.stringify(obj, null, 2);
  };

  return {
    onTextMessageStartEvent() {
      // 設定されたアバタータグを取得
      const tag = config.ui.nameTags.avatar ? `${config.ui.nameTags.avatar}> ` : "";

      // アシスタントのメッセージ開始：新しい行を作成してエンジンにセット（タグは即時表示）
      engine.startNewMessage("text-line text-line--assistant", tag);
    },
    onTextMessageContentEvent({ event }) {
      // 文字列をエンジンに渡す（エンジンが少しずつ表示する）
      // Markdown は現状のエンジンではプレーンテキスト表示。ここは従来どおり。
      engine.pushText(event.delta);
    },
    onTextMessageEndEvent() {
      // 今のところ特になし (エンジンのキューが空になれば止まる)
    },
    
    // ツール実行イベント（折りたたみ表示）
    onToolCallStartEvent({ event }) {
      activeToolName = event.toolCallName;
      argsBuffer = "";

      const details = document.createElement("details");
      details.className = "tool-call text-line--tool";

      const summary = document.createElement("summary");
      summary.textContent = `🔧 ${event.toolCallName}...`;
      details.appendChild(summary);

      outputEl.appendChild(details);
      autoScroll.maybeScroll();

      activeToolDetails = details;
    },
    // ツール引数の断片を受け取る（ストリーミング）
    onToolCallArgsEvent({ event }) {
      if (event.delta) {
        argsBuffer += event.delta;
      }
    },
    // ツール呼び出し完了: サマリーを更新
    onToolCallEndEvent() {
      if (activeToolDetails) {
        let argsText = argsBuffer;
        try {
          const parsed = JSON.parse(argsBuffer);
          argsText = extractFirstString(parsed);
        } catch {
          // 非JSONならそのまま
        }
        const summary = activeToolDetails.querySelector("summary");
        if (summary) {
          summary.textContent = `🔧 ${activeToolName}: ${argsText}`;
        }
      }
      argsBuffer = "";
    },
    // ツール結果を受け取り、折りたたみ内に表示
    onToolCallResultEvent({ event }) {
      if (activeToolDetails) {
        let resultText = event.content ?? "";
        try {
          const parsed = JSON.parse(resultText);
          if (parsed && typeof parsed === "object" && "result" in parsed && typeof (parsed as any).result === "string") {
            resultText = (parsed as any).result as string;
          } else if (typeof parsed === "string") {
            resultText = parsed;
          } else {
            resultText = JSON.stringify(parsed, null, 2);
          }
        } catch {
          // 非JSONならそのまま
        }

        const resultDiv = document.createElement("div");
        resultDiv.className = "tool-call-result";

        // Markdown → サニタイズ済み HTML へ変換
        const body = document.createElement("div");
        body.className = "tool-call-result-body";
        body.innerHTML = renderMarkdown(resultText);
        resultDiv.appendChild(body);

        activeToolDetails.appendChild(resultDiv);
        autoScroll.maybeScroll();
      }

      activeToolDetails = null;
      activeToolName = "";
    },
    
    onRunFailed({ error }: { error: unknown }) {
      engine.reset(); // 喋ってる途中なら止める
      appendLine(
        "text-line--error",
        `❌ ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  };
}
