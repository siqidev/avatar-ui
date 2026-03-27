// Renderer エントリー: 3列レイアウト + 縦横スプリッター + ペインD&D入替 + Stream

import { setLocale, t, getLocale, type Locale } from "../shared/i18n.js"
import { swapPanes, DEFAULT_LAYOUT, GRID_SLOTS } from "./layout-manager.js"
import type { GridSlot, Layout } from "./layout-manager.js"
import { normalizeState } from "./state-normalizer.js"
import type { PaneInput } from "./state-normalizer.js"
import { initFilesystemPane } from "./filesystem-pane.js"
import { initCanvasPane } from "./canvas-pane.js"
import type { CanvasPaneController } from "./canvas-pane.js"
import { initTerminalPane, applyTermTheme } from "./terminal-pane.js"
import { DemoPlayer } from "./demo-player.js"
import { createSessionClient } from "./session-client.js"
import type { SessionClient } from "./session-client.js"

import type {
  FsImportFileArgs,
  FsImportFileResult,
  FsListArgs,
  FsReadArgs,
  FsWriteArgs,
  FsMutateArgs,
  FsListResult,
  FsReadResult,
  FsWriteResult,
  FsMutateResult,
} from "../shared/fs-schema.js"
import type {
  TerminalInputArgs,
  TerminalResizeArgs,
  TerminalSnapshot,
} from "../shared/terminal-schema.js"
import type { DemoScript } from "../shared/demo-script-schema.js"

declare global {
  interface Window {
    fieldApi: {
      // 場のライフサイクル（IPC）
      attach: () => Promise<void>
      detach: () => void
      terminate: () => void
      // WS接続情報
      sessionWsConfig: () => Promise<{ port: number; token?: string }>
      // ファイル操作（IPC）
      fsRootName: () => Promise<string>
      fsList: (args: FsListArgs) => Promise<FsListResult>
      fsRead: (args: FsReadArgs) => Promise<FsReadResult>
      fsWrite: (args: FsWriteArgs) => Promise<FsWriteResult>
      fsImportFile: (args: FsImportFileArgs) => Promise<FsImportFileResult>
      fsMutate: (args: FsMutateArgs) => Promise<FsMutateResult>
      // Terminal（IPC）
      terminalInput: (args: TerminalInputArgs) => Promise<{ ok: boolean }>
      terminalResize: (args: TerminalResizeArgs) => Promise<{ ok: boolean }>
      terminalSnapshot: () => Promise<TerminalSnapshot>
      // IPC残置イベント
      onIntegrityAlert: (cb: (data: unknown) => void) => void
      onTerminalData: (cb: (data: unknown) => void) => void
      onTerminalState: (cb: (data: unknown) => void) => void
      onThemeChange: (cb: (theme: string) => void) => void
      onLocaleChange: (cb: (locale: string) => void) => void
      // ユーティリティ
      getFilePath: (file: File) => string
      loadDemoScript: () => Promise<{ ok: true; lines: DemoScript } | { ok: false; error: string }>
    }
  }
}

// ロケール初期化（localStorage → 同期読み込み。MainからのIPC到着前にt()を使えるようにする）
const savedLocale = localStorage.getItem("aui-locale") as Locale | null
if (savedLocale) setLocale(savedLocale)

// === DOM参照 ===
const consoleEl = document.getElementById("console") as HTMLDivElement
const statusEl = document.getElementById("field-status") as HTMLSpanElement
const alertBar = document.getElementById("alert-bar") as HTMLDivElement
const messagesEl = document.getElementById("stream-messages") as HTMLDivElement
const formEl = document.getElementById("stream-form") as HTMLFormElement
const inputEl = document.getElementById("stream-input") as HTMLInputElement
const streamPane = document.getElementById("pane-stream") as HTMLDivElement
const robloxPane = document.getElementById("pane-roblox") as HTMLDivElement
const robloxBody = robloxPane.querySelector(".pane-body") as HTMLDivElement
const xPane = document.getElementById("pane-x") as HTMLDivElement
const xBody = xPane.querySelector(".pane-body") as HTMLDivElement
const avatarImg = document.getElementById("avatar-img") as HTMLImageElement

// === Canvasペイン初期化 ===
const canvas: CanvasPaneController = initCanvasPane()
let spaceInitialized = false

// === Terminalペイン初期化 ===
initTerminalPane()

// === レイアウト管理 ===
// レイアウト = 列の配列。各列はペインIDの配列。列構造は2/3/2固定
let currentLayout: Layout = DEFAULT_LAYOUT.map((col) => [...col])

