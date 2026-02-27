// Canvasペイン — ファイル内容表示 + 画像昇格表示

import {
  createCanvasFocusState,
  pushFocus,
} from "./canvas-focus-stack.js"
import type {
  CanvasFocusState,
  CanvasFocusItem,
  CanvasActor,
  CanvasOrigin,
} from "./canvas-focus-stack.js"

// --- DOM参照 ---

const titleEl = document.getElementById("canvas-title") as HTMLSpanElement
const emptyEl = document.getElementById("canvas-empty") as HTMLDivElement
const contentEl = document.getElementById("canvas-content") as HTMLDivElement

// --- 状態 ---

let focusState: CanvasFocusState = createCanvasFocusState()

/** 連続クリック対策: 最新リクエストのみ描画 */
let requestToken = 0

// --- 描画 ---

/** 現在のfocus stateに基づいてCanvasを描画 */
function render(): void {
  const { current } = focusState

  if (!current) {
    emptyEl.hidden = false
    contentEl.innerHTML = ""
    titleEl.textContent = "Canvas"
    return
  }

  emptyEl.hidden = true

  if (current.kind === "file") {
    titleEl.textContent = current.path
    renderFile(current.content)
  } else {
    titleEl.textContent = current.alt || "image"
    renderImage(current.imageUrl, current.alt)
  }
}

/** 行番号付きモノスペースでファイル内容を描画 */
function renderFile(content: string): void {
  const lines = content.split("\n")
  const gutterWidth = Math.max(3, String(lines.length).length)

  const code = document.createElement("div")
  code.className = "canvas-code"

  for (let i = 0; i < lines.length; i++) {
    const row = document.createElement("div")
    row.className = "canvas-code-row"

    const lineNo = document.createElement("span")
    lineNo.className = "canvas-line-no"
    lineNo.style.width = `${gutterWidth}ch`
    lineNo.textContent = String(i + 1)

    const lineText = document.createElement("span")
    lineText.className = "canvas-line-text"
    lineText.textContent = lines[i]

    row.appendChild(lineNo)
    row.appendChild(lineText)
    code.appendChild(row)
  }

  contentEl.innerHTML = ""
  contentEl.appendChild(code)
  contentEl.scrollTop = 0
}

/** 画像を中央に表示 */
function renderImage(url: string, alt: string): void {
  const wrap = document.createElement("div")
  wrap.className = "canvas-image-wrap"

  const img = document.createElement("img")
  img.className = "canvas-image"
  img.src = url
  img.alt = alt
  img.onerror = () => {
    contentEl.innerHTML = ""
    const err = document.createElement("div")
    err.className = "canvas-error"
    err.textContent = `画像読み込みエラー: ${url}`
    contentEl.appendChild(err)
  }

  wrap.appendChild(img)
  contentEl.innerHTML = ""
  contentEl.appendChild(wrap)
}

// --- 公開コントローラ ---

export type CanvasPaneController = {
  openFile: (req: { path: string; actor: CanvasActor; origin: CanvasOrigin }) => Promise<void>
  openImage: (req: { imageUrl: string; alt?: string; actor: CanvasActor; origin: CanvasOrigin }) => void
}

export function initCanvasPane(): CanvasPaneController {
  return {
    async openFile(req) {
      const token = ++requestToken
      try {
        const result = await window.fieldApi.fsRead({ path: req.path })
        if (token !== requestToken) return

        const item: CanvasFocusItem = {
          kind: "file",
          path: req.path,
          content: result.content,
          actor: req.actor,
          origin: req.origin,
          focusedAt: Date.now(),
        }
        focusState = pushFocus(focusState, item)
        render()
      } catch (err) {
        if (token !== requestToken) return
        contentEl.innerHTML = ""
        emptyEl.hidden = true
        titleEl.textContent = req.path
        const errEl = document.createElement("div")
        errEl.className = "canvas-error"
        errEl.textContent = err instanceof Error ? err.message : "読み込みエラー"
        contentEl.appendChild(errEl)
      }
    },

    openImage(req) {
      const item: CanvasFocusItem = {
        kind: "image",
        imageUrl: req.imageUrl,
        alt: req.alt ?? "image",
        actor: req.actor,
        origin: req.origin,
        focusedAt: Date.now(),
      }
      focusState = pushFocus(focusState, item)
      render()
    },
  }
}
