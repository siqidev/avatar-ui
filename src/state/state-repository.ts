import * as fs from "node:fs"
import * as path from "node:path"
import { getConfig } from "../config.js"

// --- 永続化メッセージ型（UI再同期 + チェーン断裂時の復旧素材） ---

export type PersistedToolCall = {
  name: string
  args?: Record<string, unknown>
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
// 優先順: state.json → state.json.prev（1世代フォールバック） → defaultState()
// ENOENT（ファイルなし = 初回起動）はdefaultState()を返す

function parseStateFile(filePath: string): State {
  const raw = fs.readFileSync(filePath, "utf-8")
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
}

export type LoadStateResult = {
  state: State
  recoveredFromPrev: boolean // .prevから復帰した場合true
}

export function loadState(): LoadStateResult {
  const stateFile = getConfig().stateFile
  const prevFile = `${stateFile}.prev`

  // 1. state.jsonを試行
  try {
    return { state: parseStateFile(stateFile), recoveredFromPrev: false }
  } catch (err: unknown) {
    // ENOENT: ファイルなし = 初回起動
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: defaultState(), recoveredFromPrev: false }
    }

    // JSON破損 → .prevにフォールバック
    // 壊れたファイルを.corruptedにリネーム（原因調査用）
    try {
      fs.renameSync(stateFile, `${stateFile}.corrupted`)
    } catch { /* リネーム失敗は無視 */ }

    // 2. .prevを試行
    try {
      const state = parseStateFile(prevFile)
      return { state, recoveredFromPrev: true }
    } catch {
      // .prevも読めない → defaultState()
      return { state: defaultState(), recoveredFromPrev: true }
    }
  }
}

// --- state.jsonに保存する（atomic write: prev→rename→tmp→rename） ---
// 1世代バックアップ: 保存のたびに現行ファイルを.prevにrenameしてから新版を書く
// 破損時は.prevから復帰できる（loadStateのフォールバック）

export function saveState(state: State): void {
  const config = getConfig()
  fs.mkdirSync(config.dataDir, { recursive: true })

  const stateFile = config.stateFile
  const prevFile = `${stateFile}.prev`
  const tmpFile = `${stateFile}.tmp`

  // 現行を.prevに退避（ファイルが存在しない場合は無視）
  try {
    fs.renameSync(stateFile, prevFile)
  } catch (err: unknown) {
    if (!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT")) {
      throw err
    }
  }

  // 新版を書き込み
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2))
  fs.renameSync(tmpFile, stateFile)
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
    ...(tc.args ? { args: tc.args } : {}),
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
