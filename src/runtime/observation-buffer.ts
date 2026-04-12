// 観測バッファ: evidence-only観測（proximity等）を蓄積し、次のLLMターンで注入する
//
// 目的: proximity等の観測でLLM応答を生成せず、次の明示ターン時に
// 「直前の観測コンテキスト」としてAI入力に合流させる。
// これにより通常時/断裂復旧時の文脈非対称が解消される。

import { t } from "../shared/i18n.js"

interface BufferedObservation {
  formatted: string
  eventType: string
  timestamp: string
}

const buffer: BufferedObservation[] = []

// バッファ上限（古いものから捨てる）
const MAX_BUFFER_SIZE = 20

/** 観測をバッファに追加する */
export function pushObservation(formatted: string, eventType: string, timestamp: string): void {
  if (buffer.length >= MAX_BUFFER_SIZE) {
    buffer.shift()
  }
  buffer.push({ formatted, eventType, timestamp })
}

/**
 * バッファを排出し、AIのinputに注入する文字列を返す。
 * バッファが空なら null を返す。
 */
export function drainObservationContext(): string | null {
  if (buffer.length === 0) return null

  const entries = buffer.splice(0, buffer.length)
  const lines = entries.map((e) => `- ${e.formatted}`)
  return t("obs.bufferContext", lines.join("\n"))
}

/** バッファの現在のサイズ（テスト用） */
export function bufferSize(): number {
  return buffer.length
}

/** バッファをクリアする（テスト用） */
export function clearBuffer(): void {
  buffer.length = 0
}
