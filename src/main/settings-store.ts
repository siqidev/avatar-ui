// 設定ストア: ユーザー嗜好の永続化（data/settings.json）
// Mainプロセスが正本。Rendererへの反映はIPC経由。
// デフォルト値はここにハードコード（.envには持たない）

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Locale } from "../shared/i18n.js"

export type Theme = "modern" | "classic"

export type Settings = {
  theme: Theme
  model: string
  locale: Locale
  resonance: boolean
}

// モデルカタログ（正本）: メニュー・バリデーション・設定復元すべてここを参照
// grok-4ファミリーのみ（file_search/store等のサーバーサイド機能はgrok-4のみ対応）
export const MODEL_CATALOG = [
  "grok-4-1-fast-reasoning",
  "grok-4-1-fast-non-reasoning",
] as const

export type ModelId = (typeof MODEL_CATALOG)[number]

// デフォルト設定（ハードコード。.envからは取らない）
const DEFAULT_MODEL: ModelId = "grok-4-1-fast-non-reasoning"

const DEFAULTS: Settings = {
  theme: "modern",
  model: DEFAULT_MODEL,
  locale: "ja",
  resonance: false,
}

function isValidModel(v: unknown): v is ModelId {
  return typeof v === "string" && MODEL_CATALOG.includes(v as ModelId)
}

function isValidLocale(v: unknown): v is Locale {
  return v === "ja" || v === "en"
}

let settings: Settings | null = null
let settingsPath: string

/** 起動時に1回呼ぶ。dataDir = "data" 等 */
export function loadSettings(dataDir: string): Settings {
  settingsPath = join(dataDir, "settings.json")

  try {
    const raw = readFileSync(settingsPath, "utf-8")
    const parsed = JSON.parse(raw) as Partial<Settings>
    settings = {
      theme: parsed.theme === "classic" ? "classic" : DEFAULTS.theme,
      model: isValidModel(parsed.model) ? parsed.model : DEFAULTS.model,
      locale: isValidLocale(parsed.locale) ? parsed.locale : DEFAULTS.locale,
      resonance: typeof parsed.resonance === "boolean" ? parsed.resonance : DEFAULTS.resonance,
    }
  } catch (err: unknown) {
    // ファイル未存在は正常（初回起動）、それ以外はfail-fast
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      settings = { ...DEFAULTS }
    } else {
      throw err
    }
  }
  return settings
}

export function getSettings(): Settings {
  if (!settings) throw new Error("settings-store: loadSettings() が未呼び出し")
  return settings
}

export function updateSettings(partial: Partial<Settings>): Settings {
  if (!settings) throw new Error("settings-store: loadSettings() が未呼び出し")
  settings = { ...settings, ...partial }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  return settings
}
