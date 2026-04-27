import { z } from "zod/v4"
import { homedir } from "node:os"
import { join, basename } from "node:path"
import { mkdirSync, existsSync } from "node:fs"
import { TOOL_NAMES } from "./shared/tool-approval-schema.js"

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
  X_CONSUMER_KEY: z.string().min(1).optional(),
  X_CONSUMER_SECRET: z.string().min(1).optional(),
  X_ACCESS_TOKEN: z.string().min(1).optional(),
  X_ACCESS_TOKEN_SECRET: z.string().min(1).optional(),
  X_WEBHOOK_SECRET: z.string().min(1).optional(),
  X_USER_ID: z.string().min(1).optional(),

  // --- 外部ID・名前 ---
  ROBLOX_OWNER_DISPLAY_NAME: z.string().min(1).optional(),

  // --- アイデンティティ ---
  AVATAR_NAME: z.string().min(1).default("Avatar"),
  USER_NAME: z.string().min(1).default("User"),

  // --- パス ---
  AVATAR_SPACE: z.string().min(1).default(join(homedir(), "Avatar", "space")),

  // --- ネットワーク ---
  ROBLOX_OBSERVATION_PORT: z
    .string()
    .regex(/^\d+$/, "ROBLOX_OBSERVATION_PORT は数値で指定してください")
    .default("3000"),

  // --- X ---
  X_WEBHOOK_PORT: z
    .string()
    .regex(/^\d+$/, "X_WEBHOOK_PORT は数値で指定してください")
    .default("3001"),

  // --- セッションWebSocket ---
  SESSION_WS_PORT: z
    .string()
    .regex(/^\d+$/, "SESSION_WS_PORT は数値で指定してください")
    .default("3002"),
  SESSION_WS_TOKEN: z.string().min(1).optional(),
  // WebSocket接続を受け付けるOriginのallowlist（カンマ区切り）
  // 未設定: すべてのOriginを許可（ローカル開発用）。設定時: 厳密に一致するOriginのみ許可
  // token認証に加える多層防御。クロスサイトWebSocketハイジャック対策
  SESSION_WS_ALLOWED_ORIGINS: z.string().optional(),

  // --- Discord ---
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  DISCORD_CHANNEL_ID: z.string().min(1).optional(),
  DISCORD_OWNER_ID: z.string().regex(/^\d+$/, "DISCORD_OWNER_ID は数値で指定してください").optional(),

  // --- 自己分析ジャーナル（オーナー専用 /log カスタムコマンドで使用） ---
  // 書き込み先 .md ファイルの絶対パス（rw領域、git管理外を推奨）
  SELF_ANALYSIS_JOURNAL_FILE: z.string().min(1).optional(),

  // --- オーナーID ---
  ROBLOX_OWNER_USER_ID: z.string().regex(/^\d+$/, "ROBLOX_OWNER_USER_ID は数値で指定してください").optional(),
  X_OWNER_USER_ID: z.string().regex(/^\d+$/, "X_OWNER_USER_ID は数値で指定してください").optional(),

  // --- アバター固有ファイルのディレクトリ（未設定ならルート直下） ---
  AVATAR_DIR: z.string().min(1).optional(),

  // --- Terminal ---
  TERMINAL_SHELL: z.string().min(1).default(
    // Unix: $SHELL、Windows: PowerShell
    process.platform === "win32"
      ? "powershell.exe"
      : basename(process.env.SHELL ?? "/bin/bash"),
  ),
  // AIのシェル実行権限（デフォルトoff: AIはterminalツールを使えない）
  AVATAR_SHELL: z
    .string()
    .default("off")
    .transform((v) => v.toLowerCase() === "on"),

  // ツール自動承認リスト（カンマ区切り。リスト外のツールは実行前にユーザー承認が必要）
  TOOL_AUTO_APPROVE: z
    .string()
    .default("save_memory,fs_list,fs_read")
    .transform((v) => {
      const names = v.split(",").map((s) => s.trim()).filter(Boolean)
      for (const name of names) {
        if (!TOOL_NAMES.includes(name as typeof TOOL_NAMES[number])) {
          throw new Error(`TOOL_AUTO_APPROVE に未知のツール名: ${name}`)
        }
      }
      return names
    }),

  // --- 承認タイムアウト ---
  // 承認待ちの制限時間（秒）。0=無制限。デフォルト60秒
  APPROVAL_TIMEOUT_SEC: z
    .string()
    .regex(/^\d+$/, "APPROVAL_TIMEOUT_SEC は0以上の整数で指定してください")
    .default("60")
    .transform(Number),

  // --- 開発者向け ---
  DEV_MODE: z
    .string()
    .default("off")
    .transform((v) => v.toLowerCase() === "on"),
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
  xConsumerKey: string | undefined
  xConsumerSecret: string | undefined
  xAccessToken: string | undefined
  xAccessTokenSecret: string | undefined
  xWebhookSecret: string | undefined
  xUserId: string | undefined

  // アイデンティティ
  avatarName: string
  userName: string

  // API
  apiBaseUrl: string
  managementApiBaseUrl: string

  // ファイルパス（定数: ルートはenv、派生はここで生成）
  avatarDir: string | undefined
  beingFile: string
  dataDir: string
  stateFile: string
  memoryFile: string
  logFile: string
  intentLogFile: string
  avatarSpace: string
  avatarSpaceExplicit: boolean

  // Pulse
  pulseDir: string

  // ネットワーク
  observationPort: number
  robloxOpenCloudBaseUrl: string
  xWebhookPort: number
  sessionWsPort: number
  sessionWsToken: string | undefined
  sessionWsAllowedOrigins: string[] | undefined

  // Discord
  discordBotToken: string | undefined
  discordChannelId: string | undefined
  discordOwnerId: string | undefined

  // 自己分析ジャーナル（owner専用 /log カスタムコマンド経由）
  selfAnalysisJournalFile: string | undefined

  // オーナーID（role判定用）
  robloxOwnerUserId: string | undefined
  xOwnerUserId: string | undefined

  // Terminal
  terminalShell: string
  avatarShell: boolean

  // ツール承認
  toolAutoApprove: string[]
  approvalTimeoutMs: number

  // 開発者向け
  devMode: boolean
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
    xConsumerKey: env.X_CONSUMER_KEY,
    xConsumerSecret: env.X_CONSUMER_SECRET,
    xAccessToken: env.X_ACCESS_TOKEN,
    xAccessTokenSecret: env.X_ACCESS_TOKEN_SECRET,
    xWebhookSecret: env.X_WEBHOOK_SECRET,
    xUserId: env.X_USER_ID,

    // アイデンティティ
    avatarName: env.AVATAR_NAME,
    userName: env.USER_NAME,

    // API（URL定数はコード管理）
    apiBaseUrl: "https://api.x.ai/v1",
    managementApiBaseUrl: "https://management-api.x.ai/v1",

    // ファイルパス（dataDirから派生）
    avatarDir: env.AVATAR_DIR,
    beingFile: env.AVATAR_DIR ? join(env.AVATAR_DIR, "BEING.md") : "BEING.md",
    dataDir,
    stateFile: join(dataDir, "state.json"),
    memoryFile: join(dataDir, "memory.jsonl"),
    logFile: join(dataDir, "app.log"),
    intentLogFile: join(dataDir, "roblox-intents.jsonl"),
    avatarSpace: env.AVATAR_SPACE,
    avatarSpaceExplicit,

    // Pulse（AVATAR_DIRから導出）
    pulseDir: env.AVATAR_DIR ? join(env.AVATAR_DIR, "pulse") : "pulse",

    // ネットワーク
    observationPort: Number(env.ROBLOX_OBSERVATION_PORT),
    robloxOpenCloudBaseUrl: "https://apis.roblox.com/cloud/v2",
    xWebhookPort: Number(env.X_WEBHOOK_PORT),
    sessionWsPort: Number(env.SESSION_WS_PORT),
    sessionWsToken: env.SESSION_WS_TOKEN,
    sessionWsAllowedOrigins: env.SESSION_WS_ALLOWED_ORIGINS
      ? env.SESSION_WS_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,

    // Discord
    discordBotToken: env.DISCORD_BOT_TOKEN,
    discordChannelId: env.DISCORD_CHANNEL_ID,
    discordOwnerId: env.DISCORD_OWNER_ID,

    // 自己分析ジャーナル（owner専用 /log カスタムコマンド経由）
    selfAnalysisJournalFile: env.SELF_ANALYSIS_JOURNAL_FILE,

    // オーナーID
    robloxOwnerUserId: env.ROBLOX_OWNER_USER_ID,
    xOwnerUserId: env.X_OWNER_USER_ID,

    // Terminal
    terminalShell: env.TERMINAL_SHELL,
    avatarShell: env.AVATAR_SHELL,

    // ツール承認
    toolAutoApprove: env.TOOL_AUTO_APPROVE,
    approvalTimeoutMs: env.APPROVAL_TIMEOUT_SEC * 1000,

    // 開発者向け
    devMode: env.DEV_MODE,
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

/** 起動時ディレクトリ保証（getConfig()直後に1回呼ぶ） */
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

// Discord窓口が利用可能か判定
export function isDiscordEnabled(config: AppConfig): boolean {
  return Boolean(config.discordBotToken && config.discordChannelId)
}

// X連携が利用可能か判定（OAuth認証4キー + ユーザーID が全て設定されている場合）
export function isXEnabled(config: AppConfig): boolean {
  return Boolean(
    config.xConsumerKey &&
    config.xConsumerSecret &&
    config.xAccessToken &&
    config.xAccessTokenSecret &&
    config.xUserId,
  )
}

