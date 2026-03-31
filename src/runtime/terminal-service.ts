// Terminal Service — 持続PTY（node-pty）
// 人間とAIが1つのPTYを共有。AIが主ユーザー、人間が補助。

import * as pty from "node-pty"
import type { IPty } from "node-pty"
import { homedir } from "node:os"
import { getConfig } from "../config.js"
import * as log from "../logger.js"
import type { TerminalToRendererEvent, TerminalSnapshot } from "../shared/terminal-schema.js"

// AIコマンド完了検知マーカー（OSC private sequence）
// precmd/PROMPT_COMMANDから発火。xterm.jsに到達前に除去する
const OSC_MARKER_RE = /\x1b\]7770;(-?\d+)\x07/g

// AI実行時に許可する環境変数（allowlist方式: 漏れに強い）
const AI_ENV_ALLOWLIST = [
  "PATH", "HOME", "SHELL", "TERM", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE",
  "USER", "LOGNAME", "EDITOR", "VISUAL",
]

const MAX_SCROLLBACK = 200
const DEFAULT_TIMEOUT_MS = 30_000

type EventSink = (event: TerminalToRendererEvent) => void

// --- 状態 ---

let eventSink: EventSink | null = null
let ptyProcess: IPty | null = null
let initialized = false
let scrollback: string[] = []

// AIコマンド実行中の状態
let aiCapture: {
  output: string
  resolve: (result: AiCommandResult) => void
  timer: ReturnType<typeof setTimeout>
} | null = null

export type AiCommandResult = {
  exitCode: number | null
  output: string[]
  truncated: boolean
}

// --- 公開API ---

export function setEventSink(sink: EventSink): void {
  eventSink = sink
}

/** PTYを起動する（場の開始時に呼ぶ） */
export function spawnPty(cols = 80, rows = 24): void {
  if (ptyProcess) return

  const config = getConfig()
  const shell = config.terminalShell

  const p = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: homedir(),
    env: { ...process.env, TERM: "xterm-256color" },
  })
  ptyProcess = p

  log.info(`[TERMINAL] PTY起動: shell=${shell} pid=${p.pid}`)

  p.onData((data: string) => {
    // dispose後に旧PTYのイベントが来ても無視
    if (ptyProcess !== p) return
    handlePtyData(data)
  })

  p.onExit(({ exitCode, signal }) => {
    // dispose後に旧PTYのonExitが来ても現在の状態を汚染しない
    if (ptyProcess !== p) return
    log.info(`[TERMINAL] PTY終了: code=${exitCode} signal=${signal}`)
    ptyProcess = null
    initialized = false

    // AIコマンド待ちがあれば解決
    resolveAiCapture(exitCode)

    emit({ type: "terminal.state", state: "exited" })
  })

  // シェル統合を注入（precmd/PROMPT_COMMANDで完了マーカーを発火）
  injectShellIntegration(shell)
}

/** PTYに生データを書き込む（人間の入力） */
export function write(data: string): void {
  if (!ptyProcess) return
  ptyProcess.write(data)
}

/** AIコマンドを実行し、完了まで待つ */
export function execAiCommand(cmd: string, timeoutMs?: number): Promise<AiCommandResult> {
  if (!ptyProcess) {
    return Promise.resolve({ exitCode: null, output: ["PTY未起動"], truncated: false })
  }
  if (aiCapture) {
    return Promise.resolve({ exitCode: null, output: ["TERMINAL_BUSY: AI実行中"], truncated: false })
  }

  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      log.info(`[TERMINAL] AIコマンドタイムアウト(${timeout}ms): ${cmd.substring(0, 80)}`)
      resolveAiCapture(null)
    }, timeout)

    aiCapture = { output: "", resolve, timer }

    log.info(`[TERMINAL] AI exec: ${cmd.substring(0, 80)}`)
    ptyProcess!.write(cmd + "\n")
  })
}

/** AIコマンド実行中か */
export function isAiBusy(): boolean {
  return aiCapture !== null
}

/** PTYリサイズ */
export function resize(cols: number, rows: number): void {
  if (!ptyProcess) return
  ptyProcess.resize(cols, rows)
}

/** スナップショット取得 */
export function getSnapshot(): TerminalSnapshot {
  return { alive: ptyProcess !== null }
}

