import { z } from "zod/v4"
import { homedir } from "node:os"
import { join } from "node:path"
import { mkdirSync, existsSync } from "node:fs"

// 環境変数スキーマ（Zodバリデーション + デフォルト値）
const envSchema = z.object({
  // --- シークレット ---
  XAI_API_KEY: z.string().min(1, "XAI_API_KEY が設定されていません"),
  XAI_MANAGEMENT_API_KEY: z.string().min(1).optional(),
  XAI_COLLECTION_ID: z.string().min(1).optional(),
  ROBLOX_API_KEY: z.string().min(1).optional(),
  ROBLOX_UNIVERSE_ID: z.string().min(1).optional(),
  ROBLOX_OBSERVATION_SECRET: z.string().min(1).optional(),
  CLOUDFLARED_TOKEN: z.string().min(1).optional(),

  // --- 外部ID・名前 ---
  ROBLOX_OWNER_DISPLAY_NAME: z.string().min(1).optional(),

  // --- アイデンティティ ---
  AVATAR_NAME: z.string().min(1).default("Avatar"),
  USER_NAME: z.string().min(1).default("User"),

  // --- モデル ---
  GROK_MODEL: z.string().min(1).default("grok-4-1-fast-non-reasoning"),

  // --- パス ---
  AVATAR_SPACE: z.string().min(1).default(join(homedir(), "Avatar", "space")),

  // --- ネットワーク ---
  ROBLOX_OBSERVATION_PORT: z
    .string()
    .regex(/^\d+$/, "ROBLOX_OBSERVATION_PORT は数値で指定してください")
    .default("3000"),

  // --- Pulse ---
  PULSE_CRON: z.string().min(1).default("*/30 * * * *"),

  // --- Terminal ---
  TERMINAL_SHELL: z.string().min(1).default("zsh"),

  // --- ログ ---
  LOG_VERBOSE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
})

// アプリケーション設定（config.tsのみがprocess.envの入口）
export type AppConfig = {
  // シークレット・外部ID
  xaiApiKey: string
  xaiManagementApiKey: string | undefined
  xaiCollectionId: string | undefined
  robloxApiKey: string | undefined
  robloxUniverseId: string | undefined
  robloxObservationSecret: string | undefined
  robloxOwnerDisplayName: string | undefined
  cloudflaredToken: string | undefined

  // アイデンティティ
  avatarName: string
  userName: string

  // モデル・API
  model: string
  apiBaseUrl: string
  managementApiBaseUrl: string

  // ファイルパス（定数: ルートはenv、派生はここで生成）
  beingFile: string
  dataDir: string
  stateFile: string
  memoryFile: string
  logFile: string
  intentLogFile: string
  avatarSpace: string
  avatarSpaceExplicit: boolean

  // Pulse
  pulseCron: string
  pulseFile: string
  pulsePrompt: string
  pulseOkPrefix: string

  // ネットワーク
  observationPort: number
  robloxOpenCloudBaseUrl: string

  // Terminal
  terminalShell: string

  // ログ
  logVerbose: boolean
}

/** 環境変数からAppConfigを生成する（純粋関数） */
export function buildConfig(rawEnv: Record<string, string | undefined> = process.env): AppConfig {
  // 空文字をundefinedに変換（.envで KEY= と書かれた項目をoptionalとして扱う）
  const cleaned: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(rawEnv)) {
    cleaned[k] = v === "" ? undefined : v
  }

  // AVATAR_SPACEがユーザー明示か判定（safeParse前に確定）
  const avatarSpaceExplicit =
    typeof cleaned.AVATAR_SPACE === "string" && cleaned.AVATAR_SPACE.trim() !== ""

  const result = envSchema.safeParse(cleaned)
  if (!result.success) {
    const issues = result.error.issues.map((i) => i.message).join(", ")
    // loggerはconfigに依存するため、ここだけ直接stderr + exit
    process.stderr.write(`[FATAL] 環境変数エラー: ${issues}\n`)
    process.exit(1)
  }

  const env = result.data
  const dataDir = "data"

  return {
    // シークレット・外部ID
    xaiApiKey: env.XAI_API_KEY,
    xaiManagementApiKey: env.XAI_MANAGEMENT_API_KEY,
    xaiCollectionId: env.XAI_COLLECTION_ID,
    robloxApiKey: env.ROBLOX_API_KEY,
    robloxUniverseId: env.ROBLOX_UNIVERSE_ID,
    robloxObservationSecret: env.ROBLOX_OBSERVATION_SECRET,
    robloxOwnerDisplayName: env.ROBLOX_OWNER_DISPLAY_NAME,
    cloudflaredToken: env.CLOUDFLARED_TOKEN,

    // アイデンティティ
    avatarName: env.AVATAR_NAME,
    userName: env.USER_NAME,

    // モデル・API（URL定数はコード管理）
    model: env.GROK_MODEL,
    apiBaseUrl: "https://api.x.ai/v1",
    managementApiBaseUrl: "https://management-api.x.ai/v1",

    // ファイルパス（dataDirから派生）
    beingFile: "BEING.md",
    dataDir,
    stateFile: `${dataDir}/state.json`,
    memoryFile: `${dataDir}/memory.jsonl`,
    logFile: `${dataDir}/app.log`,
    intentLogFile: `${dataDir}/roblox-intents.jsonl`,
    avatarSpace: env.AVATAR_SPACE,
    avatarSpaceExplicit,

    // Pulse
    pulseCron: env.PULSE_CRON,
    pulseFile: "PULSE.md",
    pulsePrompt: "PULSE.mdの指示に従え。対応不要ならPULSE_OKと返答。",
    pulseOkPrefix: "PULSE_OK",

    // ネットワーク
    observationPort: Number(env.ROBLOX_OBSERVATION_PORT),
    robloxOpenCloudBaseUrl: "https://apis.roblox.com/cloud/v2",

    // Terminal
    terminalShell: env.TERMINAL_SHELL,

    // ログ
    logVerbose: env.LOG_VERBOSE,
  }
}

// 遅延singleton
let _config: AppConfig | null = null

/** AppConfigを取得する（初回呼び出し時にbuildConfig実行） */
export function getConfig(): AppConfig {
  if (!_config) _config = buildConfig()
  return _config
}

/** テスト用: configをリセットする */
export function _resetConfigForTest(rawEnv: Record<string, string | undefined>): AppConfig {
  _config = buildConfig(rawEnv)
  return _config
}

/** 起動時ディレクトリ保証（CLI/Electron共通、getConfig()直後に1回呼ぶ） */
export function ensureDirectories(config: AppConfig): void {
  // data/ は内部運用データ → 常に暗黙作成
  mkdirSync(config.dataDir, { recursive: true })

  // AVATAR_SPACE: デフォルト値→暗黙作成、明示設定→存在チェック+fail-fast
  if (config.avatarSpaceExplicit) {
    if (!existsSync(config.avatarSpace)) {
      process.stderr.write(
        `[FATAL] AVATAR_SPACE が存在しません: ${config.avatarSpace}\n`,
      )
      process.exit(1)
    }
  } else {
    mkdirSync(config.avatarSpace, { recursive: true })
  }
}

// Collections APIが利用可能か判定
export function isCollectionsEnabled(config: AppConfig): boolean {
  return Boolean(config.xaiManagementApiKey && config.xaiCollectionId)
}

// Roblox連携が利用可能か判定
export function isRobloxEnabled(config: AppConfig): boolean {
  return Boolean(config.robloxApiKey && config.robloxUniverseId)
}
