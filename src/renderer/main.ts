// Renderer エントリー: 3列レイアウト + 縦横スプリッター + ペインD&D入替 + チャット

import { swapPanes, DEFAULT_LAYOUT, GRID_SLOTS } from "./layout-manager.js"
import type { GridSlot } from "./layout-manager.js"
import { normalizeState } from "./state-normalizer.js"
import type { PaneInput } from "./state-normalizer.js"

declare global {
  interface Window {
    fieldApi: {
      attach: () => void
      detach: () => void
      postChat: (text: string, correlationId: string) => void
      terminate: () => void
      onFieldState: (cb: (data: unknown) => void) => void
      onChatReply: (cb: (data: unknown) => void) => void
      onIntegrityAlert: (cb: (data: unknown) => void) => void
      onObservation: (cb: (data: unknown) => void) => void
    }
  }
}

// === DOM参照 ===
const consoleEl = document.getElementById("console") as HTMLDivElement
const statusEl = document.getElementById("field-status") as HTMLSpanElement
const alertBar = document.getElementById("alert-bar") as HTMLDivElement
const messagesEl = document.getElementById("chat-messages") as HTMLDivElement
const formEl = document.getElementById("chat-form") as HTMLFormElement
const inputEl = document.getElementById("chat-input") as HTMLInputElement
const chatPane = document.getElementById("pane-chat") as HTMLDivElement
const robloxPane = document.getElementById("pane-roblox") as HTMLDivElement
const robloxBody = robloxPane.querySelector(".pane-body") as HTMLDivElement
const avatarImg = document.getElementById("avatar-img") as HTMLImageElement

// === レイアウト管理 ===
let currentLayout: GridSlot[][] = DEFAULT_LAYOUT.map((row) => [...row])

// ペイン要素マップ（slot名 → DOM要素）
const paneElements = new Map<GridSlot, HTMLElement>()
for (const slot of GRID_SLOTS) {
  paneElements.set(slot, document.querySelector(`[data-slot="${slot}"]`)!)
}

// 列コンテナ + 列内スプリッター
const columns = [
  document.getElementById("col-0")!,
  document.getElementById("col-1")!,
  document.getElementById("col-2")!,
]
const columnSplitters = columns.map((col) => col.querySelector(".splitter-h")! as HTMLElement)

// 列幅比率 [left, center, right] — 初期 1:2:1
const colRatios = [1, 2, 1]
// 列ごとの行比率 [top, bottom] — 各列独立
const rowRatios: [number, number][] = [
  [1, 1],
  [1, 1],
  [1, 1],
]

const SPLITTER_WIDTH = 4
const MIN_TRACK_PX = 100

function applyColumnWidths(): void {
  consoleEl.style.gridTemplateColumns =
    `${colRatios[0]}fr ${SPLITTER_WIDTH}px ${colRatios[1]}fr ${SPLITTER_WIDTH}px ${colRatios[2]}fr`
}

// 列ごとのペイン高さ比率を適用
function applyRowRatios(): void {
  for (let c = 0; c < 3; c++) {
    const col = columns[c]
    const topPane = col.children[0] as HTMLElement
    const bottomPane = col.children[2] as HTMLElement
    topPane.style.flex = String(rowRatios[c][0])
    bottomPane.style.flex = String(rowRatios[c][1])
  }
}

// レイアウト配列に従ってペインDOMを列に配置
function renderLayout(): void {
  for (let c = 0; c < 3; c++) {
    const col = columns[c]
    const topSlot = currentLayout[0][c]
    const bottomSlot = currentLayout[1][c]
    const topPane = paneElements.get(topSlot)!
    const bottomPane = paneElements.get(bottomSlot)!

    // appendChildはDOMノードを移動する（イベントリスナー保持）
    col.appendChild(topPane)
    col.appendChild(columnSplitters[c])
    col.appendChild(bottomPane)
  }
  applyRowRatios()
}

// 初期レイアウト適用
applyColumnWidths()
applyRowRatios()

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

