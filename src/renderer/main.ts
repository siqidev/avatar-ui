// Renderer エントリー: 3列レイアウト + スプリッター + チャットペイン

import { calculateColumns, clampRatios } from "./layout-manager.js"
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
const colLeft = document.getElementById("col-left") as HTMLDivElement
const colMain = document.getElementById("col-main") as HTMLDivElement
const colRight = document.getElementById("col-right") as HTMLDivElement
const splitterLeft = document.getElementById("splitter-left") as HTMLDivElement
const splitterRight = document.getElementById("splitter-right") as HTMLDivElement
const statusEl = document.getElementById("field-status") as HTMLSpanElement
const alertBar = document.getElementById("alert-bar") as HTMLDivElement
const messagesEl = document.getElementById("chat-messages") as HTMLDivElement
const formEl = document.getElementById("chat-form") as HTMLFormElement
const inputEl = document.getElementById("chat-input") as HTMLInputElement
const chatPane = document.getElementById("pane-chat") as HTMLDivElement
const robloxPane = document.getElementById("pane-roblox") as HTMLDivElement
const robloxBody = robloxPane.querySelector(".pane-body") as HTMLDivElement

// === レイアウト管理 ===
let currentRatios: [number, number, number] = [0.24, 0.52, 0.24]

function applyLayout(): void {
  const totalWidth = consoleEl.clientWidth
  const cols = calculateColumns(totalWidth, currentRatios)
  colLeft.style.width = `${cols.left}px`
  colMain.style.width = `${cols.main}px`
  colRight.style.width = `${cols.right}px`
  // Grid列をfixed幅に切替
  consoleEl.style.gridTemplateColumns =
    `${cols.left}px var(--splitter-width) ${cols.main}px var(--splitter-width) ${cols.right}px`
}

// 初期レイアウト適用 + リサイズ対応
applyLayout()
window.addEventListener("resize", applyLayout)

// === スプリッタードラッグ ===
function initSplitter(
  splitter: HTMLDivElement,
  side: "left" | "right",
): void {
  let startX = 0
  let startRatios: [number, number, number] = [...currentRatios]

  function onMouseDown(e: MouseEvent): void {
    e.preventDefault()
    startX = e.clientX
    startRatios = [...currentRatios]
    splitter.classList.add("dragging")
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

  function onMouseMove(e: MouseEvent): void {
    const totalWidth = consoleEl.clientWidth - 8 // スプリッター2本分を除く
    const dx = e.clientX - startX
    const dRatio = dx / totalWidth

    const newRatios: [number, number, number] = [...startRatios]
    if (side === "left") {
      newRatios[0] = startRatios[0] + dRatio
      newRatios[1] = startRatios[1] - dRatio
    } else {
      newRatios[1] = startRatios[1] + dRatio
      newRatios[2] = startRatios[2] - dRatio
    }

    currentRatios = clampRatios(newRatios)
    applyLayout()
  }

  function onMouseUp(): void {
    splitter.classList.remove("dragging")
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    document.removeEventListener("mousemove", onMouseMove)
    document.removeEventListener("mouseup", onMouseUp)
  }

  splitter.addEventListener("mousedown", onMouseDown)
}

initSplitter(splitterLeft, "left")
initSplitter(splitterRight, "right")

// === 横スプリッター（ペイン高さ調整） ===
document.querySelectorAll<HTMLDivElement>(".splitter-h").forEach((splitter) => {
  let startY = 0
  let topPane: HTMLElement | null = null
  let bottomPane: HTMLElement | null = null
  let startTopFlex = 0
  let startBottomFlex = 0

  splitter.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault()
    startY = e.clientY
    topPane = splitter.previousElementSibling as HTMLElement
    bottomPane = splitter.nextElementSibling as HTMLElement
    if (!topPane || !bottomPane) return

    startTopFlex = topPane.getBoundingClientRect().height
    startBottomFlex = bottomPane.getBoundingClientRect().height
    splitter.classList.add("dragging")
    document.body.style.cursor = "row-resize"
    document.body.style.userSelect = "none"

    function onMouseMove(e: MouseEvent): void {
      const dy = e.clientY - startY
      const newTop = Math.max(60, startTopFlex + dy)
      const newBottom = Math.max(60, startBottomFlex - dy)
      const total = newTop + newBottom
      topPane!.style.flex = String(newTop / total)
      bottomPane!.style.flex = String(newBottom / total)
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
})

// === 状態管理 ===
let chatPaneInput: PaneInput = { ipcEvents: [], hasFocus: false }

function updateChatPaneVisual(): void {
  const visual = normalizeState(chatPaneInput)
  chatPane.dataset.state = visual.level

  // バッジ更新
  const badgeEl = chatPane.querySelector(".pane-header .badge") as HTMLSpanElement
  if (badgeEl) {
    badgeEl.textContent = visual.badge ?? ""
  }

  // アラートバー
  if (visual.showAlertBar) {
    alertBar.style.display = "block"
  } else {
    alertBar.style.display = "none"
  }
}

// フォーカストラッキング
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

  // ツール呼び出し表示（テキストの前に挿入）
  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      const toolEl = document.createElement("div")
      toolEl.className = "tool-call"
      const nameEl = document.createElement("span")
      nameEl.className = "tool-call-name"
      nameEl.textContent = `${tc.name}`

      // 引数を簡潔に表示
      const argsStr = Object.entries(tc.args)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ")
      const argsEl = document.createElement("span")
      argsEl.className = "tool-call-args"
      argsEl.textContent = argsStr ? ` ${argsStr}` : ""

      // 結果の要約
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

// 場の状態を受信
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

  // 状態正規化器に反映
  chatPaneInput.ipcEvents = [{ type: "field.state", state: msg.state }]
  updateChatPaneVisual()

  // 再接続時: 直近メッセージ履歴を復元
  if (msg.lastMessages && msg.lastMessages.length > 0) {
    messagesEl.innerHTML = ""
    for (const m of msg.lastMessages) {
      appendMessage(m.actor, m.text, m.source, m.toolCalls)
    }
  }
})

