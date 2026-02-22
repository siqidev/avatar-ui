import OpenAI from "openai"
import * as readline from "node:readline"
import * as fs from "node:fs"
import { loadEnv, isCollectionsEnabled, APP_CONFIG } from "./config.js"
import { loadState, saveState } from "./state/state-repository.js"
import { sendMessageWithFallback } from "./services/chat-session-service.js"
import { syncMemoriesToCollection } from "./services/memory-sync-service.js"

// being.mdから人格定義を読み込む
function loadBeing(): string {
  try {
    return fs.readFileSync(APP_CONFIG.beingFile, "utf-8").trim()
  } catch {
    process.stderr.write("エラー: being.md が見つかりません\n")
    process.exit(1)
  }
}

async function main(): Promise<void> {
  // 環境変数をZodで検証
  const env = loadEnv()

  // xAI Grok APIクライアントを初期化（OpenAI互換SDKを使用）
  const client = new OpenAI({
    apiKey: env.XAI_API_KEY,
    baseURL: APP_CONFIG.apiBaseUrl,
  })

  // 人格定義を読み込む
  const beingPrompt = loadBeing()

  // 前回のセッション状態を読み込む（旧形式の自動マイグレーション付き）
  const state = loadState()

  // 起動メッセージ
  if (state.lastResponseId) {
    process.stdout.write("前回の会話を継続します\n")
  } else {
    process.stdout.write("新しい会話を開始します\n")
  }
  if (isCollectionsEnabled(env)) {
    process.stdout.write("長期記憶: Collections API 有効\n")
  } else {
    process.stdout.write(
      "長期記憶: ローカルのみ（XAI_COLLECTION_ID / XAI_MANAGEMENT_API_KEY を設定するとCollections有効）\n",
    )
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
        // メッセージ送信（ツール処理+fallback付き）
        const result = await sendMessageWithFallback(
          client,
          env,
          state,
          beingPrompt,
          userInput,
        )

        process.stdout.write(`\nspectra> ${result.reply}\n\n`)

        // 状態を保存
        saveState(state)

        // 記憶が保存された場合、非同期でCollectionsに同期
        if (
          result.memorySaved &&
          isCollectionsEnabled(env) &&
          env.XAI_COLLECTION_ID &&
          env.XAI_MANAGEMENT_API_KEY
        ) {
          syncMemoriesToCollection(
            client,
            env.XAI_COLLECTION_ID,
            env.XAI_MANAGEMENT_API_KEY,
            state,
          )
            .then(() => saveState(state))
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err)
              process.stderr.write(`Collections同期エラー: ${msg}\n`)
            })
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        process.stderr.write(`\nエラー: ${message}\n\n`)
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
