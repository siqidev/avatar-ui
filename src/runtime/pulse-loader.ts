// pulse-loader: pulse/ディレクトリからパルス定義ファイルを読み込み、フロントマターを解析する

import * as fs from "node:fs"
import * as path from "node:path"
import type { ChannelId } from "../shared/channel.js"

// パルス定義（1ファイル = 1パルス）
export type PulseDefinition = {
  name: string           // ファイル名（拡張子なし）
  cron: string           // cron式（UTC）
  source?: string        // データ取得URL
  target?: string        // Roblox表示先オブジェクト名
  title?: string         // 表示タイトル
  template?: string      // テンプレート文字列（{field}で展開）
  channel?: ChannelId    // 配信チャネル（デフォルト: console）
  tools?: string[]       // AIに許可するツールリスト
  instructions: string   // マークダウン本文（AI指示。空文字列 = AI不使用）
}

// フロントマター解析結果
type ParsedFrontmatter = {
  meta: Record<string, string | string[]>
  body: string
}

// --- フロントマター解析（最小限の実装、YAML依存なし） ---

// フロントマターを解析する（--- で囲まれたメタデータ + 本文）
function parseFrontmatter(content: string): ParsedFrontmatter {
  const lines = content.split("\n")

  // 先頭が --- でなければフロントマターなし
  if (lines[0]?.trim() !== "---") {
    return { meta: {}, body: content.trim() }
  }

  // 閉じ --- を探す
  let endIndex = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      endIndex = i
      break
    }
  }

  if (endIndex === -1) {
    return { meta: {}, body: content.trim() }
  }

  const metaLines = lines.slice(1, endIndex)
  const body = lines.slice(endIndex + 1).join("\n").trim()

  const meta: Record<string, string | string[]> = {}
  for (const line of metaLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const colonIndex = trimmed.indexOf(":")
    if (colonIndex === -1) continue

    const key = trimmed.substring(0, colonIndex).trim()
    let value = trimmed.substring(colonIndex + 1).trim()

    // 配列: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.substring(1, value.length - 1)
      meta[key] = inner.split(",").map((s) => stripQuotes(s.trim())).filter(Boolean)
      continue
    }

    // クォート除去
    meta[key] = stripQuotes(value)
  }

  return { meta, body }
}

// クォート（"..." または '...'）を除去する
function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.substring(1, s.length - 1)
  }
  return s
}

// --- パルス定義の検証 ---

const VALID_CHANNELS: readonly string[] = ["console", "roblox", "x", "discord"]

function validatePulse(name: string, meta: Record<string, string | string[]>, body: string): PulseDefinition {
  const cron = meta.cron
  if (typeof cron !== "string" || !cron) {
    throw new Error(`pulse/${name}.md: cron が未指定です`)
  }

  const channel = meta.channel
  if (channel !== undefined) {
    if (typeof channel !== "string" || !VALID_CHANNELS.includes(channel)) {
      throw new Error(`pulse/${name}.md: channel が不正です: ${String(channel)}`)
    }
  }

  const tools = meta.tools
  if (tools !== undefined && !Array.isArray(tools)) {
    throw new Error(`pulse/${name}.md: tools は配列で指定してください`)
  }

  return {
    name,
    cron,
    source: typeof meta.source === "string" ? meta.source : undefined,
    target: typeof meta.target === "string" ? meta.target : undefined,
    title: typeof meta.title === "string" ? meta.title : undefined,
    template: typeof meta.template === "string" ? meta.template : undefined,
    channel: (channel as ChannelId) ?? undefined,
    tools: Array.isArray(tools) ? tools : undefined,
    instructions: body,
  }
}

// --- ディレクトリ読み込み ---

// pulse/ディレクトリから全パルス定義を読み込む
// ディレクトリ不在時は空配列を返す（パルスなし = 正常）
export function loadPulses(pulseDir: string): PulseDefinition[] {
  if (!fs.existsSync(pulseDir)) {
    return []
  }

  const files = fs.readdirSync(pulseDir)
    .filter((f) => f.endsWith(".md"))
    .sort()

  const pulses: PulseDefinition[] = []

  for (const file of files) {
    const filePath = path.join(pulseDir, file)
    const content = fs.readFileSync(filePath, "utf-8")
    const name = file.replace(/\.md$/, "")
    const { meta, body } = parseFrontmatter(content)
    // cron必須チェック — なければスキップではなくfail-fast
    const pulse = validatePulse(name, meta, body)
    pulses.push(pulse)
  }

  return pulses
}
