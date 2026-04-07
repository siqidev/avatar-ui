// pulse-runner: パルス定義をcronスケジュールし、データ取得・表示・AI送信を実行する

import cron, { type ScheduledTask } from "node-cron"
import { createHash } from "node:crypto"
import type { PulseDefinition } from "./pulse-loader.js"
import { loadPulses } from "./pulse-loader.js"
import { getConfig, isRobloxEnabled } from "../config.js"
import { publishMessage } from "../roblox/roblox-messaging.js"
import { generateCorrelationId } from "../shared/participation-context.js"
import * as log from "../logger.js"

// --- 依存注入（field-runtimeから渡される） ---

export type PulseRunnerDeps = {
  isFieldActive: () => boolean
  isResonanceOn: () => boolean
  enqueue: (fn: () => Promise<void>) => void
  sendMessage: (input: string, source: "pulse", channel: import("../shared/channel.js").ChannelId, options?: { toolNames?: string[] }) => Promise<PulseSendResult>
  emitStreamItem: (actor: "ai", text: string, correlationId: string, source: "pulse", channel: import("../shared/channel.js").ChannelId, toolCalls: PulseToolCall[], displayText?: string) => void
  publishXToolResults: (toolCalls: PulseToolCall[]) => void
  getXEventHistory: () => Array<{ eventType: string; formatted: string; timestamp: string }>
}

export type PulseSendResult = {
  text: string
  displayText: string
  toolCalls: PulseToolCall[]
}

export type PulseToolCall = {
  name: string
  args: Record<string, unknown>
  result: string
}

// --- 状態 ---

// パルスごとのbusy flag（承認待ちで重複実行を防止）
const busyMap = new Map<string, boolean>()
// パルスごとのデータハッシュ（重複検出）
const hashMap = new Map<string, string>()
// アクティブなcronタスク（停止用）
const cronTasks: ScheduledTask[] = []

// --- テンプレート展開 ---

// {key}プレースホルダをオブジェクトのフィールドで展開する
function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = data[key]
    if (value === undefined || value === null) return ""
    return String(value)
  })
}

// JSONレスポンスをテンプレートで整形する（配列なら先頭5件）
function renderData(template: string, body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown
    if (Array.isArray(parsed)) {
      const items = parsed.slice(0, 5) as Record<string, unknown>[]
      return items.map((item) => renderTemplate(template, item)).join("\n")
    }
    if (typeof parsed === "object" && parsed !== null) {
      return renderTemplate(template, parsed as Record<string, unknown>)
    }
    return body
  } catch {
    // JSONでなければ生データを返す
    return body
  }
}

// --- Roblox表示送信 ---

async function sendToRobloxDisplay(target: string, text: string, title?: string): Promise<void> {
  const config = getConfig()
  if (!isRobloxEnabled(config)) return

  const ops = [{ op: "set_text", target, text, ...(title ? { title } : {}) }]
  const message = JSON.stringify({
    schema_version: "3",
    intent_id: `pulse_display_${Date.now()}`,
    category: "display",
    ops,
  })

  const result = await publishMessage(
    config.robloxApiKey!,
    config.robloxUniverseId!,
    "AICommands",
    message,
  )

  if (!result.success) {
    log.error(`[PULSE] Roblox表示送信失敗: ${result.error.message}`)
  }
}

// --- データ取得 ---