/** 直近の出力（AI用: cmd省略時） */
export function getScrollback(): { lines: string[]; truncated: boolean } {
  const truncated = scrollback.length >= MAX_SCROLLBACK
  return { lines: [...scrollback], truncated }
}

/** クリーンアップ（場の終了時に呼ぶ） */
export function dispose(): void {
  if (aiCapture) {
    clearTimeout(aiCapture.timer)
    aiCapture.resolve({ exitCode: null, output: ["PTY終了"], truncated: false })
    aiCapture = null
  }
  if (ptyProcess) {
    ptyProcess.kill()
    ptyProcess = null
  }
  initialized = false
  scrollback = []
}

// --- 内部ヘルパー ---

/** PTYからのデータを処理 */
function handlePtyData(raw: string): void {
  // OSCマーカーを検出・除去
  let exitCode: number | null = null
  const matches = [...raw.matchAll(OSC_MARKER_RE)]
  if (matches.length > 0) {
    exitCode = parseInt(matches[matches.length - 1][1], 10)
  }
  const cleaned = raw.replace(OSC_MARKER_RE, "")

  // AIキャプチャ中なら出力を蓄積
  if (aiCapture) {
    aiCapture.output += cleaned
  }

  // マーカー検出 = コマンド完了
  if (exitCode !== null && aiCapture) {
    resolveAiCapture(exitCode)
  }

  // 初期化完了前のシェル統合注入出力を抑制
  if (!initialized) {
    if (matches.length > 0) {
      // 最初のマーカー到着 = シェル統合が動作している → 初期化完了
      initialized = true
      emit({ type: "terminal.state", state: "ready" })
      // 注入コマンドの出力はRendererに送らない（clear済み）
    }
    return
  }

  // Rendererに転送
  if (cleaned) {
    pushScrollback(cleaned)
    emit({ type: "terminal.data", data: cleaned })
  }
}

/** AIキャプチャを解決する */
function resolveAiCapture(exitCode: number | null): void {
  if (!aiCapture) return
  clearTimeout(aiCapture.timer)

  const lines = aiCapture.output.split(/\r?\n/)
  const truncated = lines.length > MAX_SCROLLBACK
  const outputLines = truncated ? lines.slice(-MAX_SCROLLBACK) : lines

  aiCapture.resolve({ exitCode, output: outputLines, truncated })
  aiCapture = null
}

/** シェル統合を注入: precmd/PROMPT_COMMANDで完了マーカーを発火させる */
function injectShellIntegration(shell: string): void {
  if (!ptyProcess) return

  const lower = shell.toLowerCase()
  const isZsh = lower.includes("zsh")
  const isBash = lower.includes("bash")
  const isPowerShell = lower.includes("powershell") || lower.includes("pwsh")

  if (isZsh) {
    // zsh: precmd_functionsに追加（既存のprecmdを壊さない）
    ptyProcess.write(
      `__avatar_precmd() { printf '\\033]7770;%d\\007' $? }; precmd_functions+=(__avatar_precmd); clear\n`,
    )
  } else if (isBash) {
    // bash: PROMPT_COMMANDに追加
    ptyProcess.write(
      `__avatar_pc() { printf '\\033]7770;%d\\007' $?; }; PROMPT_COMMAND="__avatar_pc;\${PROMPT_COMMAND}"; clear\n`,
    )
  } else if (isPowerShell) {
    // PowerShell: prompt関数をオーバーライド
    ptyProcess.write(
      `function prompt { $e = $LASTEXITCODE; [char]27 + ']7770;' + $e + [char]7; return 'PS> ' }; cls\r\n`,
    )
  } else {
    // 未対応シェル: マーカーなしで動作（AI完了検知はタイムアウトのみ）
    log.info(`[TERMINAL] シェル統合未対応: ${shell}（AI完了検知はタイムアウトのみ）`)
    initialized = true
    emit({ type: "terminal.state", state: "ready" })
  }
}

function emit(event: TerminalToRendererEvent): void {
  eventSink?.(event)
}

function pushScrollback(text: string): void {
  const lines = text.split(/\r?\n/)
  scrollback.push(...lines)
  if (scrollback.length > MAX_SCROLLBACK) {
    scrollback = scrollback.slice(-MAX_SCROLLBACK)
  }
}