// ペイン要素マップ（slot名 → DOM要素）
const paneElements = new Map<GridSlot, HTMLElement>()
for (const slot of GRID_SLOTS) {
  paneElements.set(slot, document.querySelector(`[data-slot="${slot}"]`)!)
}

// 列コンテナ
const columns = [
  document.getElementById("col-0")!,
  document.getElementById("col-1")!,
  document.getElementById("col-2")!,
]

// 列幅比率 [left, center, right] — 初期 15:42:43
const colRatios = [15, 42, 43]
// 列ごとの行比率（正の重み、描画時に正規化）
const rowRatios: number[][] = [
  [30, 70],       // 左列: Avatar / Space
  [50, 20, 30],   // 中央列: Canvas / X / Roblox
  [65, 35],       // 右列: Stream / Terminal
]

const SPLITTER_WIDTH = 4
const MIN_TRACK_PX = 100

function applyColumnWidths(): void {
  consoleEl.style.gridTemplateColumns =
    `${colRatios[0]}fr ${SPLITTER_WIDTH}px ${colRatios[1]}fr ${SPLITTER_WIDTH}px ${colRatios[2]}fr`
}

// 列ごとのペイン高さ比率を適用（列内ペイン数に応じて汎用処理）
function applyRowRatios(): void {
  for (let c = 0; c < 3; c++) {
    const col = columns[c]
    const paneCount = currentLayout[c].length
    for (let p = 0; p < paneCount; p++) {
      // DOM children: [pane0, splitter0, pane1, splitter1, pane2, ...]
      // pane の child index = p * 2
      const paneEl = col.children[p * 2] as HTMLElement
      if (paneEl) paneEl.style.flex = String(rowRatios[c][p])
    }
  }
}

// レイアウト配列に従ってペインDOMを列に配置（列ループで統一、特例なし）
function renderLayout(): void {
  for (let c = 0; c < 3; c++) {
    const col = columns[c]
    // 既存の子要素をクリア
    while (col.firstChild) col.removeChild(col.firstChild)

    const slots = currentLayout[c]
    for (let p = 0; p < slots.length; p++) {
      if (p > 0) {
        // ペイン間に横スプリッターを挿入
        const splitter = document.createElement("div")
        splitter.className = "splitter-h"
        col.appendChild(splitter)
        initRowSplitter(splitter, c, p - 1, p)
      }
      col.appendChild(paneElements.get(slots[p])!)
    }
  }
  applyRowRatios()
}

// 初期レイアウト適用
applyColumnWidths()
renderLayout()

// === 縦スプリッタードラッグ（列幅変更） ===
const splitterV1 = document.getElementById("splitter-v1") as HTMLDivElement
const splitterV2 = document.getElementById("splitter-v2") as HTMLDivElement

function initColumnSplitter(
  splitter: HTMLDivElement,
  leftIdx: number,
  rightIdx: number,
): void {
  splitter.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const totalContentWidth = consoleEl.clientWidth - 2 * SPLITTER_WIDTH
    const ratioSum = colRatios[0] + colRatios[1] + colRatios[2]
    const startLeftPx = (colRatios[leftIdx] / ratioSum) * totalContentWidth
    const startRightPx = (colRatios[rightIdx] / ratioSum) * totalContentWidth

    splitter.classList.add("dragging")
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    function onMouseMove(ev: MouseEvent): void {
      const dx = ev.clientX - startX
      const combined = startLeftPx + startRightPx
      const newLeftPx = Math.max(MIN_TRACK_PX, Math.min(startLeftPx + dx, combined - MIN_TRACK_PX))
      const newRightPx = combined - newLeftPx

      colRatios[leftIdx] = (newLeftPx / totalContentWidth) * ratioSum
      colRatios[rightIdx] = (newRightPx / totalContentWidth) * ratioSum
      applyColumnWidths()
    }

    function onMouseUp(): void {
      splitter.classList.remove("dragging")
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  })
}

initColumnSplitter(splitterV1, 0, 1)
initColumnSplitter(splitterV2, 1, 2)

