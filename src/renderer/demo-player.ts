// デモモード: セリフを人間速度でタイプし、AI応答を待って次のセリフに進む
import type { DemoLine } from "../shared/demo-script-schema.js"

export type DemoState = "idle" | "typing" | "waiting" | "delaying"

export interface DemoPlayerDeps {
  inputEl: HTMLInputElement
  sendMessage: (text: string) => string // correlationIdを返す
  onStreamEnd: (cb: (correlationId: string) => void) => void
  offStreamEnd: () => void
}

const CHAR_DELAY_MIN = 60
const CHAR_DELAY_MAX = 120

export class DemoPlayer {
  private state: DemoState = "idle"
  private runId = 0
  private lines: DemoLine[] = []
  private lineIndex = 0
  private deps: DemoPlayerDeps
  private pendingCorrelationId: string | null = null
  private typeTimer: ReturnType<typeof setTimeout> | null = null
  private delayTimer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: DemoPlayerDeps) {
    this.deps = deps
  }

  get isRunning(): boolean {
    return this.state !== "idle"
  }

  async start(lines: DemoLine[]): Promise<void> {
    this.lines = lines
    this.lineIndex = 0
    this.runId++
    this.playLine(this.runId)
  }

  cancel(): void {
    this.runId++
    this.cleanup()
    this.state = "idle"
    this.deps.offStreamEnd()
  }

  private cleanup(): void {
    if (this.typeTimer) { clearTimeout(this.typeTimer); this.typeTimer = null }
    if (this.delayTimer) { clearTimeout(this.delayTimer); this.delayTimer = null }
    this.pendingCorrelationId = null
  }

  private playLine(rid: number): void {
    if (rid !== this.runId) return
    if (this.lineIndex >= this.lines.length) {
      this.cancel()
      return
    }

    const line = this.lines[this.lineIndex]
    this.state = "typing"
    this.typeText(rid, line.msg, 0)
  }

  private typeText(rid: number, text: string, idx: number): void {
    if (rid !== this.runId) return

    if (idx >= text.length) {
      // タイプ完了 → 送信
      this.state = "waiting"
      const correlationId = this.deps.sendMessage(text)
      this.pendingCorrelationId = correlationId

      // AI応答完了を待つ
      this.deps.onStreamEnd((replyCorrelationId) => {
        if (rid !== this.runId) return
        if (replyCorrelationId !== this.pendingCorrelationId) return

        this.deps.offStreamEnd()
        this.pendingCorrelationId = null

        // postDelay待機後に次のセリフへ
        const line = this.lines[this.lineIndex]
        this.state = "delaying"
        this.delayTimer = setTimeout(() => {
          if (rid !== this.runId) return
          this.lineIndex++
          this.playLine(rid)
        }, (line.postDelay ?? 3) * 1000)
      })
      return
    }

    // 1文字ずつ入力欄に追加
    this.deps.inputEl.value += text[idx]
    // input イベント発火（フレームワーク連携用）
    this.deps.inputEl.dispatchEvent(new Event("input", { bubbles: true }))

    const delay = CHAR_DELAY_MIN + Math.random() * (CHAR_DELAY_MAX - CHAR_DELAY_MIN)
    this.typeTimer = setTimeout(() => this.typeText(rid, text, idx + 1), delay)
  }
}
