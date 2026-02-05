// UI とエージェントの設定を読み込み・保持するモジュール
// app/src/renderer/config.ts

declare const __AGUI_BASE__: string; // Vite が注入する公開ベースパス

// サーバーから受け取る UI 設定の型定義
export interface UiConfig {
  themeColor: string;
  userColor: string;
  toolColor: string;
  typeSpeed: number;
  opacity: number;
  soundVolume: number;
  mouthInterval: number;
  beepFrequency: number;
  beepDuration: number;
  beepVolumeEnd: number;
  avatarOverlayOpacity?: number;
  avatarBrightness?: number;
  glowText?: number;
  glowBox?: number;
  brightness?: number;
  nameTags: {
    user: string;
    avatar: string;
    avatarFullName: string;
  };
  systemMessages: {
    banner1: string;
    banner2: string;
  };
}

// アプリ全体の設定（サーバー・エージェント・UI を統合）
export interface AppConfig {
  server: {
    url: string;
  };
  agent: {
    url: string;
    agentId: string;
    threadId: string;
  };
  clientLogVerbose: boolean;
  ui: UiConfig;
}

// 初期状態 (未ロード時に使うデフォルト値)
const defaults: AppConfig = {
  server: {
    url: "", // プロキシ使用 (/agui/config)
  },
  agent: {
    url: "",
    agentId: "",
    threadId: "",
  },
  clientLogVerbose: false,
  ui: {
    themeColor: "#33ff99",    // UI の基調色
    userColor: "#64ffff",     // ユーザーメッセージ色
    toolColor: "#ffaa00",     // ツールメッセージ色
    typeSpeed: 0,             // 0=即時描画
    opacity: 0.7,             // メインパネルの透明度
    soundVolume: 0,           // 効果音ボリューム初期値
    mouthInterval: 0,         // リップシンク間隔初期値
    beepFrequency: 0,         // ビープ周波数初期値
    beepDuration: 0,          // ビープ長さ初期値
    beepVolumeEnd: 0,         // ビープ終了時音量初期値
    nameTags: {
      user: "",               // 表示名: ユーザー
      avatar: "",             // 表示名: アバター
      avatarFullName: "",     // 表示名: フルネーム
    },
    systemMessages: {
      banner1: "",            // システムメッセージ1
      banner2: "",            // システムメッセージ2
    },
  },
};

// シングルトン: アプリ全体で共有する設定オブジェクト
export let config: AppConfig = { ...defaults };

export interface FetchConfigOptions {
  /** 設定取得に失敗しても console.error を出さない（リトライ待機用） */
  silent?: boolean;
}

/**
 * サーバーから設定を取得し、config を更新する
 * @throws 取得失敗時は例外をスローし、呼び出し元でエラー表示を行う
 */
export async function fetchConfig(options: FetchConfigOptions = {}): Promise<void> {
  try {
    // dev: /agui/config (Vite proxy) / prod: http://127.0.0.1:8000/agui/config
    const base = typeof __AGUI_BASE__ !== "undefined" ? __AGUI_BASE__ : "";
    const response = await fetch(`${base}/agui/config`);
    if (!response.ok) {
      throw new Error(`Config fetch failed: ${response.status} ${response.statusText}`);
    }
    const serverConfig = await response.json();

    // 新形式: { ui, clientLogVerbose, agent }, 旧形式: uiのみ
    const ui = serverConfig.ui ?? serverConfig;
    const agent = serverConfig.agent ?? defaults.agent;
    config.ui = ui;
    const agentUrl = agent.url ?? `${base}/agui`;
    config.agent = {
      url: agentUrl,
      agentId: agent.agentId ?? "",
      threadId: agent.threadId ?? "",
    };
    config.clientLogVerbose = Boolean(serverConfig.clientLogVerbose ?? false);

	    console.info("Config loaded from server:", {
	      ui: config.ui,
	      agent: config.agent,
	      clientLogVerbose: config.clientLogVerbose,
	    });
	  } catch (error) {
	    if (!options.silent) {
	      console.error("Failed to load config from server:", error);
	    }
	    throw error; // Main側でキャッチしてエラー画面を表示
	  }
}