// === 横スプリッタードラッグ（汎用: 隣接2ペイン間、列内ペイン数不問） ===
function initRowSplitter(
  splitter: HTMLElement,
  colIdx: number,
  upperPaneIdx: number,
  lowerPaneIdx: number,
): void {
  splitter.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault()
    const col = columns[colIdx]
    const startY = e.clientY
    // DOM children: [pane0, splitter0, pane1, splitter1, pane2, ...]
    const upperPane = col.children[upperPaneIdx * 2] as HTMLElement
    const lowerPane = col.children[lowerPaneIdx * 2] as HTMLElement
    const startUpperH = upperPane.getBoundingClientRect().height
    const startLowerH = lowerPane.getBoundingClientRect().height

    splitter.classList.add("dragging")
    document.body.style.cursor = "row-resize"
    document.body.style.userSelect = "none"

    function onMouseMove(ev: MouseEvent): void {
      const dy = ev.clientY - startY
      const combined = startUpperH + startLowerH
      const newUpperH = Math.max(MIN_TRACK_PX, Math.min(startUpperH + dy, combined - MIN_TRACK_PX))
      const newLowerH = combined - newUpperH

      // 比率を更新（隣接2ペインの重み合計を保存し、高さ比で再分配）
      const weightSum = rowRatios[colIdx][upperPaneIdx] + rowRatios[colIdx][lowerPaneIdx]
      rowRatios[colIdx][upperPaneIdx] = (newUpperH / combined) * weightSum
      rowRatios[colIdx][lowerPaneIdx] = (newLowerH / combined) * weightSum
      upperPane.style.flex = String(rowRatios[colIdx][upperPaneIdx])
      lowerPane.style.flex = String(rowRatios[colIdx][lowerPaneIdx])
    }

    function onMouseUp(): void {
      splitter.classList.remove("dragging")
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  })
}

// === ペインD&D入替（全7ペイン対応） ===
function initPaneDragAndDrop(): void {
  const allPanes = consoleEl.querySelectorAll<HTMLDivElement>(".pane")

  for (const pane of allPanes) {
    const header = pane.querySelector(".pane-header") as HTMLElement

    header.addEventListener("dragstart", (e: DragEvent) => {
      const slot = pane.dataset.slot
      if (!slot || !e.dataTransfer) return
      e.dataTransfer.setData("text/plain", slot)
      e.dataTransfer.effectAllowed = "move"
    })

    pane.addEventListener("dragover", (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
      pane.classList.add("drag-over")
    })

    pane.addEventListener("dragleave", () => {
      pane.classList.remove("drag-over")
    })

    pane.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault()
      pane.classList.remove("drag-over")
      const fromSlot = e.dataTransfer?.getData("text/plain") as GridSlot | undefined
      const toSlot = pane.dataset.slot as GridSlot | undefined
      if (!fromSlot || !toSlot || fromSlot === toSlot) return
      if (!(GRID_SLOTS as readonly string[]).includes(fromSlot) ||
          !(GRID_SLOTS as readonly string[]).includes(toSlot)) return

      currentLayout = swapPanes(currentLayout, fromSlot, toSlot)
      renderLayout()
    })

    pane.addEventListener("dragend", () => {
      for (const p of allPanes) {
        p.classList.remove("drag-over")
      }
    })
  }
}

initPaneDragAndDrop()

// === テキストSE + リップシンク ===
const CHAR_DELAY_MS = 28
const BLIP_FREQ_HZ = 880
const BLIP_DURATION_MS = 25
const BLIP_VOLUME = 0.03
const LIP_SYNC_INTERVAL_MS = 80

// === アイドルアニメーション（たまごっち風コマ送り） ===
const IDLE_FRAME_MIN_MS = 800
const IDLE_FRAME_MAX_MS = 2000
const BLINK_DISPLAY_MS = 150
const BLINK_CHANCE = 0.15 // 各フレーム切替時に瞬きが発生する確率

const IDLE_FRAMES: string[] = ["./idle-00.png"] // 通常フレーム（連番）
let blinkPath: string | null = null // 瞬きフレーム（別枠）
let idleTimer: ReturnType<typeof setTimeout> | null = null
let idleCurrentFrame = 0

// 起動時にidle-01〜09 + blink.pngの存在をプローブ
;(async () => {
  for (let i = 1; i <= 9; i++) {
    const path = `./idle-${String(i).padStart(2, "0")}.png`
    if (!(await probeImage(path))) break
    IDLE_FRAMES.push(path)
  }
  if (await probeImage("./blink.png")) blinkPath = "./blink.png"
  // フレームが2枚以上、または瞬きがあればアニメーション開始
  if (IDLE_FRAMES.length > 1 || blinkPath) startIdleAnimation()
})()

function probeImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = src
  })
}

function startIdleAnimation(): void {
  if (lipSyncActive || idleTimer) return
  scheduleNextIdleFrame()
}

function stopIdleAnimation(): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
}

