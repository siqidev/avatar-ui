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
  const expanded = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = data[key]
    if (value === undefined || value === null) return ""
    return String(value)
  })
  // フロントマターから読んだ \n をリアル改行に変換
  return expanded.replace(/\\n/g, "\n")
}

// --- 派生値計算（_プレフィックス付きプレースホルダ） ---

// 形状ASCIIアート辞書
const SHAPE_ART: Record<string, string> = {
  disc:       "  ╭──────╮\n  │      │\n  ╰──────╯",
  disk:       "  ╭──────╮\n  │      │\n  ╰──────╯",
  triangle:   "     ╱╲\n   ╱    ╲\n  ╱──────╲",
  sphere:     "    ╭──╮\n   ╭╯  ╰╮\n   ╰╮  ╭╯\n    ╰──╯",
  doughnut:   "  ╭──────╮\n  │  ╭╮  │\n  │  ╰╯  │\n  ╰──────╯",
  cigar:      "  ╭──────────╮\n  │          │\n  ╰──────────╯",
  chevron:    "    ╲    ╱\n     ╲  ╱\n      ╲╱\n      ╱╲",
  diamond:    "      ╱╲\n    ╱    ╲\n    ╲    ╱\n      ╲╱",
  rectangle:  "  ┌────────┐\n  │        │\n  │        │\n  └────────┘",
  cylinder:   "  ╭──────╮\n  │      │\n  │      │\n  ╰──────╯",
  oval:       "   ╭────╮\n  ╭╯    ╰╮\n  ╰╮    ╭╯\n   ╰────╯",
  light:      "      ✦\n    ╱   ╲\n   ╱     ╲",
  star:       "      ✦\n    ╱ │ ╲\n   ╱  │  ╲",
  fireball:   "    ╭──╮\n   ╭╯∞∞╰╮\n   ╰╮∞∞╭╯\n    ╰──╯",
  cross:      "     │\n  ───┼───\n     │",
  unknown:    "      ?\n    ╱   ╲\n    ╲   ╱\n      ?",
}

// テキストから数値を抽出する（"500 meters" → 500）
function parseNumeric(text: unknown): number | null {
  if (typeof text !== "string") return null
  const m = text.match(/[\d.]+/)
  return m ? Number(m[0]) : null
}

// 数値をバーグラフに変換（maxに対する比率で描画）
function toBar(value: number | null, max: number, width: number = 10): string {
  if (value === null) return "-".repeat(width)
  const filled = Math.min(Math.round((value / max) * width), width)
  return "=".repeat(filled) + "-".repeat(width - filled)
}

// 緯度経度からミニマップを生成（7x5グリッド）
function toMinimap(lat: unknown, lon: unknown): string {
  const la = typeof lat === "number" ? lat : null
  const lo = typeof lon === "number" ? lon : null
  if (la === null || lo === null) return ""

  // 緯度 -90〜90 → 行 0〜4、経度 -180〜180 → 列 0〜6
  const row = Math.min(4, Math.max(0, Math.round((1 - (la + 90) / 180) * 4)))
  const col = Math.min(6, Math.max(0, Math.round(((lo + 180) / 360) * 6)))

  const lines: string[] = []
  for (let r = 0; r < 5; r++) {
    let line = ""
    for (let c = 0; c < 7; c++) {
      line += (r === row && c === col) ? " ◉" : " ○"
    }
    lines.push(line.substring(1))
  }
  return lines.join("\n")
}

