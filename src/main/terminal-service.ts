// Terminal Service — per-command spawn + cwd追跡

import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { homedir } from "node:os"
import { getConfig } from "../config.js"
import * as log from "../logger.js"
import type {
  TerminalExecArgs,
  TerminalStdinArgs,
  TerminalStopArgs,
  TerminalSnapshot,
  TerminalToRendererEvent,
} from "../shared/terminal-schema.js"

// cwdマーカー: コマンド末尾に付与し、Renderer転送前に除去
const CWD_MARKER_PREFIX = "__AVATAR_CWD__:"
const CWD_MARKER_RE = new RegExp(`${CWD_MARKER_PREFIX}(.+)\\n?$`)

const MAX_SCROLLBACK = 200
const MAX_COMMAND_OUTPUT = 200
const DEFAULT_TIMEOUT_MS = 30_000

type EventSink = (event: TerminalToRendererEvent) => void

// --- 状態 ---

let eventSink: EventSink | null = null
let currentProcess: ChildProcess | null = null
let currentPid: number | null = null
let currentCwd: string = homedir()
let currentCmd: string | null = null
let currentActor: "human" | "ai" | null = null
let currentCorrelationId: string | null = null
let startedAt: number | null = null
let scrollback: string[] = []
let lastExitCode: number | null | undefined = undefined
let killTimer: ReturnType<typeof setTimeout> | null = null
let detectedCwd: string | null = null

// コマンド単位の出力蓄積（AI用）
let commandOutput: string[] = []

// 完了待ちPromise
let exitResolve: (() => void) | null = null

// --- 公開API ---

export function setEventSink(sink: EventSink): void {
  eventSink = sink
}

export function getCwd(): string {
  return currentCwd
}

export function isBusy(): boolean {
  return currentProcess !== null
}

export function getSnapshot(): TerminalSnapshot {
  return {
    cwd: currentCwd,
    busy: currentProcess !== null,
    scrollback: [...scrollback],
    lastCmd: currentCmd ?? undefined,
    lastExitCode,
  }
}

/** コマンド実行（per-command spawn） */
export function execCommand(args: TerminalExecArgs): { accepted: boolean; reason?: string } {
  if (currentProcess) {
    return { accepted: false, reason: "TERMINAL_BUSY" }
  }

  const { cmd, actor, correlationId, timeoutMs } = args
  currentCmd = cmd
  currentActor = actor
  currentCorrelationId = correlationId
  startedAt = Date.now()
  detectedCwd = null
  commandOutput = []

  // シェル実行: コマンド末尾にpwdマーカーを付与
  // -c（非ログイン）: Electron親プロセスのPATHを継承。-lcだとzshrcのプロンプトテーマが初期化ゴミを出す
  const wrappedCmd = `${cmd}; __exit=$?; echo "${CWD_MARKER_PREFIX}$(pwd)"; exit $__exit`
  const child = spawn(getConfig().terminalShell, ["-c", wrappedCmd], {
    cwd: currentCwd,
    env: { ...process.env, TERM: "dumb" },
    stdio: ["pipe", "pipe", "pipe"],
    detached: true, // プロセスグループ分離（killで子孫プロセスまで届ける）
  })

  currentProcess = child
  currentPid = child.pid ?? null
  log.info(`[TERMINAL] exec(${actor}): ${cmd.substring(0, 80)} [pid=${child.pid}]`)

  pushScrollback(`$ ${cmd}`)

  emit({
    type: "terminal.lifecycle",
    phase: "started",
    actor,
    correlationId,
    cmd,
  })

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    const markerMatch = CWD_MARKER_RE.exec(text)
    if (markerMatch) {
      detectedCwd = markerMatch[1]
      const cleaned = text.replace(CWD_MARKER_RE, "")
      if (cleaned) {
        pushScrollback(cleaned)
        pushCommandOutput(cleaned)
        emit({ type: "terminal.output", stream: "stdout", chunk: cleaned, at: Date.now() })
      }
    } else {
      pushScrollback(text)
      pushCommandOutput(text)
      emit({ type: "terminal.output", stream: "stdout", chunk: text, at: Date.now() })
    }
  })

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    pushScrollback(text)
    pushCommandOutput(text)
    emit({ type: "terminal.output", stream: "stderr", chunk: text, at: Date.now() })
  })

  child.on("close", (code, signal) => {
    const duration = startedAt ? Date.now() - startedAt : 0
    if (killTimer) { clearTimeout(killTimer); killTimer = null }

    if (detectedCwd) currentCwd = detectedCwd
    lastExitCode = code

    log.info(`[TERMINAL] exit: code=${code} signal=${signal} duration=${duration}ms cwd=${currentCwd}`)

    emit({
      type: "terminal.lifecycle",
      phase: "exited",
      actor: currentActor!,
      correlationId: currentCorrelationId!,
      exitCode: code,
      signal: signal ?? undefined,
      durationMs: duration,
      cwdAfter: currentCwd,
    })

    currentProcess = null
    currentPid = null
    currentActor = null
    currentCorrelationId = null
    startedAt = null

    emit({ type: "terminal.snapshot", snapshot: getSnapshot() })

    // 完了通知
    exitResolve?.()
    exitResolve = null
  })

  // タイムアウト
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS
  killTimer = setTimeout(() => {
    killProcessGroup("SIGTERM")
    log.info(`[TERMINAL] タイムアウト(${timeout}ms) — SIGTERM送信`)
  }, timeout)

  return { accepted: true }
}

