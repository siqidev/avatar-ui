// Canvas focus stack: 純粋関数でファイル/画像の昇格・復帰を管理
// 起点対称性: actor/originは遷移規則に影響しない（メタデータのみ）

export type CanvasActor = "human" | "ai"
export type CanvasOrigin = "space" | "stream"

type BaseFocusItem = {
  actor: CanvasActor
  origin: CanvasOrigin
  focusedAt: number
}

export type CanvasFileFocusItem = BaseFocusItem & {
  kind: "file"
  path: string
  content: string
}

export type CanvasImageFocusItem = BaseFocusItem & {
  kind: "image"
  imageUrl: string
  alt: string
}

export type CanvasFocusItem = CanvasFileFocusItem | CanvasImageFocusItem

export type CanvasFocusState = {
  current: CanvasFocusItem | null
  history: CanvasFocusItem[]
  maxDepth: number
}

/** 空のfocus stateを生成 */
export function createCanvasFocusState(maxDepth = 20): CanvasFocusState {
  return { current: null, history: [], maxDepth }
}

/** 同一ターゲットか判定（kind+識別子で比較） */
function isSameTarget(a: CanvasFocusItem, b: CanvasFocusItem): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === "file" && b.kind === "file") return a.path === b.path
  if (a.kind === "image" && b.kind === "image") return a.imageUrl === b.imageUrl
  return false
}

/** 新しいアイテムを昇格（push）。同一ターゲット連続時は履歴を増やさずcurrentを更新 */
export function pushFocus(
  state: CanvasFocusState,
  next: CanvasFocusItem,
): CanvasFocusState {
  // 同一ターゲット連続: currentを置換するだけ
  if (state.current && isSameTarget(state.current, next)) {
    return { ...state, current: next }
  }

  const history = state.current
    ? [...state.history, state.current].slice(-state.maxDepth)
    : [...state.history]

  return { ...state, current: next, history }
}

/** 直前のアイテムに復帰（pop） */
export function popFocus(state: CanvasFocusState): CanvasFocusState {
  if (state.history.length === 0) {
    return { ...state, current: null }
  }
  const history = [...state.history]
  const prev = history.pop()!
  return { ...state, current: prev, history }
}

/** 復帰可能か */
export function canPopFocus(state: CanvasFocusState): boolean {
  return state.history.length > 0
}
