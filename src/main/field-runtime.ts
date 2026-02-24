import OpenAI from "openai"
import * as fs from "node:fs"
import cron from "node-cron"
import { loadEnv, APP_CONFIG } from "../config.js"
import { loadState, saveState } from "../state/state-repository.js"
import type { State } from "../state/state-repository.js"
import { sendMessage } from "../services/chat-session-service.js"
import * as log from "../logger.js"
import type { Env } from "../config.js"

// FieldRuntime: 場のロジックを統合する
// CLIのmain()と同等の機能をElectron Main向けに提供

let client: OpenAI
let env: Env
let state: State
let beingPrompt: string
let initialized = false

// 直列キュー（同時にsendMessageを呼ばないようにする）
let queue: Promise<void> = Promise.resolve()
function enqueue(fn: () => Promise<void>): Promise<void> {
  queue = queue.then(fn, fn)
  return queue
}

// being.mdを読み込む
function loadBeing(): string {
  try {
    return fs.readFileSync(APP_CONFIG.beingFile, "utf-8").trim()
  } catch {
    throw new Error("BEING.md が見つかりません")
  }
}

// pulse.mdを読み込む
function loadPulse(): string | null {
  try {
    const content = fs.readFileSync(APP_CONFIG.pulseFile, "utf-8").trim()
    return content || null
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }
    throw err
  }
}

// FieldRuntimeを初期化する
export function initRuntime(): void {
  if (initialized) return

  env = loadEnv()
  client = new OpenAI({
    apiKey: env.XAI_API_KEY,
    baseURL: APP_CONFIG.apiBaseUrl,
  })
  beingPrompt = loadBeing()
  state = loadState()
  initialized = true

  log.info(`[RUNTIME] 初期化完了 (lastResponseId: ${state.lastResponseId ?? "なし"})`)
}

// チャットメッセージを処理する（chat.post → sendMessage → chat.reply）
export function processChat(text: string): Promise<string> {
  if (!initialized) throw new Error("FieldRuntime未初期化")

  return new Promise<string>((resolve, reject) => {
    enqueue(async () => {
      try {
        const reply = await sendMessage(client, env, state, beingPrompt, text)
        saveState(state)
        resolve(reply)
      } catch (err) {
        reject(err)
      }
    })
  })
}

// Pulseを開始する（AI起点の定期発話）
export function startPulse(onReply: (text: string) => void): void {
  if (!initialized) throw new Error("FieldRuntime未初期化")

  cron.schedule(APP_CONFIG.pulseCron, () => {
    const pulseContent = loadPulse()
    if (!pulseContent) return

    log.info("[PULSE] 発火")
    enqueue(async () => {
      try {
        const reply = await sendMessage(
          client,
          env,
          state,
          beingPrompt,
          APP_CONFIG.pulsePrompt,
          true, // forceSystemPrompt
        )
        saveState(state)
        if (!reply.startsWith(APP_CONFIG.pulseOkPrefix)) {
          log.info(`[PULSE] 応答: ${reply.substring(0, 100)}`)
          onReply(reply)
        } else {
          log.info("[PULSE] 対応不要")
        }
      } catch (err) {
        log.error(`[PULSE] エラー: ${err instanceof Error ? err.message : err}`)
      }
    })
  })

  log.info(`[PULSE] cron開始: ${APP_CONFIG.pulseCron}`)
}

// 現在のlastResponseIdを取得（会話継続性の確認用）
export function getLastResponseId(): string | null {
  return state?.lastResponseId ?? null
}
