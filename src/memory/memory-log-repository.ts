import * as fs from "node:fs"
import { APP_CONFIG } from "../config.js"
import { type MemoryRecord, memoryRecordSchema } from "./memory-record.js"
import { type AppResult, ok, fail } from "../types/result.js"

// memory.jsonlに1件追記する
export function appendMemory(record: MemoryRecord): AppResult<void> {
  try {
    fs.mkdirSync(APP_CONFIG.dataDir, { recursive: true })
    const line = JSON.stringify(record) + "\n"
    fs.appendFileSync(APP_CONFIG.memoryFile, line, "utf-8")
    return ok(undefined)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail("MEMORY_WRITE_FAILED", `記憶の書き込みに失敗: ${msg}`)
  }
}

// memory.jsonlから直近N件を読み込む（障害時fallback用）
export function readRecentMemories(n: number): AppResult<MemoryRecord[]> {
  try {
    if (!fs.existsSync(APP_CONFIG.memoryFile)) {
      return ok([])
    }
    const content = fs.readFileSync(APP_CONFIG.memoryFile, "utf-8")
    const lines = content.trim().split("\n").filter(Boolean)

    const records: MemoryRecord[] = []
    for (const line of lines) {
      const parsed = memoryRecordSchema.safeParse(JSON.parse(line))
      if (parsed.success) {
        records.push(parsed.data)
      }
    }

    // 直近N件を返す
    return ok(records.slice(-n))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail("MEMORY_READ_FAILED", `記憶の読み込みに失敗: ${msg}`)
  }
}

// 指定IDより後の未同期レコードを取得する
export function readMemoriesAfter(
  cursorId: string | null,
): AppResult<MemoryRecord[]> {
  try {
    if (!fs.existsSync(APP_CONFIG.memoryFile)) {
      return ok([])
    }
    const content = fs.readFileSync(APP_CONFIG.memoryFile, "utf-8")
    const lines = content.trim().split("\n").filter(Boolean)

    const records: MemoryRecord[] = []
    let found = cursorId === null // nullなら最初から全件
    for (const line of lines) {
      const parsed = memoryRecordSchema.safeParse(JSON.parse(line))
      if (!parsed.success) continue
      if (found) {
        records.push(parsed.data)
      } else if (parsed.data.id === cursorId) {
        found = true
      }
    }
    return ok(records)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail("MEMORY_READ_FAILED", `記憶の読み込みに失敗: ${msg}`)
  }
}

// memory.jsonlのバックアップを作成する
export function backupMemoryLog(): AppResult<void> {
  try {
    if (!fs.existsSync(APP_CONFIG.memoryFile)) {
      return ok(undefined)
    }
    fs.copyFileSync(APP_CONFIG.memoryFile, `${APP_CONFIG.memoryFile}.bak`)
    return ok(undefined)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail("MEMORY_BACKUP_FAILED", `バックアップに失敗: ${msg}`)
  }
}
