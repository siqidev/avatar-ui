// 状態正規化器: IPC入力 → ペインの視覚状態を決定する純粋関数
// 優先度: integrity.alert > field.state > stream.reply > focus > normal

export type PaneInput = {
  ipcEvents: Array<{ type: string; [k: string]: unknown }>
  hasFocus: boolean
}

export type VisualState = {
  level: "normal" | "reply" | "active" | "warn" | "critical"
  borderColor: string
  badge: string | null
  showUnreadDot: boolean
  showAlertBar: boolean
}

// 優先度の数値（高い = 優先）
const PRIORITY: Record<string, number> = {
  normal: 0,
  reply: 1,
  active: 2,
  warn: 3,
  critical: 4,
}

// field.stateの値 → 視覚レベルのマッピング
const FIELD_STATE_MAP: Record<string, "normal" | "active" | "warn"> = {
  generated: "normal",
  active: "active",
  resumed: "active",
  paused: "warn",
  terminated: "warn",
}

// 各レベルの視覚プロパティ
const LEVEL_CONFIG: Record<string, Omit<VisualState, "level">> = {
  normal: {
    borderColor: "--line-default",
    badge: null,
    showUnreadDot: false,
    showAlertBar: false,
  },
  reply: {
    borderColor: "--state-info",
    badge: null,
    showUnreadDot: true,
    showAlertBar: false,
  },
  active: {
    borderColor: "--state-info",
    badge: "[RUN]",
    showUnreadDot: false,
    showAlertBar: false,
  },
  warn: {
    borderColor: "--state-warn",
    badge: "[WARN]",
    showUnreadDot: false,
    showAlertBar: false,
  },
  critical: {
    borderColor: "--state-critical",
    badge: "[ALERT]",
    showUnreadDot: false,
    showAlertBar: true,
  },
}

export function normalizeState(input: PaneInput): VisualState {
  let highestLevel = "normal"

  for (const event of input.ipcEvents) {
    let eventLevel: string | undefined

    if (event.type === "integrity.alert") {
      eventLevel = "critical"
    } else if (event.type === "field.state") {
      const state = event.state as string
      eventLevel = FIELD_STATE_MAP[state] ?? "normal"
    } else if (event.type === "stream.reply") {
      eventLevel = "reply"
    }

    if (eventLevel && PRIORITY[eventLevel]! > PRIORITY[highestLevel]!) {
      highestLevel = eventLevel
    }
  }

  const config = LEVEL_CONFIG[highestLevel]!
  const result: VisualState = { level: highestLevel as VisualState["level"], ...config }

  // focusはnormal時のみborderColorに影響（状態色がある場合は上書きしない）
  if (input.hasFocus && highestLevel === "normal") {
    result.borderColor = "--line-focus"
  }

  return result
}