/** 実行中プロセスにstdinを書き込む */
export function writeStdin(args: TerminalStdinArgs): { ok: boolean; reason?: string } {
  if (!currentProcess?.stdin?.writable) {
    return { ok: false, reason: "NO_PROCESS" }
  }
  currentProcess.stdin.write(args.data)
  return { ok: true }
}

/** 実行中プロセスを停止 */
export function stopCommand(args: TerminalStopArgs): { ok: boolean; reason?: string } {
  if (!currentProcess) {
    return { ok: false, reason: "NO_PROCESS" }
  }
  const signal = args.signal ?? "SIGTERM"
  killProcessGroup(signal)
  log.info(`[TERMINAL] stop(${args.actor}): ${signal}`)
  return { ok: true }
}

/** 現在のコマンド完了を待つ */
export function waitForExit(): Promise<void> | null {
  if (!currentProcess) return null
  return new Promise((resolve) => { exitResolve = resolve })
}

/** 直近コマンドの出力（AI用、末尾N行） */
export function getCommandOutput(): { lines: string[]; truncated: boolean } {
  const truncated = commandOutput.length > MAX_COMMAND_OUTPUT
  return {
    lines: commandOutput.slice(-MAX_COMMAND_OUTPUT),
    truncated,
  }
}

/** アプリ終了時クリーンアップ */
export function dispose(): void {
  if (killTimer) { clearTimeout(killTimer); killTimer = null }
  killProcessGroup("SIGKILL")
  currentProcess = null
  currentPid = null
  currentCmd = null
  currentActor = null
  currentCorrelationId = null
  startedAt = null
  lastExitCode = undefined
  detectedCwd = null
  commandOutput = []
  scrollback = []
  exitResolve?.()
  exitResolve = null
}

// --- 内部ヘルパー ---

/** プロセスグループにシグナル送信（子孫プロセス含む） */
function killProcessGroup(signal: string): void {
  if (!currentPid) return
  try {
    // 負のPIDでプロセスグループ全体にシグナル送信
    process.kill(-currentPid, signal)
  } catch {
    // プロセスが既に終了している場合のERR_NO_SUCH_PROCESSを無視
  }
}

function emit(event: TerminalToRendererEvent): void {
  eventSink?.(event)
}

function pushScrollback(text: string): void {
  const lines = text.split("\n")
  scrollback.push(...lines)
  if (scrollback.length > MAX_SCROLLBACK) {
    scrollback = scrollback.slice(-MAX_SCROLLBACK)
  }
}

function pushCommandOutput(text: string): void {
  const lines = text.split("\n")
  commandOutput.push(...lines)
}
