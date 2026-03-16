// X Webhookイベントの AI転送判定
// Robloxの observation-forwarding-policy.ts と同じパターン

import type { XEvent } from "./x-event-formatter.js"

// XイベントをAIに転送するかどうか判定する
export function shouldForwardXEventToAI(event: XEvent): boolean {
  switch (event.type) {
    case "x_mention":
      // メンション: 常にAIに転送（返信判断のため）
      return true
    default:
      return false
  }
}
