import { z } from "zod/v4"

// 環境変数スキーマ（Zodバリデーション）
const envSchema = z.object({
  XAI_API_KEY: z.string().min(1, "XAI_API_KEY が設定されていません"),
  XAI_MANAGEMENT_API_KEY: z.string().min(1).optional(),
  XAI_COLLECTION_ID: z.string().min(1).optional(),
  ROBLOX_API_KEY: z.string().min(1).optional(),
  ROBLOX_UNIVERSE_ID: z.string().min(1).optional(),
})

export type Env = z.infer<typeof envSchema>

// アプリケーション設定（定数）
export const APP_CONFIG = {
  // 使用するGrokモデル
  model: "grok-4-1-fast-non-reasoning",
  // 人格定義ファイル
  beingFile: "being.md",
  // データディレクトリ
  dataDir: "data",
  // セッション状態ファイル
  stateFile: "data/state.json",
  // メモリログファイル
  memoryFile: "data/memory.jsonl",
  // アプリケーションログファイル
  logFile: "data/app.log",
  // API基盤URL
  apiBaseUrl: "https://api.x.ai/v1",
  managementApiBaseUrl: "https://management-api.x.ai/v1",
  // Pulse（AI起点の定期発話）
  pulseFile: "pulse.md",
  pulseCron: "*/30 * * * *",
  pulsePrompt: "PULSE.mdの指示に従え。対応不要ならPULSE_OKと返答。",
  pulseOkPrefix: "PULSE_OK",
  // Roblox連携
  robloxOpenCloudBaseUrl: "https://apis.roblox.com/cloud/v2",
  robloxMessageTopic: "AICommands",
} as const

// 環境変数を検証して返す
export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const issues = result.error.issues.map((i) => i.message).join(", ")
    // loggerはAPP_CONFIGに依存するため、ここだけ直接stderr + exit
    process.stderr.write(`[FATAL] 環境変数エラー: ${issues}\n`)
    process.exit(1)
  }
  return result.data
}

// Collections APIが利用可能か判定
export function isCollectionsEnabled(env: Env): boolean {
  return Boolean(env.XAI_MANAGEMENT_API_KEY && env.XAI_COLLECTION_ID)
}

// Roblox連携が利用可能か判定
export function isRobloxEnabled(env: Env): boolean {
  return Boolean(env.ROBLOX_API_KEY && env.ROBLOX_UNIVERSE_ID)
}
