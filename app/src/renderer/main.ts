// レンダラーのメイン処理: 設定読み込み・UI初期化・エージェント実行をまとめる
import { config, fetchConfig } from "./config";
import { createAgent } from "../core/agent";
import { loggerSubscriber } from "../core/loggerSubscriber";
import { createUiSubscriber, renderMarkdown } from "./subscriber";
import { TerminalEngine } from "./engine/TerminalEngine";
import { createAutoScrollController } from "./autoScroll";
import pkg from "../../package.json"; // バージョン情報の取得

// エージェントのインスタンスを保持する
let agentInstance = null as ReturnType<typeof createAgent> | null;

// UI 要素への参照を確保
const inputEl = document.getElementById("input") as HTMLInputElement | null;
const outputEl = document.querySelector("#pane-output .text-scroll") as HTMLElement | null;
const avatarImg = document.getElementById("avatar-img") as HTMLImageElement | null;
const metaBar = document.getElementById("meta");
const avatarLabel = document.getElementById("avatar-label");

async function initApp() {
  if (!inputEl || !outputEl || !avatarImg || !avatarLabel) {
    throw new Error("UI elements missing");
  }

  // メタバーはプロダクト名 + バージョン（package.json 由来）
  if (metaBar) {
    metaBar.textContent = `${pkg.name} v${pkg.version}`;
  }

  // 1. サーバーから設定を取得（サーバー起動前でも落とさずに待機）
  inputEl.disabled = true;
  outputEl.textContent = "";
  {
    const line = document.createElement("div");
    line.className = "text-line text-line--system";
    line.textContent = "> Starting server...";
    outputEl.appendChild(line);
  }

  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  let retryDelayMs = 250;
  while (true) {
    try {
      await fetchConfig({ silent: true });
      break;
    } catch {
      await sleep(retryDelayMs);
      retryDelayMs = Math.min(Math.round(retryDelayMs * 1.6), 5000);
    }
  }

  // 設定が取れたら通常表示へ
  outputEl.textContent = "";
  inputEl.disabled = false;
  inputEl.focus();

  // 2. UI初期化 (設定ロード後)
  // アバター枠内のラベルはエージェント名 (設定連動)
  avatarLabel.textContent = config.ui.nameTags.avatar;

  // ---------------------------------------------------------
  // カラーテーマ適用ロジック (CSS変数へ注入)
  // ---------------------------------------------------------
  const root = document.documentElement;

  // HEX -> RGB 変換ヘルパー（CSS変数への注入用）
  const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
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
    document.body.style.backgroundColor = `rgba(0, 0, 0, 0.0)`; // bodyを完全透過
    root.style.setProperty("--ui-opacity", String(config.ui.opacity));
  }

  // アバターオーバーレイの濃さ（テーマ色で着色）
  if (config.ui.avatarOverlayOpacity !== undefined) {
    root.style.setProperty("--avatar-overlay-opacity", String(config.ui.avatarOverlayOpacity));
  }
  if (config.ui.avatarBrightness !== undefined) {
    root.style.setProperty("--avatar-brightness", String(config.ui.avatarBrightness));
  }
  if (config.ui.glowText !== undefined) {
    root.style.setProperty("--glow-text-alpha1", String(0.6 * config.ui.glowText)); // 強めのグロー係数
    root.style.setProperty("--glow-text-alpha2", String(0.4 * config.ui.glowText)); // 弱めのグロー係数
  }
  if (config.ui.glowBox !== undefined) {
    root.style.setProperty("--glow-box-alpha1", String(0.4 * config.ui.glowBox)); // 外枠の強めグロー係数
    root.style.setProperty("--glow-box-alpha2", String(0.2 * config.ui.glowBox)); // 外枠の弱めグロー係数
  }
  if (config.ui.brightness !== undefined) {
    root.style.setProperty("--ui-brightness", String(config.ui.brightness));
  }

  // 3. UIエンジン (Game Loop) の初期化
  // これひとつでタイプライター・アニメーション・音声すべてを制御する
  const autoScroll = createAutoScrollController(outputEl);
  const engine = new TerminalEngine(outputEl, avatarImg, renderMarkdown, autoScroll);

  // 4. エージェント初期化（サーバ設定に従う）
  agentInstance = createAgent({
    agentId: config.agent.agentId,
    url: config.agent.url,
    threadId: config.agent.threadId,
  });
  agentInstance.subscribe(loggerSubscriber);

  // テキスト行を追加（エンジンを介さない即時表示用）
  const appendLine = (className: string, text: string) => {
    const line = document.createElement("div");
    line.className = `text-line ${className}`;
    line.textContent = text;
    outputEl.appendChild(line);
    outputEl.scrollTop = outputEl.scrollHeight;
  };

  let isRunning = false; // 多重実行防止フラグ

  // ユーザー入力を処理してエージェントに送信
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
          autoScroll,
        }),
      );
    } catch (error) {
      // エージェント実行エラーの表示
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
