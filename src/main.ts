import OpenAI from "openai"
import * as readline from "node:readline"
import * as fs from "node:fs"
import cron from "node-cron"
import { loadEnv, isCollectionsEnabled, isRobloxEnabled, APP_CONFIG } from "./config.js"
import { loadState, saveState } from "./state/state-repository.js"
import { sendMessage } from "./services/chat-session-service.js"
import { projectPendingIntents } from "./roblox/projector.js"
import { startObservationServer } from "./roblox/observation-server.js"
import type { ObservationEvent } from "./roblox/observation-server.js"
import * as log from "./logger.js"

// being.mdから人格定義を読み込む
function loadBeing(): string {
  try {
    return fs.readFileSync(APP_CONFIG.beingFile, "utf-8").trim()
  } catch {
    log.fatal("being.md が見つかりません")
  }
}

// pulse.mdを読み込む（層A: 不存在/空→null、他IOエラー→throw）
function loadPulse(): string | null {
  try {
    const content = fs.readFileSync(APP_CONFIG.pulseFile, "utf-8").trim()
    return content || null
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return null
    }
    throw err
  }
}

// 観測イベントをSpectraへの入力テキストに変換する
function formatObservation(event: ObservationEvent): string {
  const p = event.payload as Record<string, unknown>
  switch (event.type) {
    case "player_chat":
      return `[Roblox観測] ${p.player}が話しかけた: 「${p.message}」`
    case "player_proximity":
      return p.action === "enter"
        ? `[Roblox観測] ${p.player}が近づいてきた（距離: ${p.distance}スタッド）`
        : `[Roblox観測] ${p.player}が離れた`
    case "projection_ack":
      return `[Roblox観測] 投影結果: ${JSON.stringify(p)}`
    default:
      return `[Roblox観測] ${event.type}: ${JSON.stringify(p)}`
  }
}

async function main(): Promise<void> {
  const env = loadEnv()

  // cron式バリデーション（fail-fast）
  if (!cron.validate(APP_CONFIG.pulseCron)) {
    log.fatal(`不正なcron式: ${APP_CONFIG.pulseCron}`)
  }

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
  if (isRobloxEnabled(env)) {
    process.stdout.write("Roblox連携: 有効\n")

    // 起動時: 未送信の意図をリトライ
    const retried = await projectPendingIntents(env)
    if (retried > 0) {
      process.stdout.write(`  未送信の意図を${retried}件送信しました\n`)
    }
  }
  process.stdout.write("Spectra と会話する（Ctrl+C で終了）\n\n")

  // 直列キュー: ユーザー入力・Pulse・観測を同じPromiseチェーンで直列実行
  let queue = Promise.resolve()
  const enqueue = (task: () => Promise<void>): void => {
    queue = queue.then(task).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      log.fatal(message)
    })
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  rl.setPrompt("you> ")

  // 観測受信サーバー起動（Roblox→場のPush入力経路）
  if (isRobloxEnabled(env)) {
    startObservationServer((event: ObservationEvent) => {
      enqueue(async () => {
        const prompt = formatObservation(event)
        log.info(`[OBSERVATION→SPECTRA] ${prompt}`)

        readline.clearLine(process.stdout, 0)
        readline.cursorTo(process.stdout, 0)
        process.stdout.write(`\n[観測] ${prompt}\n`)

        const reply = await sendMessage(
          client,
          env,
          state,
          beingPrompt,
          prompt,
        )
        log.info(`[SPECTRA] ${reply}`)
        process.stdout.write(`\nspectra> ${reply}\n\n`)
        saveState(state)
        rl.prompt()
      })
    })
  }

  // ユーザー入力ハンドラ
  rl.on("line", (userInput: string) => {
    if (!userInput.trim()) {
      rl.prompt()
      return
    }
    enqueue(async () => {
      log.info(`[USER] ${userInput}`)
      const reply = await sendMessage(
        client,
        env,
        state,
        beingPrompt,
        userInput,
      )
      log.info(`[SPECTRA] ${reply}`)
      process.stdout.write(`\nspectra> ${reply}\n\n`)
      saveState(state)
      rl.prompt()
    })
  })

  // Pulseタイマー（層A→B→C）
  const pulseTask = cron.schedule(APP_CONFIG.pulseCron, () => {
    enqueue(async () => {
      // 層A: pulse.md読み込み（不存在/空→スキップ）
      const pulseContent = loadPulse()
      if (!pulseContent) return

      // 層B: being + pulseをsystemに結合
      const systemPrompt = `${beingPrompt}\n\n${pulseContent}`

      // 層C: sendMessage（forceSystemPrompt=trueでsystem再送信）
      log.info("Pulse発火")
      const reply = await sendMessage(
        client,
        env,
        state,
        systemPrompt,
        APP_CONFIG.pulsePrompt,
        true,
      )
      saveState(state)

      // PULSE_OK先頭→ログのみ、それ以外→readline割り込み表示
      if (reply.startsWith(APP_CONFIG.pulseOkPrefix)) {
        log.info(`[PULSE] 対応不要: ${reply.slice(0, 80)}`)
      } else {
        log.info(`[PULSE→SPECTRA] ${reply}`)
        // readlineの現在行をクリアして割り込み表示
        readline.clearLine(process.stdout, 0)
        readline.cursorTo(process.stdout, 0)
        process.stdout.write(`\nspectra> ${reply}\n\n`)
        rl.prompt()
      }
    })
  })

  rl.on("close", () => {
    pulseTask.stop()
    process.stdout.write("\n会話を終了しました。\n")
    process.exit(0)
  })

  rl.prompt()
}

main()
