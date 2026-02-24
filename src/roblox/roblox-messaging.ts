import { type AppResult, ok, fail } from "../types/result.js"
import { APP_CONFIG } from "../config.js"

// Roblox Open Cloud Messaging API V2 でゲームサーバーにメッセージを送信する
export async function publishMessage(
  apiKey: string,
  universeId: string,
  topic: string,
  message: string,
): Promise<AppResult<void>> {
  // メッセージサイズ上限1KB
  if (new TextEncoder().encode(message).length > 1024) {
    return fail("MESSAGE_TOO_LARGE", "メッセージが1KBを超えています")
  }

  const url = `${APP_CONFIG.robloxOpenCloudBaseUrl}/universes/${universeId}:publishMessage`

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ topic, message }),
    })

    if (!resp.ok) {
      const body = await resp.text()
      return fail(
        "ROBLOX_PUBLISH_FAILED",
        `Robloxメッセージ送信失敗 (${resp.status}): ${body}`,
      )
    }

    return ok(undefined)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail("ROBLOX_PUBLISH_FAILED", `Robloxメッセージ送信失敗: ${msg}`)
  }
}