// AIの応答を受信
window.fieldApi.onChatReply((data) => {
  const reply = data as {
    actor: string
    text: string
    source?: string
    toolCalls?: ToolCallDisplay[]
  }
  appendMessage(reply.actor, reply.text, reply.source, reply.toolCalls)

  // source=userの場合のみ入力UIを再有効化（Pulse/観測応答では変更しない）
  if (!reply.source || reply.source === "user") {
    inputEl.disabled = false
    formEl.querySelector("button")!.disabled = false
  }

  // 未読ドット（フォーカスがない場合のみ）
  if (!chatPaneInput.hasFocus) {
    chatPaneInput.ipcEvents = [
      ...chatPaneInput.ipcEvents.filter((e) => e.type !== "chat.reply"),
      { type: "chat.reply" },
    ]
    updateChatPaneVisual()
  }
})

// 異常検知を受信
window.fieldApi.onIntegrityAlert((data) => {
  const alert = data as { code: string; message: string }
  alertBar.textContent = `${alert.code}: ${alert.message}`
  chatPaneInput.ipcEvents = [{ type: "integrity.alert", code: alert.code, message: alert.message }]
  updateChatPaneVisual()

  // エラー時もUI入力を再有効化
  inputEl.disabled = false
  formEl.querySelector("button")!.disabled = false
})

// === Roblox Monitorペイン ===
const MAX_OBSERVATION_ENTRIES = 50

function appendObservation(eventType: string, formatted: string, timestamp: string): void {
  // プレースホルダーを初回のみ削除
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

  // 最新を上に追加
  robloxBody.insertBefore(entry, robloxBody.firstChild)

  // 上限を超えたら古い要素を削除
  while (robloxBody.children.length > MAX_OBSERVATION_ENTRIES) {
    robloxBody.removeChild(robloxBody.lastChild!)
  }
}

// 観測イベントを受信
window.fieldApi.onObservation((data) => {
  const obs = data as { eventType: string; formatted: string; timestamp: string }
  appendObservation(obs.eventType, obs.formatted, obs.timestamp)

  // ペインを一時的にactiveに
  robloxPane.dataset.state = "active"
  setTimeout(() => {
    robloxPane.dataset.state = "normal"
  }, 3000)
})

// チャット送信
formEl.addEventListener("submit", (e) => {
  e.preventDefault()
  const text = inputEl.value.trim()
  if (!text) return

  const correlationId = crypto.randomUUID()
  appendMessage("human", text)
  inputEl.value = ""
  inputEl.disabled = true
  formEl.querySelector("button")!.disabled = true

  // 送信時に未読ドットをクリア
  chatPaneInput.ipcEvents = chatPaneInput.ipcEvents.filter((ev) => ev.type !== "chat.reply")
  updateChatPaneVisual()

  window.fieldApi.postChat(text, correlationId)
})

// ウィンドウ閉じ時にdetach
window.addEventListener("beforeunload", () => {
  window.fieldApi.detach()
})

statusEl.textContent = "接続中..."