function scheduleNextIdleFrame(): void {
  if (lipSyncActive) return
  const delay = IDLE_FRAME_MIN_MS + Math.random() * (IDLE_FRAME_MAX_MS - IDLE_FRAME_MIN_MS)
  idleTimer = setTimeout(() => {
    idleTimer = null
    // 瞬き判定（blinkがあり、確率に当たった場合）
    if (blinkPath && Math.random() < BLINK_CHANCE) {
      avatarImg.src = blinkPath
      idleTimer = setTimeout(() => {
        idleTimer = null
        avatarImg.src = IDLE_FRAMES[idleCurrentFrame]
        scheduleNextIdleFrame()
      }, BLINK_DISPLAY_MS)
      return
    }
    // 通常フレーム切替
    if (IDLE_FRAMES.length > 1) {
      idleCurrentFrame = Math.floor(Math.random() * IDLE_FRAMES.length)
      avatarImg.src = IDLE_FRAMES[idleCurrentFrame]
    }
    scheduleNextIdleFrame()
  }, delay)
}

let audioCtx: AudioContext | null = null
let lipSyncActive = false
let lipSyncOn = false
let lipSyncTimer: ReturnType<typeof setTimeout> | null = null
let streamingAbort: (() => void) | null = null

function initAudioCtx(): AudioContext | null {
  if (audioCtx) return audioCtx
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  audioCtx = new Ctx()
  return audioCtx
}

function playBlip(): void {
  const ctx = initAudioCtx()
  if (!ctx) return
  if (ctx.state === "suspended") void ctx.resume()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = "square"
  osc.frequency.value = BLIP_FREQ_HZ
  osc.connect(gain).connect(ctx.destination)
  const t = ctx.currentTime
  const dur = BLIP_DURATION_MS / 1000
  gain.gain.setValueAtTime(BLIP_VOLUME, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
  osc.start(t)
  osc.stop(t + dur + 0.01)
}

function applyLipSync(): void {
  avatarImg.src = lipSyncActive && lipSyncOn ? "./talk.png" : IDLE_FRAMES[idleCurrentFrame]
}

function scheduleLipSync(): void {
  if (!lipSyncActive) return
  lipSyncOn = !lipSyncOn
  applyLipSync()
  lipSyncTimer = setTimeout(scheduleLipSync, LIP_SYNC_INTERVAL_MS)
}

function startLipSync(): void {
  if (lipSyncActive) return
  stopIdleAnimation()
  lipSyncActive = true
  scheduleLipSync()
}

function stopLipSync(): void {
  lipSyncActive = false
  if (lipSyncTimer) { clearTimeout(lipSyncTimer); lipSyncTimer = null }
  lipSyncOn = false
  applyLipSync()
  // リップシンク終了→アイドルアニメーション再開
  if (IDLE_FRAMES.length > 1) startIdleAnimation()
}

// 擬似ストリーム: 完成テキストを1文字ずつ流し込む
function streamText(textNode: Text, text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!text) { resolve(); return }
    let i = 0
    let cancelled = false
    streamingAbort = () => { cancelled = true; textNode.textContent = text; resolve() }
    const step = (): void => {
      if (cancelled) return
      if (i >= text.length) { streamingAbort = null; resolve(); return }
      const ch = text.charAt(i++)
      textNode.textContent += ch
      messagesEl.scrollTop = messagesEl.scrollHeight
      if (!/\s/.test(ch)) playBlip()
      setTimeout(step, CHAR_DELAY_MS)
    }
    step()
  })
}

// thinkingインジケータ
let thinkingEl: HTMLDivElement | null = null

function showThinking(): void {
  if (thinkingEl) return
  thinkingEl = document.createElement("div")
  thinkingEl.className = "message message-ai thinking"
  const label = document.createElement("span")
  label.className = "label"
  label.textContent = avatarLabel
  const dots = document.createElement("span")
  dots.className = "thinking-dots"
  dots.textContent = "..."
  thinkingEl.appendChild(label)
  thinkingEl.appendChild(dots)
  messagesEl.appendChild(thinkingEl)
  messagesEl.scrollTop = messagesEl.scrollHeight
}

function removeThinking(): void {
  if (thinkingEl) { thinkingEl.remove(); thinkingEl = null }
}

// === 設定（field.stateから受信） ===
let avatarLabel = "avatar>"
let userLabel = "user>"

// === 状態管理 ===
let streamPaneInput: PaneInput = { ipcEvents: [], hasFocus: false }

