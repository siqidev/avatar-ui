import { config, fetchConfig } from "./config";
import { agent, agentConfig } from "../core/agent";
import { loggerSubscriber } from "../core/loggerSubscriber";
import { createUiSubscriber } from "./subscriber";
import { TerminalEngine } from "./engine/TerminalEngine";
import pkg from "../../package.json"; // バージョン情報の取得

// グローバルsubscriber登録（ロガー）
agent.subscribe(loggerSubscriber);

const inputEl = document.getElementById("input") as HTMLInputElement | null;
const outputEl = document.querySelector("#pane-output .text-scroll") as HTMLElement | null;
const avatarImg = document.getElementById("avatar-img") as HTMLImageElement | null;
const metaBar = document.getElementById("meta");

async function initApp() {
  if (metaBar) {
    // package.json から名前とバージョンを取得して表示
    metaBar.textContent = `${pkg.name} v${pkg.version}`;
  }

  if (!inputEl || !outputEl || !avatarImg) {
    throw new Error("UI elements missing");
  }

  // 1. サーバーから設定を取得 (Fail-Fast)
  try {
    await fetchConfig();
  } catch (error) {
    // 設定取得失敗時のエラー表示
    outputEl.innerHTML = `
      <div style="color: #ff4444; padding: 20px;">
        <h2>CONNECTION ERROR</h2>
        <p>Failed to connect to AG-UI Server at <code>${config.server.url}</code>.</p>
        <p>Please ensure the server is running:</p>
        <pre>cd server && uvicorn main:app --reload</pre>
        <p>Error details: ${String(error)}</p>
      </div>
    `;
    return; // アプリ起動を中断
  }

  // 2. UIエンジン (Game Loop) の初期化
  // これひとつでタイプライター・アニメーション・音声すべてを制御する
  const engine = new TerminalEngine(outputEl, avatarImg);

  const appendLine = (className: string, text: string) => {
    const line = document.createElement("p");
    line.className = `text-line ${className}`;
    line.textContent = text;
    outputEl.appendChild(line);
    outputEl.scrollTop = outputEl.scrollHeight;
  };

  let isRunning = false;

  inputEl.addEventListener("keydown", async (event) => {
    if (event.isComposing || event.key !== "Enter") {
      return;
    }
    event.preventDefault();

    if (isRunning) {
      return;
    }

    const value = inputEl.value.trim();
    if (!value) {
      return;
    }

    appendLine("text-line--user", `> ${value}`);
    inputEl.value = "";

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: value,
    };

    agent.messages.push(userMessage);

    isRunning = true;
    try {
      await agent.runAgent(
        {
          runId: crypto.randomUUID(),
          threadId: agentConfig.threadId,
        },
        createUiSubscriber({
          outputEl,
          engine, // エンジンを渡す
        }),
      );
    } catch (error) {
      console.error(error);
      appendLine(
        "text-line--error",
        `❌ ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      isRunning = false;
    }
  });
  
  // 初期メッセージ
  appendLine("text-line--system", "SYSTEM READY.");
  appendLine("text-line--system", `Config loaded: ${config.ui.theme} mode`);
}

// アプリ起動
initApp().catch(err => console.error("Fatal Error:", err));
