import * as fs from "node:fs"
import { getConfig } from "../config.js"

// セッション状態（後方互換: 旧形式の自動マイグレーション付き）
export type State = {
  lastResponseId: string | null
}

// デフォルト状態
export function defaultState(): State {
  return { lastResponseId: null }
}

// state.jsonを読み込む
export function loadState(): State {
  try {
    const raw = fs.readFileSync(getConfig().stateFile, "utf-8")
    const obj = JSON.parse(raw)
    return {
      lastResponseId:
        typeof obj?.lastResponseId === "string" ? obj.lastResponseId : null,
    }
  } catch {
    return defaultState()
  }
}

// state.jsonに保存する
export function saveState(state: State): void {
  const config = getConfig()
  fs.mkdirSync(config.dataDir, { recursive: true })
  fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2))
}
