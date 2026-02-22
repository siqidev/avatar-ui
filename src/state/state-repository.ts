import * as fs from "node:fs"
import { APP_CONFIG } from "../config.js"

// メモリ同期の状態
type MemorySyncState = {
  // Collections反映済みの最終memory ID
  syncCursorId: string | null
  // 2段階uploadの中断復帰用（files成功→documents attach前に中断した場合）
  stagedUpload: {
    memoryId: string
    fileId: string
  } | null
  // 連続同期失敗回数
  consecutiveSyncFailures: number
  // 最終同期エラー日時
  lastSyncErrorAt: string | null
}

// セッション状態（v0.4拡張版、後方互換）
export type State = {
  lastResponseId: string | null
  memory: MemorySyncState
}

// v0.3以前の旧形式
type LegacyState = {
  lastResponseId: string | null
}

// デフォルトのメモリ同期状態
function defaultMemorySync(): MemorySyncState {
  return {
    syncCursorId: null,
    stagedUpload: null,
    consecutiveSyncFailures: 0,
    lastSyncErrorAt: null,
  }
}

// デフォルト状態
export function defaultState(): State {
  return {
    lastResponseId: null,
    memory: defaultMemorySync(),
  }
}

// 旧形式からの自動マイグレーション
function migrate(raw: unknown): State {
  if (raw === null || typeof raw !== "object") {
    return defaultState()
  }
  const obj = raw as Record<string, unknown>
  return {
    lastResponseId:
      typeof obj.lastResponseId === "string" ? obj.lastResponseId : null,
    memory:
      obj.memory && typeof obj.memory === "object"
        ? (obj.memory as MemorySyncState)
        : defaultMemorySync(),
  }
}

// state.jsonを読み込む（旧形式→新形式の自動マイグレーション付き）
export function loadState(): State {
  try {
    const raw = fs.readFileSync(APP_CONFIG.stateFile, "utf-8")
    return migrate(JSON.parse(raw))
  } catch {
    return defaultState()
  }
}

// state.jsonに保存する
export function saveState(state: State): void {
  fs.mkdirSync(APP_CONFIG.dataDir, { recursive: true })
  fs.writeFileSync(APP_CONFIG.stateFile, JSON.stringify(state, null, 2))
}
