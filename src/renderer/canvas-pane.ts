// Canvasペイン — CodeMirror 6 エディタ + 画像昇格表示

import { t } from "../shared/i18n.js"
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
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view"
import { EditorState } from "@codemirror/state"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import type { Extension } from "@codemirror/state"
import type { LanguageSupport } from "@codemirror/language"

// --- DOM参照 ---

const titleEl = document.getElementById("canvas-title") as HTMLSpanElement
const emptyEl = document.getElementById("canvas-empty") as HTMLDivElement
const contentEl = document.getElementById("canvas-content") as HTMLDivElement

// --- 状態 ---

let focusState: CanvasFocusState = createCanvasFocusState()

/** 連続クリック対策: 最新リクエストのみ描画 */
let requestToken = 0

/** 現在のCodeMirrorインスタンス */
let editorView: EditorView | null = null

/** 現在開いているファイルパス（保存用） */
let currentFilePath: string | null = null

/** 開いたときの原文（dirty判定用） */
let originalContent: string = ""

/** 未保存の変更があるか */
let isDirty = false

/** ファイルごとのエディタ状態キャッシュ（切り替え時に保持） */
const editorStateCache = new Map<string, { state: EditorState; original: string }>()

// --- 拡張子→言語マッピング ---

function langFromPath(filePath: string): LanguageSupport | null {
  const ext = filePath.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return javascript()
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true })
    case "jsx":
      return javascript({ jsx: true })
    case "tsx":
      return javascript({ jsx: true, typescript: true })
    case "json":
      return json()
    case "md":
    case "markdown":
      return markdown()
    case "css":
      return css()
    case "html":
    case "htm":
      return html()
    default:
      return null
  }
}

// --- CodeMirrorテーマ（CSSカスタムプロパティ連動） ---

const avatarTheme = EditorView.theme({
  "&": {
    fontSize: "var(--font-size)",
    fontFamily: "var(--font-family)",
    backgroundColor: "var(--bg-pane)",
    color: "var(--fg-main)",
    height: "100%",
  },
  ".cm-content": {
    caretColor: "var(--fg-main)",
    fontFamily: "var(--font-family)",
    lineHeight: "var(--line-height)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--fg-main)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-pane)",
    color: "var(--fg-dim)",
    border: "none",
    fontFamily: "var(--font-family)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--bg-pane-alt)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--bg-pane-alt)",
  },
  ".cm-selectionBackground": {
    backgroundColor: "var(--line-default) !important",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--line-default) !important",
  },
  ".cm-line": {
    padding: "0 4px",
  },
})

// --- 保存 ---

async function saveCurrentFile(): Promise<void> {
  if (!currentFilePath || !editorView) return
  const content = editorView.state.doc.toString()
  try {
    await window.fieldApi.fsWrite({ path: currentFilePath, content })
    // 保存後は現在の内容が新しい原文になる
    originalContent = content
    isDirty = false
    updateTitle()
  } catch (err) {
    titleEl.textContent = `${currentFilePath} — ${t("operationError")}`
  }
}

/** タイトル表示を更新（未保存マーカー付き） */
function updateTitle(): void {
  if (!currentFilePath) {
    titleEl.textContent = "Canvas"
    return
  }
  if (isDirty) {
    titleEl.innerHTML = `<span class="canvas-dirty-dot">●</span> ${escapeHtml(currentFilePath)}`
  } else {
    titleEl.textContent = currentFilePath
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// --- エディタ状態の保存/復元 ---

/** 現在のエディタ状態をキャッシュに保存 */
function saveEditorState(): void {
  if (editorView && currentFilePath) {
    editorStateCache.set(currentFilePath, {
      state: editorView.state,
      original: originalContent,
    })
  }
}

// --- エディタ構築 ---

/** エディタ拡張を構築（状態復元時は不要なので分離） */
function buildExtensions(filePath: string): Extension[] {
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLine(),
    history(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      { key: "Mod-s", run: () => { saveCurrentFile(); return true } },
    ]),
    avatarTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        // 現在の内容と原文を比較してdirty判定
        const currentContent = update.state.doc.toString()
        const wasDirty = isDirty
        isDirty = currentContent !== originalContent
        if (wasDirty !== isDirty) updateTitle()
      }
    }),
  ]

  const lang = langFromPath(filePath)
  if (lang) extensions.push(lang)
  return extensions
}

function createEditor(content: string, filePath: string): void {
  // 現在のエディタ状態を保存してから破棄
  saveEditorState()
  if (editorView) {
    editorView.destroy()
    editorView = null
  }

  // キャッシュから復元を試みる
  const cached = editorStateCache.get(filePath)
  if (cached) {
    originalContent = cached.original
    isDirty = cached.state.doc.toString() !== originalContent
    editorView = new EditorView({ state: cached.state, parent: contentEl })
    return
  }

  // 新規作成
  originalContent = content
  const state = EditorState.create({ doc: content, extensions: buildExtensions(filePath) })
  editorView = new EditorView({ state, parent: contentEl })
}

// --- 描画 ---

/** 現在のfocus stateに基づいてCanvasを描画 */
function render(): void {
  const { current } = focusState

  if (!current) {
    emptyEl.hidden = false
    saveEditorState()
    if (editorView) {
      editorView.destroy()
      editorView = null
    }
    contentEl.innerHTML = ""
    currentFilePath = null
    isDirty = false
    titleEl.textContent = "Canvas"
    return
  }

  emptyEl.hidden = true

  if (current.kind === "file") {
    contentEl.innerHTML = ""
    createEditor(current.content, current.path)
    // createEditor内でsaveEditorState()が旧currentFilePathを使うため、更新はその後
    currentFilePath = current.path
    updateTitle()
  } else {
    // 画像表示時はエディタ状態を保存してから破棄
    saveEditorState()
    if (editorView) {
      editorView.destroy()
      editorView = null
    }
    currentFilePath = null
    isDirty = false
    titleEl.textContent = current.alt || "image"
    renderImage(current.imageUrl, current.alt)
  }
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
    err.textContent = `${t("imageLoadError")}: ${url}`
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
        saveEditorState()
        if (editorView) {
          editorView.destroy()
          editorView = null
        }
        contentEl.innerHTML = ""
        emptyEl.hidden = true
        titleEl.textContent = req.path
        const errEl = document.createElement("div")
        errEl.className = "canvas-error"
        errEl.textContent = err instanceof Error ? err.message : t("loadError")
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