function updateStreamPaneVisual(): void {
  const visual = normalizeState(streamPaneInput)
  streamPane.dataset.state = visual.level

  const badgeEl = streamPane.querySelector(".pane-header .badge") as HTMLSpanElement
  if (badgeEl) {
    badgeEl.textContent = visual.badge ?? ""
  }

  if (visual.showAlertBar) {
    alertBar.style.display = "block"
  } else {
    alertBar.style.display = "none"
  }
}

streamPane.addEventListener("focusin", () => {
  streamPaneInput.hasFocus = true
  updateStreamPaneVisual()
})
streamPane.addEventListener("focusout", () => {
  streamPaneInput.hasFocus = false
  updateStreamPaneVisual()
})

// === ストリームUI ===
type ToolCallDisplay = { name: string; args: Record<string, unknown>; result: string }
let enableStream = true // 履歴復元中はfalse
let currentStreamingPromise: Promise<void> = Promise.resolve()

function appendMessage(
  actor: string,
  rawText: string,
  source?: string,
  toolCalls?: ToolCallDisplay[],
  channel?: string,
): void {
  // リテラル \n を実際の改行に変換（Grokがエスケープ済み文字列を返す場合がある）
  const text = rawText.replace(/\\n/g, "\n")
  const div = document.createElement("div")
  div.className = `message message-${actor}`
  if (source && actor === "ai") {
    div.classList.add(`source-${source}`)
  }

  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      const toolEl = document.createElement("div")
      toolEl.className = "tool-call"
      const nameEl = document.createElement("span")
      nameEl.className = "tool-call-name"
      nameEl.textContent = `${tc.name}`

      const argsStr = Object.entries(tc.args)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ")
      const argsEl = document.createElement("span")
      argsEl.className = "tool-call-args"
      argsEl.textContent = argsStr ? ` ${argsStr}` : ""

      const resultEl = document.createElement("div")
      resultEl.className = "tool-call-result"
      try {
        const parsed = JSON.parse(tc.result) as Record<string, unknown>
        resultEl.textContent = `  └ ${parsed.status ?? tc.result}`
      } catch {
        resultEl.textContent = `  └ ${tc.result.substring(0, 80)}`
      }

      toolEl.appendChild(nameEl)
      toolEl.appendChild(argsEl)
      toolEl.appendChild(resultEl)
      div.appendChild(toolEl)
    }
  }

  const label = document.createElement("span")
  label.className = "label"
  const channelTag = channel === "x" ? "x" : channel === "roblox" ? "roblox" : null
  if (actor === "human" && source === "observation" && channelTag) {
    label.textContent = `[${channelTag}]`
  } else if (actor === "human" && source === "observation") {
    label.textContent = "[roblox]"
  } else if (actor === "human" && source === "pulse") {
    label.textContent = "[pulse]"
  } else if (actor === "human") {
    label.textContent = userLabel
  } else if (source === "pulse") {
    label.textContent = `[pulse] ${avatarLabel}`
  } else if (source === "observation" && channelTag) {
    label.textContent = `[${channelTag}] ${avatarLabel}`
  } else if (source === "observation") {
    label.textContent = `[roblox] ${avatarLabel}`
  } else {
    label.textContent = avatarLabel
  }
  div.appendChild(label)

  // AI応答は擬似ストリーム表示（履歴復元時は即表示）
  if (actor === "ai" && text && enableStream) {
    const textNode = document.createTextNode("")
    div.appendChild(textNode)
    messagesEl.appendChild(div)
    messagesEl.scrollTop = messagesEl.scrollHeight
    startLipSync()
    const p = streamText(textNode, text).then(() => stopLipSync())
    currentStreamingPromise = p
    void p
  } else {
    div.appendChild(document.createTextNode(text))
    messagesEl.appendChild(div)
    messagesEl.scrollTop = messagesEl.scrollHeight
  }
}

// === セッション接続（WS経由） ===
// sessionClientはモジュールスコープで保持（submitMessage等からアクセスするため）
let sessionClient: SessionClient | null = null

