import type { Env } from "../config.js"

// MessagingServiceトピック名（プロトコル定数、Roblox側CommandReceiverと一致）
const MESSAGE_TOPIC = "AICommands"

import {
  type IntentRecord,
  readIntentsByStatus,
  updateIntentStatus,
} from "./intent-log.js"
import { publishMessage } from "./roblox-messaging.js"
import * as log from "../logger.js"

// npc_motion ops の user_id を送信前に検証・正規化する（システム境界の防波堤）
function validateNpcMotionOps(ops: unknown[]): void {
  for (const op of ops) {
    const o = op as Record<string, unknown>
    if (o.user_id !== undefined) {
      if (typeof o.user_id === "number") continue
      if (typeof o.user_id === "string") {
        const num = Number(o.user_id)
        if (!Number.isNaN(num) && Number.isFinite(num)) {
          o.user_id = num // 数値文字列はnumberに変換
          continue
        }
        // 非数値文字列 = AIがユーザー名を送信している → fail-fast
        throw new Error(
          `[PROJECTOR] npc_motion user_id に非数値文字列: "${o.user_id}" — AIがUserId(数値)ではなくユーザー名を送信している`,
        )
      }
      throw new Error(
        `[PROJECTOR] npc_motion user_id の型が不正: ${typeof o.user_id}`,
      )
    }
  }
}

// 単一の意図をRobloxに投影する（送信 + ステータス更新）
// v3: schema_version + intent_idを付与してACK閉ループを可能にする
export async function projectIntent(
  intent: IntentRecord,
  env: Env,
): Promise<boolean> {
  // npc_motion の user_id を送信前に検証
  if (intent.category === "npc_motion") {
    validateNpcMotionOps(intent.ops)
  }

  const message = JSON.stringify({
    schema_version: "3",
    intent_id: intent.id,
    category: intent.category,
    ops: intent.ops,
  })

  log.info(
    `[PROJECTOR] 送信: ${intent.id} category=${intent.category} ops=${intent.ops.length}件`,
  )

  const result = await publishMessage(
    env.ROBLOX_API_KEY!,
    env.ROBLOX_UNIVERSE_ID!,
    MESSAGE_TOPIC,
    message,
  )

  if (result.success) {
    updateIntentStatus(intent.id, "sent")
    log.info(`[PROJECTOR] 送信成功: ${intent.id}`)
    return true
  }

  const errMsg = `${result.error.code} - ${result.error.message}`
  updateIntentStatus(intent.id, "failed", errMsg)
  log.error(`[PROJECTOR] 送信失敗: ${intent.id} - ${errMsg}`)
  return false
}

// 未送信（pending）の意図を全て投影する（起動時のリトライ用）
export async function projectPendingIntents(env: Env): Promise<number> {
  const result = readIntentsByStatus("pending")
  if (!result.success) {
    log.error(
      `[PROJECTOR] pending読み込み失敗: ${result.error.message}`,
    )
    return 0
  }

  const pending = result.data
  if (pending.length === 0) return 0

  log.info(`[PROJECTOR] 未送信の意図: ${pending.length}件`)

  let sent = 0
  for (const intent of pending) {
    const success = await projectIntent(intent, env)
    if (success) sent++
  }

  log.info(`[PROJECTOR] リトライ完了: ${sent}/${pending.length}件送信`)
  return sent
}
