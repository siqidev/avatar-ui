// Terminalペイン — xterm.js + per-command spawn IPC

import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import type {
  TerminalOutputEvent,
  TerminalLifecycleEvent,
  TerminalSnapshotEvent,
  TerminalSnapshot,
} from "../shared/terminal-schema.js"

// --- DOM参照 ---

const containerEl = document.getElementById("terminal-container") as HTMLDivElement

// --- xterm初期化 ---

const term = new Terminal({
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  lineHeight: 1.45,
  theme: {
    background: "#0c1118",
    foreground: "#d3dde6",
    cursor: "#3dd6f5",
    selectionBackground: "#1e2a38",
  },
  cursorBlink: true,
  scrollback: 500,
  convertEol: true,
})

const fitAddon = new FitAddon()
term.loadAddon(fitAddon)

// --- 状態 ---

let busy = false
let currentCwd = ""
let inputBuffer = ""

// --- プロンプト描画 ---

function writePrompt(): void {
  const short = currentCwd.replace(/^\/Users\/[^/]+/, "~")
  term.write(`\r\n\x1b[36m${short}\x1b[0m $ `)
  inputBuffer = ""
}

// --- 公開コントローラ ---

export function initTerminalPane(): void {
  term.open(containerEl)
  fitAddon.fit()

  // リサイズ追従
  const observer = new ResizeObserver(() => fitAddon.fit())
  observer.observe(containerEl)

  // 初期スナップショット取得
  void window.fieldApi.terminalSnapshot().then((snapshot: TerminalSnapshot) => {
    currentCwd = snapshot.cwd
    // スクロールバック復元
    if (snapshot.scrollback.length > 0) {
      term.write(snapshot.scrollback.join("\n"))
    }
    writePrompt()
  })

  // キー入力
  term.onData((data) => {
    if (busy) {
      // 実行中: stdinに転送
      void window.fieldApi.terminalStdin({
        actor: "human",
        correlationId: crypto.randomUUID(),
        data,
      })
      return
    }

    // コマンド入力モード
    const code = data.charCodeAt(0)
    if (data === "\r") {
      // Enter: コマンド実行
      term.write("\r\n")
      const cmd = inputBuffer.trim()
      if (!cmd) { writePrompt(); return }
      inputBuffer = ""
      busy = true

      void window.fieldApi.terminalExec({
        actor: "human",
        correlationId: crypto.randomUUID(),
        cmd,
      }).then((result) => {
        if (!result.accepted) {
          term.write(`\x1b[31m${result.reason ?? "実行不可"}\x1b[0m\r\n`)
          busy = false
          writePrompt()
        }
      })
    } else if (data === "\x7f") {
      // Backspace
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1)
        term.write("\b \b")
      }
    } else if (code === 3) {
      // Ctrl+C
      if (busy) {
        void window.fieldApi.terminalStop({
          actor: "human",
          correlationId: crypto.randomUUID(),
        })
      } else {
        inputBuffer = ""
        term.write("^C")
        writePrompt()
      }
    } else if (code >= 32) {
      // 通常文字
      inputBuffer += data
      term.write(data)
    }
  })

  // --- Main→Rendererイベント ---

  window.fieldApi.onTerminalOutput((raw) => {
    const event = raw as TerminalOutputEvent
    if (event.stream === "stderr") {
      term.write(`\x1b[31m${event.chunk}\x1b[0m`)
    } else {
      term.write(event.chunk)
    }
  })

  window.fieldApi.onTerminalLifecycle((raw) => {
    const event = raw as TerminalLifecycleEvent
    if (event.phase === "exited") {
      busy = false
      if (event.cwdAfter) currentCwd = event.cwdAfter
      // 非ゼロ終了コード表示
      if (event.exitCode !== 0 && event.exitCode !== null) {
        term.write(`\x1b[31m[exit ${event.exitCode}]\x1b[0m`)
      }
      writePrompt()
    }
  })

  window.fieldApi.onTerminalSnapshot((raw) => {
    const event = raw as TerminalSnapshotEvent
    currentCwd = event.snapshot.cwd
  })
}
