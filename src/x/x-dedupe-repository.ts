// X Webhook重複排除: tweet_idをファイル永続化して再送・再起動に耐える

import * as fs from "node:fs"
import { getConfig } from "../config.js"
import * as log from "../logger.js"

const MAX_ENTRIES = 10000
let knownIds: Set<string> | null = null
let filePath: string | null = null

function getFilePath(): string {
  if (!filePath) {
    filePath = `${getConfig().dataDir}/x-seen-tweets.json`
  }
  return filePath
}

// 起動時に既知IDを読み込む
function loadIds(): Set<string> {
  if (knownIds) return knownIds

  const path = getFilePath()
  try {
    const raw = fs.readFileSync(path, "utf-8")
    const ids = JSON.parse(raw) as string[]
    knownIds = new Set(ids)
  } catch {
    knownIds = new Set()
  }
  return knownIds
}

// IDの重複チェック + 登録（trueなら新規、falseなら既知）
export function markSeen(tweetId: string): boolean {
  const ids = loadIds()
  if (ids.has(tweetId)) return false

  ids.add(tweetId)

  // 上限超過時に古いものを削除（Setの挿入順を利用）
  if (ids.size > MAX_ENTRIES) {
    const excess = ids.size - MAX_ENTRIES
    let count = 0
    for (const id of ids) {
      if (count >= excess) break
      ids.delete(id)
      count++
    }
  }

  // 永続化（非同期でもよいが、件数が少ないので同期で十分）
  try {
    fs.writeFileSync(getFilePath(), JSON.stringify([...ids]))
  } catch (err) {
    log.error(`[X_DEDUPE] 保存失敗: ${err instanceof Error ? err.message : String(err)}`)
  }

  return true
}

// テスト用リセット
export function _resetForTest(): void {
  knownIds = null
  filePath = null
}