;(async () => {
  try {
  // 1. FSM遷移を保証（attach完了後にWS接続）
  await window.fieldApi.attach()

  // 2. WS接続情報を取得して接続
  const wsConfig = await window.fieldApi.sessionWsConfig()
  // Electronモード（file://）: ws://localhost:PORT
  // ブラウザHTTP（ローカル）: ws://localhost:PORT
  // ブラウザHTTPS（トンネル経由）: wss://hostname（ポート不要、443経由）
  const wsHost = location.protocol === "file:" ? "localhost" : location.hostname
  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:"
  const wsPort = location.protocol === "https:" ? "" : `:${wsConfig.port}`
  const wsUrl = wsConfig.token
    ? `${wsProtocol}//${wsHost}${wsPort}?token=${wsConfig.token}`
    : `${wsProtocol}//${wsHost}${wsPort}`

  sessionClient = createSessionClient(wsUrl, {
    // session.state: 初回接続時に場の状態+履歴を受信
    onSessionState: (payload) => {
      statusEl.textContent = payload.fieldState
      avatarLabel = `${payload.settings.avatarName.toLowerCase()}>`
      userLabel = `${payload.settings.userName.toLowerCase()}>`

      // Avatarペインのヘッダーとalt属性を更新
      const avatarPaneHeader = document.querySelector("#pane-avatar .pane-header span")
      if (avatarPaneHeader) avatarPaneHeader.textContent = payload.settings.avatarName
      avatarImg.alt = payload.settings.avatarName

      streamPaneInput.ipcEvents = [{ type: "field.state", state: payload.fieldState }]
      updateStreamPaneVisual()

      // 履歴の復元
      const streamItems = payload.history.filter((h) => h.type === "stream")
      if (streamItems.length > 0) {
        enableStream = false
        if (streamingAbort) streamingAbort()
        messagesEl.innerHTML = ""
        for (const m of streamItems) {
          if (m.type === "stream") {
            appendMessage(m.actor, m.text, m.source, m.toolCalls as ToolCallDisplay[], m.channel)
          }
        }
        enableStream = true
      }

      // Roblox Monitor履歴の復元
      const robloxItems = payload.history.filter((h) => h.type === "monitor" && h.channel === "roblox")
      for (const obs of robloxItems) {
        if (obs.type === "monitor") {
          appendObservation(obs.eventType, obs.formatted, obs.timestamp)
        }
      }

      // X Monitor履歴の復元
      const xItems = payload.history.filter((h) => h.type === "monitor" && h.channel === "x")
      for (const ev of xItems) {
        if (ev.type === "monitor") {
          appendXEvent(ev.eventType, ev.formatted, ev.timestamp)
        }
      }

      // pending承認リクエストの復元
      if (payload.pendingApprovals) {
        for (const req of payload.pendingApprovals) {
          renderApprovalRequest(req.requestId, req.toolName, req.args)
        }
      }

      // Spaceペイン初期化（場がアクティブ時）+ Canvas連携
      if (payload.fieldState === "active" && !spaceInitialized) {
        spaceInitialized = true
        initFilesystemPane({
          onFileOpen: (path) => {
            canvas.openFile({ path, actor: "human", origin: "space" }).catch(() => {})
          },
        }).catch(() => { spaceInitialized = false })
      }
    },

    // stream.item: リアルタイムのストリームメッセージ
    onStreamItem: (payload) => {
      removeThinking()
      appendMessage(
        payload.actor,
        payload.displayText ?? payload.text,
        payload.source,
        payload.toolCalls as ToolCallDisplay[],
        payload.channel,
      )

      // AI応答受信時にタイムアウトをクリア + input復帰
      if (payload.correlationId) clearStreamTimeout(payload.correlationId)
      if (payload.actor === "ai") unlockInput()

      if (!streamPaneInput.hasFocus) {
        streamPaneInput.ipcEvents = [
          ...streamPaneInput.ipcEvents.filter((e) => e.type !== "stream.reply"),
          { type: "stream.reply" },
        ]
        updateStreamPaneVisual()
      }

      // デモモード: AI応答完了をストリーミング表示完了後に通知
      if (payload.actor === "ai" && payload.correlationId && streamEndCallback) {
        const cid = payload.correlationId
        void currentStreamingPromise.then(() => {
          streamEndCallback?.(cid)
        })
      }
    },

    // monitor.item: Roblox/Xモニター
    onMonitorItem: (payload) => {
      if (payload.channel === "roblox") {
        appendObservation(payload.eventType, payload.formatted, payload.timestamp)
        robloxPane.dataset.state = "active"
        setTimeout(() => { robloxPane.dataset.state = "normal" }, 3000)
      } else if (payload.channel === "x") {
        appendXEvent(payload.eventType, payload.formatted, payload.timestamp)
        xPane.dataset.state = "active"
        setTimeout(() => { xPane.dataset.state = "normal" }, 3000)
      }
    },

    // approval.requested: ツール承認リクエスト
    onApprovalRequested: (payload) => {
      renderApprovalRequest(payload.requestId, payload.toolName, payload.args)
    },

    // approval.resolved: ツール承認解決（他のクライアントが承認した場合）
    onApprovalResolved: (payload) => {
      const el = document.querySelector(`[data-approval-id="${payload.requestId}"]`) as HTMLElement | null
      if (el && !el.classList.contains("resolved")) {
        el.classList.add("resolved")
        const btns = el.querySelectorAll("button")
        for (const btn of btns) btn.disabled = true
        const resultEl = document.createElement("div")
        resultEl.className = "tool-call-result"
        resultEl.textContent = payload.approved ? t("approved_result") : t("denied_result")
        el.appendChild(resultEl)
      }
    },

    onError: (err) => {
      console.error("[SESSION_WS]", err.message)
    },
  })

  await sessionClient.connect()
  } catch (err) {
    console.error("[SESSION] 初期化失敗:", err)
    statusEl.textContent = `接続失敗: ${err instanceof Error ? err.message : String(err)}`
  }
})()

