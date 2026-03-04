import * as fs from "node:fs"
import * as crypto from "node:crypto"
import { z } from "zod/v4"
import { getConfig } from "../config.js"
import { type AppResult, ok, fail } from "../types/result.js"

// Intent記録スキーマ（場が正本として保持する意図の記録）
export const intentRecordSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  category: z.string(),
  ops: z.array(z.record(z.string(), z.unknown())),
  reason: z.string(),
  status: z.enum(["pending", "sent", "failed"]),
  sentAt: z.string().optional(),
  error: z.string().optional(),
})

export type IntentRecord = z.infer<typeof intentRecordSchema>

// 意図の入力（ID/timestamp/status付与前）
export interface IntentInput {
  category: string
  ops: Record<string, unknown>[]
  reason: string
}

// 意図をpendingとして記録する
export function appendIntent(input: IntentInput): AppResult<IntentRecord> {
  try {
    fs.mkdirSync(getConfig().dataDir, { recursive: true })

    const record: IntentRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      category: input.category,
      ops: input.ops,
      reason: input.reason,
      status: "pending",
    }

    fs.appendFileSync(
      getConfig().intentLogFile,
      JSON.stringify(record) + "\n",
      "utf-8",
    )
    return ok(record)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail("INTENT_WRITE_FAILED", `意図の記録に失敗: ${msg}`)
  }
}

// 指定ステータスの意図を全て読み出す
export function readIntentsByStatus(
  status: IntentRecord["status"],
): AppResult<IntentRecord[]> {
  try {
    if (!fs.existsSync(getConfig().intentLogFile)) {
      return ok([])
    }
    const content = fs.readFileSync(getConfig().intentLogFile, "utf-8")
    const lines = content.trim().split("\n").filter(Boolean)

    const records: IntentRecord[] = []
    for (const line of lines) {
      const parsed = intentRecordSchema.safeParse(JSON.parse(line))
      if (parsed.success && parsed.data.status === status) {
        records.push(parsed.data)
      }
    }
    return ok(records)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail("INTENT_READ_FAILED", `意図の読み込みに失敗: ${msg}`)
  }
}

// 意図のステータスを更新する（ファイル書き換え）
export function updateIntentStatus(
  intentId: string,
  status: "sent" | "failed",
  error?: string,
): AppResult<void> {
  try {
    if (!fs.existsSync(getConfig().intentLogFile)) {
      return fail("INTENT_NOT_FOUND", `IntentLogが存在しません`)
    }

    const content = fs.readFileSync(getConfig().intentLogFile, "utf-8")
    const lines = content.trim().split("\n").filter(Boolean)

    const updated = lines.map((line) => {
      const record = JSON.parse(line) as Record<string, unknown>
      if (record.id === intentId) {
        record.status = status
        record.sentAt = new Date().toISOString()
        if (error) record.error = error
      }
      return JSON.stringify(record)
    })

    fs.writeFileSync(
      getConfig().intentLogFile,
      updated.join("\n") + "\n",
      "utf-8",
    )
    return ok(undefined)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail("INTENT_UPDATE_FAILED", `意図の更新に失敗: ${msg}`)
  }
}
