import { z } from "zod/v4"

// 環境変数スキーマ（Zodバリデーション）
const envSchema = z.object({
  XAI_API_KEY: z.string().min(1, "XAI_API_KEY が設定されていません"),
  XAI_MANAGEMENT_API_KEY: z.string().min(1).optional(),
  XAI_COLLECTION_ID: z.string().min(1).optional(),
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
  // API基盤URL
  apiBaseUrl: "https://api.x.ai/v1",
  managementApiBaseUrl: "https://management-api.x.ai/v1",
  // file_search障害時のfallback件数
  fallbackRecentCount: 20,
} as const

// 環境変数を検証して返す
export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const issues = result.error.issues.map((i) => i.message).join(", ")
    process.stderr.write(`環境変数エラー: ${issues}\n`)
    process.exit(1)
  }
  return result.data
}

// Collections APIが利用可能か判定
export function isCollectionsEnabled(env: Env): boolean {
  return Boolean(env.XAI_MANAGEMENT_API_KEY && env.XAI_COLLECTION_ID)
}