// stream.reply IPC → WS onStreamItemに移行済み

window.fieldApi.onIntegrityAlert((data) => {
  const alert = data as { code: string; message: string }
  alertBar.textContent = `${alert.code}: ${alert.message}`
  streamPaneInput.ipcEvents = [{ type: "integrity.alert", code: alert.code, message: alert.message }]
  updateStreamPaneVisual()

  // 凍結: 入力を無効化（復帰は再起動）
  inputEl.disabled = true
  formEl.querySelector("button")!.disabled = true
})

// === Roblox Monitorペイン ===
const MAX_OBSERVATION_ENTRIES = 50

function appendObservation(eventType: string, formatted: string, timestamp: string): void {
  const placeholder = robloxBody.querySelector(".pane-placeholder")
  if (placeholder) placeholder.remove()

  const entry = document.createElement("div")
  entry.className = "observation-entry"

  const time = document.createElement("span")
  time.className = "observation-time"
  const d = new Date(timestamp)
  time.textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`

  const tag = document.createElement("span")
  tag.className = `observation-tag observation-tag-${eventType}`
  tag.textContent = eventType

  const text = document.createElement("span")
  text.className = "observation-text"
  text.textContent = formatted

  entry.appendChild(time)
  entry.appendChild(tag)
  entry.appendChild(text)

  robloxBody.appendChild(entry)

  while (robloxBody.children.length > MAX_OBSERVATION_ENTRIES) {
    robloxBody.removeChild(robloxBody.firstChild!)
  }

  robloxBody.scrollTop = robloxBody.scrollHeight
}

// observation.event IPC → WS onMonitorItemに移行済み

// === X Monitorペイン ===
const MAX_X_ENTRIES = 50

function appendXEvent(eventType: string, formatted: string, timestamp: string): void {
  const placeholder = xBody.querySelector(".pane-placeholder")
  if (placeholder) placeholder.remove()

  const entry = document.createElement("div")
  entry.className = "observation-entry"

  const time = document.createElement("span")
  time.className = "observation-time"
  const d = new Date(timestamp)
  time.textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`

  const tag = document.createElement("span")
  tag.className = `observation-tag observation-tag-${eventType}`
  tag.textContent = eventType

  const text = document.createElement("span")
  text.className = "observation-text"
  text.textContent = formatted

  entry.appendChild(time)
  entry.appendChild(tag)
  entry.appendChild(text)

  xBody.appendChild(entry)

  while (xBody.children.length > MAX_X_ENTRIES) {
    xBody.removeChild(xBody.firstChild!)
  }

  xBody.scrollTop = xBody.scrollHeight
}

// x.event IPC → WS onMonitorItemに移行済み

// === ツール承認リクエスト表示（WS onApprovalRequested + session.state復元から呼ばれる） ===
function renderApprovalRequest(requestId: string, toolName: string, args: Record<string, unknown>): void {
  const div = document.createElement("div")
  div.className = "tool-call-approval"
  div.dataset.approvalId = requestId

  const nameEl = document.createElement("span")
  nameEl.className = "tool-call-name"
  nameEl.textContent = toolName

  const argsStr = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ")
  const argsEl = document.createElement("span")
  argsEl.className = "tool-call-args"
  argsEl.textContent = argsStr ? ` ${argsStr}` : ""

  const actionsEl = document.createElement("div")
  actionsEl.className = "tool-call-approval-actions"

  const approveBtn = document.createElement("button")
  approveBtn.className = "btn-approve"
  approveBtn.textContent = t("approve")

  const denyBtn = document.createElement("button")
  denyBtn.className = "btn-deny"
  denyBtn.textContent = t("deny")

  function respond(decision: "approve" | "deny"): void {
    approveBtn.disabled = true
    denyBtn.disabled = true
    div.classList.add("resolved")

    const resultEl = document.createElement("div")
    resultEl.className = "tool-call-result"
    resultEl.textContent = decision === "approve" ? t("approved_result") : t("denied_result")
    div.appendChild(resultEl)

    sessionClient?.sendApprovalRespond(requestId, decision)
  }

  approveBtn.addEventListener("click", () => respond("approve"))
  denyBtn.addEventListener("click", () => respond("deny"))

  actionsEl.appendChild(approveBtn)
  actionsEl.appendChild(denyBtn)
  div.appendChild(nameEl)
  div.appendChild(argsEl)
  div.appendChild(actionsEl)
  messagesEl.appendChild(div)
  messagesEl.scrollTop = messagesEl.scrollHeight
}

