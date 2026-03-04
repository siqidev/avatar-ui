import type { FieldState, FieldEvent } from "../shared/ipc-schema.js"

// 場のライフサイクルFSM（純関数）
//
// 遷移図:
//   generated --attach-->  active
//   active    --detach-->  paused
//   paused    --attach-->  resumed (→ activeと同等に振る舞う)
//   resumed   --detach-->  paused
//   active    --terminate--> terminated
//   paused    --terminate--> terminated
//   resumed   --terminate--> terminated
//   terminated + any --> throw（不可逆）

type TransitionTable = Record<FieldState, Partial<Record<FieldEvent, FieldState>>>

const transitions: TransitionTable = {
  generated: {
    attach: "active",
  },
  active: {
    detach: "paused",
    terminate: "terminated",
  },
  paused: {
    attach: "resumed",
    terminate: "terminated",
  },
  resumed: {
    detach: "paused",
    terminate: "terminated",
  },
  terminated: {
    // 不可逆: 全イベント拒否
  },
}

// 状態遷移を実行する。不正な遷移は即throw（fail-fast）
export function transition(current: FieldState, event: FieldEvent): FieldState {
  const next = transitions[current]?.[event]
  if (!next) {
    throw new Error(
      `不正な状態遷移: ${current} + ${event}（許可された遷移なし）`,
    )
  }
  return next
}

// 初期状態
export function initialState(): FieldState {
  return "generated"
}

// activeとして振る舞える状態か（active | resumed）
export function isActive(state: FieldState): boolean {
  return state === "active" || state === "resumed"
}
