// レイアウト管理: 3列可変長配置 + ペイン入替

export const GRID_SLOTS = [
  "avatar",
  "space",
  "canvas",
  "x",
  "stream",
  "terminal",
  "roblox",
] as const

export type GridSlot = (typeof GRID_SLOTS)[number]

// レイアウト = 列の配列、各列はペインIDの配列
// 列構造は 2/3/2 固定（左列2ペイン、中央列3ペイン、右列2ペイン）
// swapで任意のペイン同士が位置交換可能
export type Layout = GridSlot[][]

// デフォルト配置
// 左列:   Avatar / Space
// 中央列: Canvas / X / Roblox
// 右列:   Stream / Terminal
export const DEFAULT_LAYOUT: Layout = [
  ["avatar", "space"],
  ["canvas", "x", "roblox"],
  ["stream", "terminal"],
]

// 全7ペインが1回ずつ存在するか検証
export function validateLayout(layout: Layout): boolean {
  const flat = layout.flat()
  if (flat.length !== GRID_SLOTS.length) return false
  const set = new Set(flat)
  if (set.size !== GRID_SLOTS.length) return false
  for (const slot of GRID_SLOTS) {
    if (!set.has(slot)) return false
  }
  return true
}

// 2ペインの位置を入れ替える（immutable）
export function swapPanes(
  layout: Layout,
  a: GridSlot,
  b: GridSlot,
): Layout {
  if (a === b) return layout

  return layout.map((col) =>
    col.map((slot) => {
      if (slot === a) return b
      if (slot === b) return a
      return slot
    }),
  )
}
