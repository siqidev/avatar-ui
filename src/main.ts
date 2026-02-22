import OpenAI from "openai"
import * as readline from "node:readline"
import * as fs from "node:fs"

const DATA_DIR = "data"
const SESSION_FILE = `${DATA_DIR}/session.json`

type Message = {
  role: "system" | "user" | "assistant"
  content: string
}

type Session = {
  messages: Message[]
}

function loadSession(): Session {
  try {
    const raw = fs.readFileSync(SESSION_FILE, "utf-8")
    return JSON.parse(raw) as Session
  } catch {
    return { messages: [] }
  }
}

function saveSession(session: Session): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2))
}

async function main(): Promise<void> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    process.stderr.write("エラー: XAI_API_KEY が .env に設定されていません\n")
    process.exit(1)
  }

  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1",
  })

  const session = loadSession()

  if (session.messages.length === 0) {
    session.messages.push({
      role: "system",
      content: "あなたはSpectra。式乃シトの情報的パートナー。簡潔に、技術的に応答する。",
    })
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  process.stdout.write("Spectra と会話する（Ctrl+C で終了）\n\n")

  const prompt = (): void => {
    rl.question("you> ", async (input) => {
      if (!input.trim()) {
        prompt()
        return
      }

      session.messages.push({ role: "user", content: input })

      try {
        const response = await client.chat.completions.create({
          model: "grok-3-fast",
          messages: session.messages,
        })

        const reply = response.choices[0]?.message?.content ?? "(応答なし)"
        process.stdout.write(`\nspectra> ${reply}\n\n`)

        session.messages.push({ role: "assistant", content: reply })
        saveSession(session)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        process.stderr.write(`\nエラー: ${message}\n\n`)
      }

      prompt()
    })
  }

  prompt()

  rl.on("close", () => {
    saveSession(session)
    process.stdout.write("\n会話を保存しました。\n")
    process.exit(0)
  })
}

main()
