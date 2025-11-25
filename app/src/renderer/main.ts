import { config, fetchConfig } from "./config";
import { createAgent } from "../core/agent";
import { loggerSubscriber } from "../core/loggerSubscriber";
import { createUiSubscriber } from "./subscriber";
import { TerminalEngine } from "./engine/TerminalEngine";
import pkg from "../../package.json"; // バージョン情報の取得

// グローバルsubscriber登録（ロガー）
let agentInstance = null as ReturnType<typeof createAgent> | null;

const inputEl = document.getElementById("input") as HTMLInputElement | null;
const outputEl = document.querySelector("#pane-output .text-scroll") as HTMLElement | null;
const avatarImg = document.getElementById("avatar-img") as HTMLImageElement | null;
const metaBar = document.getElementById("meta");
const avatarLabel = document.getElementById("avatar-label");

async function initApp() {
  if (!inputEl || !outputEl || !avatarImg || !avatarLabel) {
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

  // 2. UI初期化 (設定ロード後)
  if (metaBar) {
    // メタバーはプロダクト名 + バージョン (不変)
    metaBar.textContent = `${pkg.name} v${pkg.version}`;
  }
  // アバター枠内のラベルはエージェント名 (設定連動)
  avatarLabel.textContent = config.ui.nameTags.avatar;

  // ---------------------------------------------------------
  // カラーテーマ適用ロジック (CSS変数へ注入)
  // ---------------------------------------------------------
  const root = document.documentElement;

  // HEX -> RGB 変換ヘルパー
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null;
  };

  // テーマカラー適用
  if (config.ui.themeColor) {
    const rgb = hexToRgb(config.ui.themeColor);
    if (rgb) {
      root.style.setProperty("--theme-color-r", String(rgb.r));
      root.style.setProperty("--theme-color-g", String(rgb.g));
      root.style.setProperty("--theme-color-b", String(rgb.b));
    }
  }

  // ユーザーカラー適用
  if (config.ui.userColor) {
    const rgb = hexToRgb(config.ui.userColor);
    if (rgb) {
      root.style.setProperty("--user-color-r", String(rgb.r));
      root.style.setProperty("--user-color-g", String(rgb.g));
      root.style.setProperty("--user-color-b", String(rgb.b));
    }
  }

  // ツールカラー適用
  if (config.ui.toolColor) {
    const rgb = hexToRgb(config.ui.toolColor);
    if (rgb) {
      root.style.setProperty("--tool-color-r", String(rgb.r));
      root.style.setProperty("--tool-color-g", String(rgb.g));
      root.style.setProperty("--tool-color-b", String(rgb.b));
    }
  }

  // 透過設定を適用
  if (config.ui.opacity !== undefined) {
    document.body.style.backgroundColor = `rgba(0, 0, 0, 0.0)`; // bodyは完全透過
    root.style.setProperty("--ui-opacity", String(config.ui.opacity));
  }

  // 3. UIエンジン (Game Loop) の初期化
  // これひとつでタイプライター・アニメーション・音声すべてを制御する
  const engine = new TerminalEngine(outputEl, avatarImg);

  // 4. エージェント初期化（サーバ設定に従う）
  agentInstance = createAgent({
    agentId: config.agent.agentId,
    url: config.agent.url,
    threadId: config.agent.threadId,
  });
  agentInstance.subscribe(loggerSubscriber);

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

    // ユーザー入力の表示: 設定されたユーザータグを使う
    const userTag = config.ui.nameTags.user ? `${config.ui.nameTags.user}> ` : "> ";
    appendLine("text-line--user", `${userTag}${value}`);
    inputEl.value = "";

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: value,
    };

    agentInstance!.messages.push(userMessage);

    isRunning = true;
    try {
      await agentInstance!.runAgent(
        {
          runId: crypto.randomUUID(),
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
  
  // 初期メッセージ: 設定されたシステムメッセージを使う
  const fullName = config.ui.nameTags.avatarFullName || config.ui.nameTags.avatar || "AGENT";
  if (config.ui.systemMessages.banner1) {
    const banner1 = config.ui.systemMessages.banner1.replace("{avatarFullName}", fullName);
    appendLine("text-line--system", `> ${banner1}`);
  }
  if (config.ui.systemMessages.banner2) {
    appendLine("text-line--system", `> ${config.ui.systemMessages.banner2}`);
  }
}

// アプリ起動
initApp().catch(err => console.error("Fatal Error:", err));
