// Renderer エントリー: fieldApiに接続してUI初期化

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
    }
  }
}

const statusEl = document.getElementById("status")!
const messagesEl = document.getElementById("chat-messages")!
const formEl = document.getElementById("chat-form") as HTMLFormElement
const inputEl = document.getElementById("chat-input") as HTMLInputElement

// メッセージを画面に追加
function appendMessage(actor: string, text: string): void {
  const div = document.createElement("div")
  div.className = `message message-${actor}`
  const label = document.createElement("span")
  label.className = "label"
  label.textContent = actor === "human" ? "you>" : "spectra>"
  div.appendChild(label)
  div.appendChild(document.createTextNode(text))
  messagesEl.appendChild(div)
  messagesEl.scrollTop = messagesEl.scrollHeight
}

// 場に接続
window.fieldApi.attach()

// 場の状態を受信（再接続時は直近メッセージ履歴も復元）
window.fieldApi.onFieldState((data) => {
  const msg = data as { state: string; lastMessages?: Array<{ actor: string; text: string }> }
  statusEl.textContent = `場: ${msg.state}`

  // 再接続時: 直近メッセージ履歴を復元
  if (msg.lastMessages && msg.lastMessages.length > 0) {
    messagesEl.innerHTML = ""
    for (const m of msg.lastMessages) {
      appendMessage(m.actor, m.text)
    }
  }
})

// AIの応答を受信
window.fieldApi.onChatReply((data) => {
  const reply = data as { actor: string; text: string }
  appendMessage(reply.actor, reply.text)
  inputEl.disabled = false
  formEl.querySelector("button")!.disabled = false
})

// 異常検知を受信
window.fieldApi.onIntegrityAlert((data) => {
  const alert = data as { code: string; message: string }
  statusEl.textContent = `異常: ${alert.code} — ${alert.message}`
  // エラー時もUI入力を再有効化
  inputEl.disabled = false
  formEl.querySelector("button")!.disabled = false
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

  window.fieldApi.postChat(text, correlationId)
})

// ウィンドウ閉じ時にdetach
window.addEventListener("beforeunload", () => {
  window.fieldApi.detach()
})

statusEl.textContent = "接続中..."
