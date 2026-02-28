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
// ENOENT（ファイルなし = 初回起動）はdefaultState()を返す
// それ以外のエラー（JSON破損等）はthrow（fail-fast: 呼び出し側で検知）
export function loadState(): State {
  try {
    const raw = fs.readFileSync(getConfig().stateFile, "utf-8")
    const obj = JSON.parse(raw)
    return {
      lastResponseId:
        typeof obj?.lastResponseId === "string" ? obj.lastResponseId : null,
    }
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultState()
    }
    throw err
  }
}

// state.jsonに保存する
export function saveState(state: State): void {
  const config = getConfig()
  fs.mkdirSync(config.dataDir, { recursive: true })
  fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2))
}
