// Terminalペイン — xterm.js + PTYパススルー
// 全キー入力をPTYに転送。PTY出力をそのまま表示する純粋ターミナル。

import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import type { TerminalDataEvent, TerminalStateEvent } from "../shared/terminal-schema.js"

// --- DOM参照 ---

const containerEl = document.getElementById("terminal-container") as HTMLDivElement

// --- CSS変数からxtermテーマを読み取る ---

function readTermTheme(): { background: string; foreground: string; cursor: string; selectionBackground: string } {
  const s = getComputedStyle(document.documentElement)
  return {
    background: s.getPropertyValue("--term-bg").trim() || "#0c1118",
    foreground: s.getPropertyValue("--term-fg").trim() || "#d3dde6",
    cursor: s.getPropertyValue("--term-cursor").trim() || "#3dd6f5",
    selectionBackground: s.getPropertyValue("--term-selection").trim() || "#1e2a38",
  }
}

// --- xterm初期化 ---

const term = new Terminal({
  fontFamily: "'Iosevka Term', 'JetBrains Mono', 'Cascadia Mono', monospace",
  fontSize: 13,
  lineHeight: 1.45,
  theme: readTermTheme(),
  cursorBlink: true,
  scrollback: 1000,
})

/** テーマ変更時にxtermの色を再適用する */
export function applyTermTheme(): void {
  term.options.theme = readTermTheme()
}

const fitAddon = new FitAddon()
term.loadAddon(fitAddon)

// --- 公開コントローラ ---

export function initTerminalPane(): void {
  term.open(containerEl)
  fitAddon.fit()

  // リサイズ追従
  const observer = new ResizeObserver(() => {
    fitAddon.fit()
    // PTYにサイズを通知
    void window.fieldApi.terminalResize({ cols: term.cols, rows: term.rows })
  })
  observer.observe(containerEl)

  // 初期サイズ通知
  void window.fieldApi.terminalResize({ cols: term.cols, rows: term.rows })

  // キー入力: すべてPTYに転送
  term.onData((data) => {
    void window.fieldApi.terminalInput({ data })
  })

  // --- Main→Rendererイベント ---

  // PTYからの生データ
  window.fieldApi.onTerminalData((raw) => {
    const event = raw as TerminalDataEvent
    term.write(event.data)
  })

  // PTY状態変化
  window.fieldApi.onTerminalState((raw) => {
    const event = raw as TerminalStateEvent
    if (event.state === "exited") {
      term.write("\r\n\x1b[31m[PTY exited]\x1b[0m\r\n")
    }
  })
}
