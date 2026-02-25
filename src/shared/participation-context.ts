import type { Actor, Source } from "./ipc-schema.js"

// 参与入力: 全起点共通の構造化された入力
// ③参与文脈の最小実装（議論合意 2026-02-25）
export type ParticipationInput = {
  actor: Actor
  source: Source
  correlationId: string
  text: string
  timestamp: string
}

// source別のcorrelationIdを生成する
// user=UUID, pulse/observation=プレフィックス+タイムスタンプ
export function generateCorrelationId(source: Source): string {
  switch (source) {
    case "user":
      return crypto.randomUUID()
    case "pulse":
      return `pulse-${Date.now()}`
    case "observation":
      return `obs-${Date.now()}`
  }
}

// ParticipationInputを生成する
export function createParticipationInput(
  actor: Actor,
  source: Source,
  text: string,
): ParticipationInput {
  return {
    actor,
    source,
    correlationId: generateCorrelationId(source),
    text,
    timestamp: new Date().toISOString(),
  }
}