async function fetchSource(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) {
      log.error(`[PULSE] HTTP ${res.status}: ${url}`)
      return null
    }
    return await res.text()
  } catch (err) {
    log.error(`[PULSE] フェッチエラー: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

// --- X投稿用: 直近投稿履歴を注入 ---

function injectXHistory(instructions: string, deps: PulseRunnerDeps): string {
  const recentPosts = deps.getXEventHistory()
    .filter((e) => e.eventType === "post")
    .slice(-5)
    .map((e) => `- ${e.formatted.replace(/^\[post\]\s*/, "")} (${e.timestamp.substring(0, 10)})`)

  if (recentPosts.length === 0) return instructions

  return `${instructions}\n\n# 直近の投稿（同じ話題・同じ切り口で書くな）\n${recentPosts.join("\n")}`
}

// --- パルス実行 ---

function executePulse(pulse: PulseDefinition, deps: PulseRunnerDeps): void {
  // 場の状態チェック
  if (!deps.isFieldActive()) {
    log.info(`[PULSE:${pulse.name}] 場が非アクティブ — スキップ`)
    return
  }

  // busyチェック（前回のジョブが承認待ちで完了していない場合スキップ）
  if (busyMap.get(pulse.name)) {
    log.info(`[PULSE:${pulse.name}] 前回のジョブが未完了 — スキップ`)
    return
  }

  const correlationId = generateCorrelationId("pulse")
  log.info(`[PULSE:${pulse.name}] 発火 (${correlationId})`)
  busyMap.set(pulse.name, true)

  deps.enqueue(async () => {
    try {
      const channel = pulse.channel ?? "console"

      // 1. データ取得（source設定時）
      let fetchedData: string | null = null
      if (pulse.source) {
        // 共振ゲート: データフィード系はresonance OFFでスキップ
        if (!deps.isResonanceOn()) {
          log.info(`[PULSE:${pulse.name}] 共振OFF — スキップ`)
          return
        }

        fetchedData = await fetchSource(pulse.source)
        if (fetchedData === null) return

        // 重複検出: 前回と同じ内容ならスキップ
        const hash = createHash("md5").update(fetchedData).digest("hex")
        if (hash === hashMap.get(pulse.name)) {
          log.info(`[PULSE:${pulse.name}] 変更なし — スキップ`)
          return
        }
        hashMap.set(pulse.name, hash)
      }

      // 2. Roblox表示（target + template設定時、プログラム的表示）
      if (pulse.target && pulse.template && fetchedData) {
        const rendered = renderData(pulse.template, fetchedData)
        await sendToRobloxDisplay(pulse.target, rendered, pulse.title)
        log.info(`[PULSE:${pulse.name}] Roblox表示更新: ${pulse.target}`)
      }

      // 3. AI送信（instructions設定時）
      if (pulse.instructions) {
        // AI入力を構築
        let aiInput = pulse.instructions

        // X チャネル: 直近投稿履歴を注入（重複防止）
        if (channel === "x") {
          aiInput = injectXHistory(aiInput, deps)
        }

        // データを添付
        if (fetchedData) {
          aiInput = `${aiInput}\n\n# データ\n${fetchedData}`
        }

        // OKプレフィックス（パルス名から生成）
        const okPrefix = `${pulse.name.toUpperCase()}_OK`
        aiInput = `${aiInput}\n\n${okPrefix}と返答すれば対応不要を意味する。`

        const result = await deps.sendMessage(
          aiInput,
          "pulse",
          channel,
          pulse.tools ? { toolNames: pulse.tools } : undefined,
        )

        // 応答処理
        if (result.text.startsWith(okPrefix)) {
          log.info(`[PULSE:${pulse.name}] 対応不要`)
        } else if (channel === "x") {
          // Xチャネル: x_post/x_reply使用時のみストリーム出力
          if (result.toolCalls.some((tc) => tc.name === "x_post" || tc.name === "x_reply")) {
            log.info(`[PULSE:${pulse.name}] 応答: ${result.text.substring(0, 100)}`)
            deps.emitStreamItem("ai", result.text, correlationId, "pulse", channel, result.toolCalls, result.displayText)
            deps.publishXToolResults(result.toolCalls)
          } else {
            log.info(`[PULSE:${pulse.name}] x_post未使用の応答を抑制: ${result.text.substring(0, 100)}`)
          }
        } else {
          // 通常チャネル: 常にストリーム出力
          log.info(`[PULSE:${pulse.name}] 応答: ${result.text.substring(0, 100)}`)
          deps.emitStreamItem("ai", result.text, correlationId, "pulse", channel, result.toolCalls, result.displayText)
          deps.publishXToolResults(result.toolCalls)
        }
      }
    } catch (err) {
      log.error(`[PULSE:${pulse.name}] エラー: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      busyMap.set(pulse.name, false)
    }
  })
}

// --- 公開API ---

// 全パルスのcronスケジュールを開始する
export function startPulses(deps: PulseRunnerDeps): void {
  const config = getConfig()
  const pulseDir = config.pulseDir
  const pulses = loadPulses(pulseDir)

  if (pulses.length === 0) {
    log.info(`[PULSE] pulse/ディレクトリなし、またはパルス定義なし: ${pulseDir}`)
    return
  }

  for (const pulse of pulses) {
    const task = cron.schedule(pulse.cron, () => executePulse(pulse, deps), { timezone: "Etc/UTC" })
    cronTasks.push(task)
    log.info(`[PULSE] cron開始: ${pulse.name} (${pulse.cron} UTC)`)
  }

  log.info(`[PULSE] ${pulses.length}件のパルスを登録`)
}

// 全パルスのcronスケジュールを停止する
export function stopPulses(): void {
  for (const task of cronTasks) {
    task.stop()
  }
  cronTasks.length = 0
  busyMap.clear()
  hashMap.clear()
  log.info("[PULSE] 全パルス停止")
}
