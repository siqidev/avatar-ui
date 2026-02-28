import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  execCommand,
  writeStdin,
  stopCommand,
  getSnapshot,
  getCwd,
  isBusy,
  setEventSink,
  waitForExit,
  getCommandOutput,
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

describe("terminal-service", () => {
  it("初期状態: busy=false, cwdがホームディレクトリ", () => {
    expect(isBusy()).toBe(false)
    expect(getCwd()).toBeTruthy()
  })

  it("echoコマンド実行: accepted→出力→exit", async () => {
    const result = execCommand({
      actor: "human",
      correlationId: "test-1",
      cmd: "echo hello_world",
    })
    expect(result.accepted).toBe(true)
    expect(isBusy()).toBe(true)

    const exit = waitForExit()
    expect(exit).not.toBeNull()
    await exit

    expect(isBusy()).toBe(false)

    // lifecycle started + output + lifecycle exited + snapshot
    const lifecycles = events.filter((e) => e.type === "terminal.lifecycle")
    expect(lifecycles.length).toBe(2)
    expect((lifecycles[0] as { phase: string }).phase).toBe("started")
    expect((lifecycles[1] as { phase: string }).phase).toBe("exited")
    expect((lifecycles[1] as { exitCode: number }).exitCode).toBe(0)

    // stdout出力にhello_worldを含む
    const outputs = events.filter((e) => e.type === "terminal.output")
    const combined = outputs.map((e) => (e as { chunk: string }).chunk).join("")
    expect(combined).toContain("hello_world")
  })

  it("TERMINAL_BUSY: 実行中に2つ目のコマンドは拒否", async () => {
    execCommand({
      actor: "human",
      correlationId: "test-2a",
      cmd: "sleep 0.5",
    })

    const result2 = execCommand({
      actor: "ai",
      correlationId: "test-2b",
      cmd: "echo blocked",
    })
    expect(result2.accepted).toBe(false)
    expect(result2.reason).toBe("TERMINAL_BUSY")

    await waitForExit()
  })

  it("cwd追跡: cdコマンドでcwdが更新される", async () => {
    execCommand({
      actor: "human",
      correlationId: "test-3",
      cmd: "cd /tmp",
    })
    await waitForExit()

    expect(getCwd()).toBe("/tmp")
  })

  it("stopCommand: 実行中プロセスを停止", async () => {
    execCommand({
      actor: "human",
      correlationId: "test-4",
      cmd: "sleep 10",
    })

    // waitForExitをstopの前に取得（close後だとcurrentProcess=nullでnull返却）
    const exit = waitForExit()
    expect(exit).not.toBeNull()

    await new Promise((r) => setTimeout(r, 100))
    const result = stopCommand({
      actor: "human",
      correlationId: "test-4-stop",
      signal: "SIGKILL",
    })
    expect(result.ok).toBe(true)

    await exit
    expect(isBusy()).toBe(false)
  }, 10_000)

  it("stopCommand: 非実行時はNO_PROCESS", () => {
    const result = stopCommand({
      actor: "human",
      correlationId: "test-5",
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("NO_PROCESS")
  })

  it("writeStdin: 非実行時はNO_PROCESS", () => {
    const result = writeStdin({
      actor: "human",
      correlationId: "test-6",
      data: "input\n",
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("NO_PROCESS")
  })

  it("getSnapshot: コマンド実行後のスナップショット", async () => {
    execCommand({
      actor: "human",
      correlationId: "test-7",
      cmd: "echo snap_test",
    })
    await waitForExit()

    const snap = getSnapshot()
    expect(snap.busy).toBe(false)
    expect(snap.lastCmd).toBe("echo snap_test")
    expect(snap.lastExitCode).toBe(0)
    expect(snap.scrollback.length).toBeGreaterThan(0)
  })

  it("getCommandOutput: 実行出力を取得", async () => {
    execCommand({
      actor: "ai",
      correlationId: "test-8",
      cmd: "echo line1 && echo line2",
    })
    await waitForExit()

    const output = getCommandOutput()
    const text = output.lines.join("\n")
    expect(text).toContain("line1")
    expect(text).toContain("line2")
    expect(output.truncated).toBe(false)
  })

  it("非ゼロ終了コード: exitCodeが反映", async () => {
    execCommand({
      actor: "human",
      correlationId: "test-9",
      cmd: "exit 42",
    })
    await waitForExit()

    expect(getSnapshot().lastExitCode).toBe(42)
  })

  it("起点対称性: human/aiどちらでも実行可能", async () => {
    execCommand({
      actor: "ai",
      correlationId: "test-10",
      cmd: "echo ai_exec",
    })
    await waitForExit()

    const lifecycles = events.filter((e) => e.type === "terminal.lifecycle")
    expect((lifecycles[0] as { actor: string }).actor).toBe("ai")
  })
})
