// app/src/renderer/config.ts

export interface UiConfig {
  theme: string;
  typeSpeed: number;
  soundVolume: number;
  mouthInterval: number;
  beepFrequency: number;
  beepDuration: number;
  beepVolumeEnd: number;
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

export interface AppConfig {
  server: {
    url: string;
  };
  ui: UiConfig;
}

// 初期状態 (未ロード)
const defaults: AppConfig = {
  server: {
    url: "", // プロキシ使用 (/agui/config)
  },
  ui: {
    theme: "loading...",
    typeSpeed: 0,
    soundVolume: 0,
    mouthInterval: 0,
    beepFrequency: 0,
    beepDuration: 0,
    beepVolumeEnd: 0,
    nameTags: {
      user: "",
      avatar: "",
      avatarFullName: "",
    },
    systemMessages: {
      banner1: "",
      banner2: "",
    },
  },
};

// シングルトン
export let config: AppConfig = { ...defaults };

export async function fetchConfig(): Promise<void> {
  try {
    // プロキシ経由で取得
    const response = await fetch("/agui/config");
    if (!response.ok) {
      throw new Error(`Config fetch failed: ${response.status} ${response.statusText}`);
    }
    const serverConfig = await response.json();

    // サーバーの設定で完全に上書き
    config.ui = serverConfig;

    console.info("Config loaded from server:", config.ui);
  } catch (error) {
    console.error("Failed to load config from server:", error);
    throw error; // Main側でキャッチしてエラー画面を表示
  }
}
