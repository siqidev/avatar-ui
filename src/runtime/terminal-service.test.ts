import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  spawnPty,
  write,
  execAiCommand,
  isAiBusy,
  getSnapshot,
  getScrollback,
  setEventSink,
  dispose,
} from "./terminal-service.js"
import type { TerminalToRendererEvent } from "../shared/terminal-schema.js"
import { _resetConfigForTest } from "../config.js"

// テスト用にイベント収集
let events: TerminalToRendererEvent[] = []

beforeEach(() => {
  _resetConfigForTest({ XAI_API_KEY: "test-key" })
  events = []
  setEventSink((e) => events.push(e))
})

afterEach(() => {
  dispose()
})

describe("terminal-service (PTY)", () => {
  it("初期状態: PTY未起動", () => {
    expect(getSnapshot().alive).toBe(false)
    expect(isAiBusy()).toBe(false)
  })

  it("spawnPty: PTYが起動しreadyイベントが発火する", async () => {
    spawnPty()
    await waitForEvent("terminal.state")

    expect(getSnapshot().alive).toBe(true)
    const stateEvents = events.filter((e) => e.type === "terminal.state")
    expect(stateEvents.length).toBeGreaterThanOrEqual(1)
    expect((stateEvents[0] as { state: string }).state).toBe("ready")
  }, 10_000)

  it("execAiCommand: コマンド実行し結果を返す", async () => {
    spawnPty()
    await waitForEvent("terminal.state")

    const result = await execAiCommand("echo hello_pty_test")

    expect(result.exitCode).toBe(0)
    const combined = result.output.join("\n")
    expect(combined).toContain("hello_pty_test")
  }, 10_000)

  it("execAiCommand: 非ゼロ終了コード", async () => {
    spawnPty()
    await waitForEvent("terminal.state")

    // サブシェルで非ゼロ終了（メインシェルは生き続ける）
    const result = await execAiCommand("bash -c 'exit 42'")

    expect(result.exitCode).toBe(42)
  }, 10_000)

  it("TERMINAL_BUSY: AI実行中は二重実行を拒否", async () => {
    spawnPty()
    await waitForEvent("terminal.state")

    // 長いコマンドを開始
    const p1 = execAiCommand("sleep 5")

    await new Promise((r) => setTimeout(r, 100))
    expect(isAiBusy()).toBe(true)

    const result2 = await execAiCommand("echo blocked")
    expect(result2.output).toContain("TERMINAL_BUSY: AI実行中")

    // クリーンアップ
    dispose()
    await p1.catch(() => {})
  }, 10_000)

  it("getScrollback: 出力がスクロールバックに蓄積される", async () => {
    spawnPty()
    await waitForEvent("terminal.state")

    await execAiCommand("echo scrollback_test_line")

    const sb = getScrollback()
    const combined = sb.lines.join("\n")
    expect(combined).toContain("scrollback_test_line")
  }, 10_000)

  it("dispose: PTYが終了する", async () => {
    spawnPty()
    await waitForEvent("terminal.state")

    dispose()
    expect(getSnapshot().alive).toBe(false)
  }, 10_000)

  it("write: PTY未起動時は何も起きない（クラッシュしない）", () => {
    write("hello")
    // クラッシュしないことが確認できればOK
  })

  it("execAiCommand: PTY未起動時は即エラー", async () => {
    const result = await execAiCommand("echo test")
    expect(result.output).toContain("PTY未起動")
  })
})

// --- ヘルパー ---

/** 指定タイプのイベントが来るまで待つ */
function waitForEvent(type: string, timeoutMs = 5000): Promise<TerminalToRendererEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs)
    const check = setInterval(() => {
      const found = events.find((e) => e.type === type)
      if (found) {
        clearInterval(check)
        clearTimeout(timer)
        resolve(found)
      }
    }, 50)
  })
}