// 送信タイムアウト管理（応答がない場合にUI復帰）
const STREAM_TIMEOUT_MS = 30_000
const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

function clearStreamTimeout(correlationId: string): void {
  const tid = pendingTimeouts.get(correlationId)
  if (tid) {
    clearTimeout(tid)
    pendingTimeouts.delete(correlationId)
  }
}

function unlockInput(): void {
  inputEl.disabled = false
  formEl.querySelector("button")!.disabled = false
}

// 送信ロジック（手入力・デモモード共用）
function submitMessage(text: string): string {
  const correlationId = crypto.randomUUID()

  // WS送信（失敗時はUIロックしない）
  const sent = sessionClient?.sendStreamPost(text, correlationId, "human")
  if (!sent) {
    appendMessage("human", text)
    appendMessage("ai", "送信失敗: サーバーとの接続が切れています。ページを再読み込みしてください。")
    return correlationId
  }

  inputEl.value = ""
  inputEl.disabled = true
  formEl.querySelector("button")!.disabled = true

  streamPaneInput.ipcEvents = streamPaneInput.ipcEvents.filter((ev) => ev.type !== "stream.reply")
  updateStreamPaneVisual()

  showThinking()

  // タイムアウト: 30秒以内に応答がなければUI復帰
  const tid = setTimeout(() => {
    pendingTimeouts.delete(correlationId)
    removeThinking()
    unlockInput()
    appendMessage("ai", "応答タイムアウト: サーバーからの応答がありません。")
  }, STREAM_TIMEOUT_MS)
  pendingTimeouts.set(correlationId, tid)

  return correlationId
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault()
  const text = inputEl.value.trim()
  if (!text) return
  submitMessage(text)
})

// === テーマ変更（メニューからのIPC） ===
window.fieldApi.onThemeChange((theme) => {
  if (theme === "classic") {
    document.documentElement.dataset.theme = "classic"
  } else {
    delete document.documentElement.dataset.theme
  }
  localStorage.setItem("aui-theme", theme)
  applyTermTheme()
})

// === 言語変更（メニューからのIPC） ===
window.fieldApi.onLocaleChange((locale) => {
  const current = localStorage.getItem("aui-locale")
  localStorage.setItem("aui-locale", locale)
  if (locale !== current) {
    location.reload()
  }
})

// === デモモード（F5で開始/キャンセル） ===
let streamEndCallback: ((correlationId: string) => void) | null = null

const demoPlayer = new DemoPlayer({
  inputEl,
  sendMessage: (text) => submitMessage(text),
  onStreamEnd: (cb) => { streamEndCallback = cb },
  offStreamEnd: () => { streamEndCallback = null },
})

// stream.reply IPC（デモモード用）→ WS onStreamItemに統合済み

document.addEventListener("keydown", async (e) => {
  if (e.key !== "F5") return
  e.preventDefault()
  e.stopPropagation()

  if (demoPlayer.isRunning) {
    demoPlayer.cancel()
    inputEl.disabled = false
    formEl.querySelector("button")!.disabled = false
    return
  }

  const result = await window.fieldApi.loadDemoScript()
  if (!result.ok) {
    appendMessage("human", `[demo] ${result.error}`)
    return
  }

  demoPlayer.start(result.lines)
}, true) // captureフェーズ（Electronのリロードを抑止）

window.addEventListener("beforeunload", () => {
  sessionClient?.close()
  window.fieldApi.detach()
})

// HTMLのテキストをロケールに合わせて設定
inputEl.placeholder = t("inputPlaceholder")
formEl.querySelector("button")!.textContent = t("send")
statusEl.textContent = t("connecting")