// === 横スプリッタードラッグ（列ごとの行高さ変更） ===
function initRowSplitter(col: HTMLElement, colIdx: number, splitter: HTMLElement): void {
  splitter.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const topPane = col.children[0] as HTMLElement
    const bottomPane = col.children[2] as HTMLElement
    const startTopH = topPane.getBoundingClientRect().height
    const startBottomH = bottomPane.getBoundingClientRect().height

    splitter.classList.add("dragging")
    document.body.style.cursor = "row-resize"
    document.body.style.userSelect = "none"

    function onMouseMove(ev: MouseEvent): void {
      const dy = ev.clientY - startY
      const combined = startTopH + startBottomH
      const newTopH = Math.max(MIN_TRACK_PX, Math.min(startTopH + dy, combined - MIN_TRACK_PX))
      const newBottomH = combined - newTopH

      rowRatios[colIdx] = [newTopH / combined, newBottomH / combined]
      topPane.style.flex = String(rowRatios[colIdx][0])
      bottomPane.style.flex = String(rowRatios[colIdx][1])
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

for (let c = 0; c < 3; c++) {
  initRowSplitter(columns[c], c, columnSplitters[c])
}

// === ペインD&D入替 ===
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

// === アバター口開閉 ===
let avatarTimer: ReturnType<typeof setTimeout> | null = null

function setAvatarTalking(): void {
  avatarImg.src = "./talk.png"
  if (avatarTimer) clearTimeout(avatarTimer)
  avatarTimer = setTimeout(() => {
    avatarImg.src = "./idle.png"
    avatarTimer = null
  }, 2000)
}

// === 状態管理 ===
let chatPaneInput: PaneInput = { ipcEvents: [], hasFocus: false }

function updateChatPaneVisual(): void {
  const visual = normalizeState(chatPaneInput)
  chatPane.dataset.state = visual.level

  const badgeEl = chatPane.querySelector(".pane-header .badge") as HTMLSpanElement
  if (badgeEl) {
    badgeEl.textContent = visual.badge ?? ""
  }

  if (visual.showAlertBar) {
    alertBar.style.display = "block"
  } else {
    alertBar.style.display = "none"
  }
}

chatPane.addEventListener("focusin", () => {
  chatPaneInput.hasFocus = true
  updateChatPaneVisual()
})
chatPane.addEventListener("focusout", () => {
  chatPaneInput.hasFocus = false
  updateChatPaneVisual()
})

// === チャットUI ===
type ToolCallDisplay = { name: string; args: Record<string, unknown>; result: string }

function appendMessage(
  actor: string,
  text: string,
  source?: string,
  toolCalls?: ToolCallDisplay[],
): void {
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
  if (actor === "human" && source === "observation") {
    label.textContent = "[roblox]"
  } else if (actor === "human" && source === "pulse") {
    label.textContent = "[pulse]"
  } else if (actor === "human") {
    label.textContent = "you>"
  } else if (source === "pulse") {
    label.textContent = "[pulse] spectra>"
  } else if (source === "observation") {
    label.textContent = "[roblox] spectra>"
  } else {
    label.textContent = "spectra>"
  }
  div.appendChild(label)
  div.appendChild(document.createTextNode(text))
  messagesEl.appendChild(div)
  messagesEl.scrollTop = messagesEl.scrollHeight
}

// === IPC接続 ===
window.fieldApi.attach()

window.fieldApi.onFieldState((data) => {
  const msg = data as {
    state: string
    lastMessages?: Array<{
      actor: string
      text: string
      source?: string
      toolCalls?: ToolCallDisplay[]
    }>
  }
  statusEl.textContent = msg.state

  chatPaneInput.ipcEvents = [{ type: "field.state", state: msg.state }]
  updateChatPaneVisual()

  if (msg.lastMessages && msg.lastMessages.length > 0) {
    messagesEl.innerHTML = ""
    for (const m of msg.lastMessages) {
      appendMessage(m.actor, m.text, m.source, m.toolCalls)
    }
  }
})

window.fieldApi.onChatReply((data) => {
  const reply = data as {
    actor: string
    text: string
    source?: string
    toolCalls?: ToolCallDisplay[]
  }
  appendMessage(reply.actor, reply.text, reply.source, reply.toolCalls)

  if (reply.actor === "ai") {
    setAvatarTalking()
  }

  if (!reply.source || reply.source === "user") {
    inputEl.disabled = false
    formEl.querySelector("button")!.disabled = false
  }

  if (!chatPaneInput.hasFocus) {
    chatPaneInput.ipcEvents = [
      ...chatPaneInput.ipcEvents.filter((e) => e.type !== "chat.reply"),
      { type: "chat.reply" },
    ]
    updateChatPaneVisual()
  }
})

window.fieldApi.onIntegrityAlert((data) => {
  const alert = data as { code: string; message: string }
  alertBar.textContent = `${alert.code}: ${alert.message}`
  chatPaneInput.ipcEvents = [{ type: "integrity.alert", code: alert.code, message: alert.message }]
  updateChatPaneVisual()

  inputEl.disabled = false
  formEl.querySelector("button")!.disabled = false
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

window.fieldApi.onObservation((data) => {
  const obs = data as { eventType: string; formatted: string; timestamp: string }
  appendObservation(obs.eventType, obs.formatted, obs.timestamp)

  robloxPane.dataset.state = "active"
  setTimeout(() => {
    robloxPane.dataset.state = "normal"
  }, 3000)
})

formEl.addEventListener("submit", (e) => {
  e.preventDefault()
  const text = inputEl.value.trim()
  if (!text) return

  const correlationId = crypto.randomUUID()
  appendMessage("human", text)
  inputEl.value = ""
  inputEl.disabled = true
  formEl.querySelector("button")!.disabled = true

  chatPaneInput.ipcEvents = chatPaneInput.ipcEvents.filter((ev) => ev.type !== "chat.reply")
  updateChatPaneVisual()

  window.fieldApi.postChat(text, correlationId)
})

window.addEventListener("beforeunload", () => {
  window.fieldApi.detach()
})

statusEl.textContent = "接続中..."
