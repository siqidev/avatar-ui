import OpenAI from "openai"
import type { ResponseInput } from "openai/resources/responses/responses"
import * as readline from "node:readline"
import * as fs from "node:fs"

// 人格定義ファイル（being.md）のパス
const BEING_FILE = "being.md"

// 使用するGrokモデル
const MODEL = "grok-4-1-fast-non-reasoning"

// セッション状態の保存先（response_idのみ保存）
const DATA_DIR = "data"
const STATE_FILE = `${DATA_DIR}/state.json`

// セッション状態の型（前回のresponse_idだけ保持）
type State = {
  lastResponseId: string | null
}

// being.mdから人格定義を読み込む
function loadBeing(): string {
  try {
    return fs.readFileSync(BEING_FILE, "utf-8").trim()
  } catch {
    process.stderr.write("エラー: being.md が見つかりません\n")
    process.exit(1)
  }
}

// セッション状態をファイルから読み込む
function loadState(): State {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8")
    return JSON.parse(raw) as State
  } catch {
    return { lastResponseId: null }
  }
}

// セッション状態をファイルに保存する
function saveState(state: State): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

async function main(): Promise<void> {
  // APIキーの確認
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    process.stderr.write("エラー: XAI_API_KEY が .env に設定されていません\n")
    process.exit(1)
  }

  // xAI Grok APIクライアントを初期化（OpenAI互換SDKを使用）
  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1",
  })

  // 人格定義を読み込む
  const beingPrompt = loadBeing()

  // 前回のセッション状態を読み込む
  const state = loadState()

  if (state.lastResponseId) {
    process.stdout.write("前回の会話を継続します\n")
  } else {
    process.stdout.write("新しい会話を開始します\n")
  }
  process.stdout.write("Spectra と会話する（Ctrl+C で終了）\n\n")

  // ターミナルの入出力インターフェース
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  // ユーザー入力を待ち、Spectraに送信し、応答を表示するループ
  const prompt = (): void => {
    rl.question("you> ", async (userInput) => {
      // 空入力は無視して再度プロンプト表示
      if (!userInput.trim()) {
        prompt()
        return
      }

      try {
        // Responses APIでSpectraに送信
        // 初回: systemロール（人格定義）+ userロールをinput配列で送信
        // 継続: previous_response_idで会話継続、userメッセージのみ送信
        const input: ResponseInput = state.lastResponseId
          ? [{ role: "user" as const, content: userInput }]
          : [
              { role: "system" as const, content: beingPrompt },
              { role: "user" as const, content: userInput },
            ]

        const response = await client.responses.create({
          model: MODEL,
          input,
          store: true,
          ...(state.lastResponseId
            ? { previous_response_id: state.lastResponseId }
            : {}),
        })

        const reply = response.output_text ?? "(応答なし)"
        process.stdout.write(`\nspectra> ${reply}\n\n`)

        // response_idを保存（次回の継続用）
        state.lastResponseId = response.id
        saveState(state)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        process.stderr.write(`\nエラー: ${message}\n\n`)

        // 30日超過等でprevious_response_idが無効になった場合、リセットして再試行
        if (message.includes("previous_response_id")) {
          process.stderr.write("セッションをリセットします\n\n")
          state.lastResponseId = null
          saveState(state)
        }
      }

      // 次の入力を待つ
      prompt()
    })
  }

  prompt()

  // Ctrl+Cで終了時
  rl.on("close", () => {
    process.stdout.write("\n会話を終了しました。\n")
    process.exit(0)
  })
}

main()