// データオブジェクトに派生値を注入する
function injectDerivedValues(data: Record<string, unknown>): void {
  // _shape_art: 形状ASCIIアート
  const shape = String(data.shape ?? "unknown").toLowerCase()
  data._shape_art = SHAPE_ART[shape] ?? SHAPE_ART.unknown

  // _alt_bar: 高度バーグラフ（max 10000m）
  data._alt_bar = toBar(parseNumeric(data.altitude), 10000)

  // _dist_bar: 距離バーグラフ（max 5000m）
  data._dist_bar = toBar(parseNumeric(data.distance), 5000)

  // _dur_bar: 持続時間バーグラフ（max 60min）
  data._dur_bar = toBar(parseNumeric(data.duration), 60)

  // _minimap: 座標ミニマップ
  data._minimap = toMinimap(data.latitude, data.longitude)

  // _date: 日時（created or occurred タイムスタンプ → UTC文字列）
  const ts = typeof data.occurred === "number" ? data.occurred
    : typeof data.created === "number" ? data.created : null
  if (ts !== null) {
    const d = new Date(ts as number)
    data._date = d.toISOString().replace("T", " ").substring(0, 16) + " UTC"
  } else {
    data._date = ""
  }

  // _coords: 座標テキスト
  if (typeof data.latitude === "number" && typeof data.longitude === "number") {
    const la = data.latitude as number
    const lo = data.longitude as number
    data._coords = `${Math.abs(la).toFixed(1)}°${la >= 0 ? "N" : "S"}  ${Math.abs(lo).toFixed(1)}°${lo >= 0 ? "E" : "W"}`
  } else {
    data._coords = ""
  }
}

// JSONレスポンスをテンプレートで整形する（配列なら先頭5件）
function renderData(template: string, body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown
    if (Array.isArray(parsed)) {
      const items = parsed.slice(0, 5) as Record<string, unknown>[]
      return items.map((item) => {
        injectDerivedValues(item)
        return renderTemplate(template, item)
      }).join("\n")
    }
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>
      injectDerivedValues(obj)
      return renderTemplate(template, obj)
    }
    return body
  } catch {
    // JSONでなければ生データを返す
    return body
  }
}

// --- 最新表示状態（Roblox起動時pull用） ---

export type DisplayState = {
  target: string
  title: string
  text: string
  updatedAt: string
}

const latestDisplayMap = new Map<string, DisplayState>()

// 全ターゲットの最新表示状態を返す（observation-serverから呼ばれる）
export function getLatestDisplays(): DisplayState[] {
  return [...latestDisplayMap.values()]
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

  // 最新表示状態を保持（Roblox起動時のpull用）
  latestDisplayMap.set(target, {
    target,
    title: title ?? "",
    text,
    updatedAt: new Date().toISOString(),
  })
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
      }

      // 2. Roblox表示（target + template設定時、毎回実行）
      if (pulse.target && pulse.template && fetchedData) {
        const rendered = renderData(pulse.template, fetchedData)
        await sendToRobloxDisplay(pulse.target, rendered, pulse.title)
        log.info(`[PULSE:${pulse.name}] Roblox表示更新: ${pulse.target}`)
      }

      // 3. 重複検出（AI送信のみスキップ。Roblox表示は毎回行う）
      let dataChanged = true
      if (fetchedData) {
        const hash = createHash("md5").update(fetchedData).digest("hex")
        dataChanged = hash !== hashMap.get(pulse.name)
        hashMap.set(pulse.name, hash)
      }

      // 4. AI送信（instructions設定時、データ変更時のみ）
      if (pulse.instructions && dataChanged) {
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

// 起動時にデータフィード系パルスの初回表示を実行する（AI送信なし、表示のみ）
async function initialDisplay(pulse: PulseDefinition): Promise<void> {
  if (!pulse.source || !pulse.target || !pulse.template) return

  try {
    const data = await fetchSource(pulse.source)
    if (data === null) return

    hashMap.set(pulse.name, createHash("md5").update(data).digest("hex"))
    const rendered = renderData(pulse.template, data)
    await sendToRobloxDisplay(pulse.target, rendered, pulse.title)
    log.info(`[PULSE:${pulse.name}] 初回表示完了: ${pulse.target}`)
  } catch (err) {
    log.error(`[PULSE:${pulse.name}] 初回表示エラー: ${err instanceof Error ? err.message : String(err)}`)
  }
}

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

    // データフィード系は起動後に初回表示（Robloxサーバーの受信準備を待つ）
    setTimeout(() => initialDisplay(pulse), 30_000)
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
  // latestDisplayMapはクリアしない（VPS再起動前のスナップショットを保持）
  log.info("[PULSE] 全パルス停止")
}
