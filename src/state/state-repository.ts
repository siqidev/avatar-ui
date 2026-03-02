import * as fs from "node:fs"
import * as path from "node:path"
import { getConfig } from "../config.js"

// --- 永続化メッセージ型（UI再同期 + チェーン断裂時の復旧素材） ---

export type PersistedToolCall = {
  name: string
  result: string // 先頭プレビューのみ（MAX_TOOL_RESULT_CHARS で切り詰め）
}

export type PersistedMessage = {
  actor: "human" | "ai"
  text: string
  source?: "user" | "pulse" | "observation"
  toolCalls?: PersistedToolCall[]
}

// --- State型: 場側 + 参与者側を概念分離（接続契約に準拠） ---

export type FieldPersistence = {
  state: string // FieldState。"generated" | "active" | "paused" | "resumed" | "terminated"
  messageHistory: PersistedMessage[]
}

export type ParticipantPersistence = {
  lastResponseId: string | null
  lastResponseAt: string | null // ISO8601。チェーン有効性判定用
}

export type State = {
  schemaVersion: 1
  field: FieldPersistence
  participant: ParticipantPersistence
}

// --- 定数 ---

const CURRENT_SCHEMA_VERSION = 1
const MAX_HISTORY_ENTRIES = 120
const MAX_MESSAGE_CHARS = 4000
const MAX_TOOL_RESULT_CHARS = 800

// --- デフォルト状態 ---

export function defaultState(): State {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    field: {
      state: "generated",
      messageHistory: [],
    },
    participant: {
      lastResponseId: null,
      lastResponseAt: null,
    },
  }
}

// --- マイグレーション: 旧形式 { lastResponseId } → 新形式 ---

function migrateFromLegacy(obj: Record<string, unknown>): State {
  const state = defaultState()
  if (typeof obj.lastResponseId === "string") {
    state.participant.lastResponseId = obj.lastResponseId
    // 旧形式にはlastResponseAtがないためnull（起動時補正でTTLチェック不可→安全側でnull維持）
  }
  return state
}

// --- state.jsonを読み込む ---
// ENOENT（ファイルなし = 初回起動）はdefaultState()を返す
// JSON破損はthrow（fail-fast）

export function loadState(): State {
  try {
    const raw = fs.readFileSync(getConfig().stateFile, "utf-8")
    const obj = JSON.parse(raw) as Record<string, unknown>

    // 新形式: schemaVersionが存在する
    if (typeof obj.schemaVersion === "number" && obj.schemaVersion === CURRENT_SCHEMA_VERSION) {
      const field = obj.field as Record<string, unknown> | undefined
      const participant = obj.participant as Record<string, unknown> | undefined

      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        field: {
          state: typeof field?.state === "string" ? field.state : "generated",
          messageHistory: Array.isArray(field?.messageHistory) ? field.messageHistory as PersistedMessage[] : [],
        },
        participant: {
          lastResponseId: typeof participant?.lastResponseId === "string" ? participant.lastResponseId : null,
          lastResponseAt: typeof participant?.lastResponseAt === "string" ? participant.lastResponseAt : null,
        },
      }
    }

    // 旧形式: マイグレーション
    return migrateFromLegacy(obj)
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultState()
    }
    throw err
  }
}

// --- state.jsonに保存する（atomic write: tmp→rename） ---

export function saveState(state: State): void {
  const config = getConfig()
  fs.mkdirSync(config.dataDir, { recursive: true })

  const tmpFile = `${config.stateFile}.tmp`
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2))
  fs.renameSync(tmpFile, config.stateFile)
}

// --- メッセージ履歴のヘルパー ---

export function pushMessage(
  history: PersistedMessage[],
  msg: PersistedMessage,
): void {
  // 1件の文字数制限
  const trimmedText = msg.text.length > MAX_MESSAGE_CHARS
    ? msg.text.substring(0, MAX_MESSAGE_CHARS)
    : msg.text

  // toolCallsのresultプレビュー
  const trimmedToolCalls = msg.toolCalls?.map((tc) => ({
    name: tc.name,
    result: tc.result.length > MAX_TOOL_RESULT_CHARS
      ? tc.result.substring(0, MAX_TOOL_RESULT_CHARS)
      : tc.result,
  }))

  history.push({
    ...msg,
    text: trimmedText,
    ...(trimmedToolCalls ? { toolCalls: trimmedToolCalls } : {}),
  })

  // 件数上限
  while (history.length > MAX_HISTORY_ENTRIES) {
    history.shift()
  }
}
