import OpenAI from "openai"
import * as readline from "node:readline"
import * as fs from "node:fs"
import { loadEnv, isCollectionsEnabled, APP_CONFIG } from "./config.js"
import { loadState, saveState } from "./state/state-repository.js"
import { sendMessage } from "./services/chat-session-service.js"
import * as log from "./logger.js"

// being.mdから人格定義を読み込む
function loadBeing(): string {
  try {
    return fs.readFileSync(APP_CONFIG.beingFile, "utf-8").trim()
  } catch {
    log.fatal("being.md が見つかりません")
  }
}

async function main(): Promise<void> {
  const env = loadEnv()

  const client = new OpenAI({
    apiKey: env.XAI_API_KEY,
    baseURL: APP_CONFIG.apiBaseUrl,
  })

  const beingPrompt = loadBeing()
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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const prompt = (): void => {
    rl.question("you> ", async (userInput) => {
      if (!userInput.trim()) {
        prompt()
        return
      }

      try {
        const reply = await sendMessage(
          client,
          env,
          state,
          beingPrompt,
          userInput,
        )

        process.stdout.write(`\nspectra> ${reply}\n\n`)
        saveState(state)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        log.fatal(message)
      }
    })
  }

  prompt()

  rl.on("close", () => {
    process.stdout.write("\n会話を終了しました。\n")
    process.exit(0)
  })
}

main()
