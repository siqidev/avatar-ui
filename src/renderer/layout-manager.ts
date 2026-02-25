// レイアウト管理: 2×3グリッド配置 + ペイン入替

export const GRID_SLOTS = [
  "fs",
  "chat",
  "avatar",
  "x",
  "terminal",
  "roblox",
] as const

export type GridSlot = (typeof GRID_SLOTS)[number]

// デフォルト配置（スクリーンショット準拠）
// 上段: FS / Chat / Avatar
// 下段: X  / Terminal / Roblox
export const DEFAULT_LAYOUT: GridSlot[][] = [
  ["fs", "chat", "avatar"],
  ["x", "terminal", "roblox"],
]

// 配置からgrid-template-areas CSS文字列を生成
// 5列×3行（列2,4=verticalスプリッター、行2=horizontalスプリッター）
export function buildGridAreas(layout: GridSlot[][]): string {
  const top = layout[0]
  const bottom = layout[1]
  return [
    `"${top[0]} . ${top[1]} . ${top[2]}"`,
    `". . . . ."`,
    `"${bottom[0]} . ${bottom[1]} . ${bottom[2]}"`,
  ].join(" ")
}

// 2ペインの位置を入れ替える（immutable）
export function swapPanes(
  layout: GridSlot[][],
  a: GridSlot,
  b: GridSlot,
): GridSlot[][] {
  if (a === b) return layout

  return layout.map((row) =>
    row.map((slot) => {
      if (slot === a) return b
      if (slot === b) return a
      return slot
    }),
  )
}
