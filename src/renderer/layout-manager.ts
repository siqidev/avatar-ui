// レイアウト計算: 3列の幅計算・リサイズ制約・縮退判定
// 合意仕様: 24/52/24比率、制約20-60-20、最小1280x800

export const DEFAULT_RATIOS: [number, number, number] = [0.24, 0.52, 0.24]
export const MIN_WINDOW_WIDTH = 1280
export const MIN_WINDOW_HEIGHT = 800

// スプリッター幅（2本 × 4px）
const SPLITTER_TOTAL = 8

// 比率制約
const MIN_SIDE = 0.20   // left/rightの最小
const MIN_MAIN = 0.40   // mainの最小（42ch確保）
const MAX_MAIN = 0.60   // mainの最大

// 縮退閾値
const THRESHOLD_RIGHT_TABS = 1100  // この幅以下で右列タブ化
const THRESHOLD_FS_DRAWER = 900    // この幅以下でFSドロワー化

export type ColumnLayout = {
  left: number
  main: number
  right: number
}

export type DegradationLevel = "none" | "right-tabs" | "fs-drawer"

// 比率を制約内にクランプする
export function clampRatios(ratios: [number, number, number]): [number, number, number] {
  let [left, main, right] = ratios

  // まず合計を1.0に正規化
  const sum = left + main + right
  if (sum !== 1.0) {
    left = left / sum
    main = main / sum
    right = right / sum
  }

  // left/right最小制約
  if (left < MIN_SIDE) {
    const diff = MIN_SIDE - left
    left = MIN_SIDE
    main -= diff
  }
  if (right < MIN_SIDE) {
    const diff = MIN_SIDE - right
    right = MIN_SIDE
    main -= diff
  }

  // main最小制約
  if (main < MIN_MAIN) {
    const deficit = MIN_MAIN - main
    main = MIN_MAIN
    // 不足分をleft/rightから均等に削る
    const halfDeficit = deficit / 2
    left -= halfDeficit
    right -= halfDeficit
    // 削りすぎた場合のフォールバック
    if (left < MIN_SIDE) {
      right -= (MIN_SIDE - left)
      left = MIN_SIDE
    }
    if (right < MIN_SIDE) {
      left -= (MIN_SIDE - right)
      right = MIN_SIDE
    }
  }

  // main最大制約
  if (main > MAX_MAIN) {
    const excess = main - MAX_MAIN
    main = MAX_MAIN
    // 超過分をleft/rightに均等配分
    left += excess / 2
    right += excess / 2
  }

  return [left, main, right]
}

// 総幅から3列のpx幅を計算する
export function calculateColumns(
  totalWidth: number,
  ratios?: [number, number, number],
): ColumnLayout {
  const clamped = clampRatios(ratios ?? DEFAULT_RATIOS)
  const effective = totalWidth - SPLITTER_TOTAL

  const left = Math.round(effective * clamped[0])
  const right = Math.round(effective * clamped[2])
  // main列で丸め誤差を吸収（合計が実効幅と一致するよう保証）
  const main = effective - left - right

  return { left, main, right }
}

// 幅・高さに応じた縮退レベルを判定する
export function getDegradation(width: number, height: number): DegradationLevel {
  void height // 現在は幅のみで判定（高さベースの縮退は将来拡張）
  if (width < THRESHOLD_FS_DRAWER) return "fs-drawer"
  if (width < THRESHOLD_RIGHT_TABS) return "right-tabs"
  return "none"
}
