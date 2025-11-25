// app/src/renderer/config.ts

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
  agent: {
    url: string;
    agentId: string;
    threadId: string;
  };
  clientLogVerbose: boolean;
  ui: UiConfig;
}

// 初期状態 (未ロード)
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
    themeColor: "#33ff99",
    userColor: "#64ffff",
    toolColor: "#ffaa00",
    typeSpeed: 0,
    opacity: 0.7,
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

    // 新形式: { ui, clientLogVerbose, agent }, 旧形式: uiのみ
    const ui = serverConfig.ui ?? serverConfig;
    const agent = serverConfig.agent ?? defaults.agent;
    config.ui = ui;
    config.agent = {
      url: agent.url ?? "",
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
    console.error("Failed to load config from server:", error);
    throw error; // Main側でキャッチしてエラー画面を表示
  }
}
