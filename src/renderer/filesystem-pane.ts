// File Systemペイン — Avatar Spaceのツリー表示と操作

import type { FsEntry, FsListResult, FsReadResult } from "../shared/fs-schema.js"

// --- DOM参照 ---

const treeEl = document.getElementById("fs-tree") as HTMLDivElement
const errorEl = document.getElementById("fs-error") as HTMLDivElement
const pathDisplay = document.querySelector(".fs-path-display") as HTMLSpanElement
const refreshBtn = document.getElementById("fs-refresh") as HTMLButtonElement
const newFileBtn = document.getElementById("fs-new-file") as HTMLButtonElement
const newFolderBtn = document.getElementById("fs-new-folder") as HTMLButtonElement

// --- 状態 ---

/** 現在表示中のパス */
let currentPath = "."

/** 展開済みディレクトリのセット */
const expandedDirs = new Set<string>()

// --- インライン入力（prompt()代替） ---

/** ツリー内にインライン入力フィールドを表示し、入力値をPromiseで返す */
function showInlineInput(container: HTMLElement, placeholder: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.className = "fs-inline-input"
    input.type = "text"
    input.placeholder = placeholder
    input.value = defaultValue
    container.appendChild(input)
    input.focus()
    input.select()

    let resolved = false
    const finish = (value: string | null) => {
      if (resolved) return
      resolved = true
      input.remove()
      resolve(value)
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const val = input.value.trim()
        finish(val || null)
      } else if (e.key === "Escape") {
        finish(null)
      }
    })
    input.addEventListener("blur", () => finish(null))
  })
}

// --- ファイルツリー ---

/** ディレクトリを読み込んでツリーノードを構築する */
async function loadDir(dirPath: string): Promise<FsListResult | null> {
  try {
    errorEl.textContent = ""
    const result = await window.fieldApi.fsList({ path: dirPath })
    return result
  } catch (err) {
    errorEl.textContent = err instanceof Error ? err.message : "読み込みエラー"
    return null
  }
}

/** エントリ1件のDOM要素を生成する */
function createEntryEl(entry: FsEntry, parentPath: string): HTMLDivElement {
  const entryPath = parentPath === "." ? entry.name : `${parentPath}/${entry.name}`
  const el = document.createElement("div")
  el.className = "fs-entry"
  el.dataset.path = entryPath
  el.dataset.type = entry.type
  if (entry.type === "file") {
    const dotIdx = entry.name.lastIndexOf(".")
    if (dotIdx > 0) el.dataset.ext = entry.name.substring(dotIdx)
  }

  const row = document.createElement("div")
  row.className = "fs-entry-row"

  const icon = document.createElement("span")
  icon.className = "fs-icon"

  if (entry.type === "directory") {
    icon.textContent = expandedDirs.has(entryPath) ? "v " : "> "
  } else {
    icon.textContent = "  "
  }

  const name = document.createElement("span")
  name.className = "fs-name"
  name.textContent = entry.name

  const size = document.createElement("span")
  size.className = "fs-size"
  if (entry.type === "file") {
    size.textContent = formatSize(entry.size)
  }

  row.appendChild(icon)
  row.appendChild(name)
  row.appendChild(size)
  el.appendChild(row)

  // クリックハンドラ
  row.addEventListener("click", () => handleEntryClick(entry, entryPath, el))
  row.addEventListener("mousedown", () => setFocused(entryPath))

  // コンテキストメニュー
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault()
    showContextMenu(e, entry, entryPath)
  })

  // 展開済みディレクトリの子要素を復元
  if (entry.type === "directory" && expandedDirs.has(entryPath)) {
    const children = document.createElement("div")
    children.className = "fs-children"
    el.appendChild(children)
    loadAndRenderChildren(entryPath, children)
  }

  return el
}

/** ディレクトリの子要素を読み込んで描画する */
async function loadAndRenderChildren(dirPath: string, container: HTMLDivElement): Promise<void> {
  const result = await loadDir(dirPath)
  if (!result) return
  container.innerHTML = ""
  for (const entry of result.entries) {
    container.appendChild(createEntryEl(entry, dirPath))
  }
}

/** エントリクリック時の処理 */
async function handleEntryClick(entry: FsEntry, entryPath: string, el: HTMLDivElement): Promise<void> {
  if (entry.type === "directory") {
    // ディレクトリのトグル
    if (expandedDirs.has(entryPath)) {
      expandedDirs.delete(entryPath)
      const children = el.querySelector(".fs-children")
      if (children) children.remove()
      const icon = el.querySelector(".fs-icon")
      if (icon) icon.textContent = "> "
    } else {
      expandedDirs.add(entryPath)
      const icon = el.querySelector(".fs-icon")
      if (icon) icon.textContent = "v "
      const children = document.createElement("div")
      children.className = "fs-children"
      el.appendChild(children)
      await loadAndRenderChildren(entryPath, children)
    }
  } else {
    // ファイル: 選択状態の視覚フィードバック
    treeEl.querySelectorAll(".fs-entry-row.selected").forEach((r) => r.classList.remove("selected"))
    const targetRow = el.querySelector(".fs-entry-row")
    if (targetRow) targetRow.classList.add("selected")
    pathDisplay.textContent = entryPath
  }
}

// --- コンテキストメニュー ---

let activeMenu: HTMLDivElement | null = null

function showContextMenu(e: MouseEvent, entry: FsEntry, entryPath: string): void {
  closeContextMenu()

  const menu = document.createElement("div")
  menu.className = "fs-context-menu"
  menu.style.left = `${e.clientX}px`
  menu.style.top = `${e.clientY}px`

  const items: { label: string; action: () => Promise<void> }[] = []

  if (entry.type === "directory") {
    items.push({
      label: "新規ファイル",
      action: async () => {
        const entryEl = treeEl.querySelector(`[data-path="${CSS.escape(entryPath)}"]`)
        if (!entryEl) return
        const name = await showInlineInput(entryEl as HTMLElement, "ファイル名")
        if (!name) return
        const filePath = `${entryPath}/${name}`
        await window.fieldApi.fsWrite({ path: filePath, content: "" })
        await refreshTree()
      },
    })
    items.push({
      label: "新規フォルダ",
      action: async () => {
        const entryEl = treeEl.querySelector(`[data-path="${CSS.escape(entryPath)}"]`)
        if (!entryEl) return
        const name = await showInlineInput(entryEl as HTMLElement, "フォルダ名")
        if (!name) return
        await window.fieldApi.fsMutate({ op: "mkdir", path: `${entryPath}/${name}` })
        await refreshTree()
      },
    })
  }

  items.push({
    label: "リネーム",
    action: async () => {
      const entryEl = treeEl.querySelector(`[data-path="${CSS.escape(entryPath)}"]`)
      if (!entryEl) return
      const newName = await showInlineInput(entryEl as HTMLElement, "新しい名前", entry.name)
      if (!newName || newName === entry.name) return
      const parentDir = entryPath.includes("/") ? entryPath.substring(0, entryPath.lastIndexOf("/")) : "."
      const newPath = parentDir === "." ? newName : `${parentDir}/${newName}`
      await window.fieldApi.fsMutate({ op: "rename", path: entryPath, newPath })
      await refreshTree()
    },
  })

  items.push({
    label: "削除",
    action: async () => {
      // confirm()代替: メニュー内に確認ボタンを表示
      await window.fieldApi.fsMutate({ op: "delete", path: entryPath })
      expandedDirs.delete(entryPath)
      await refreshTree()
    },
  })

  for (const item of items) {
    const itemEl = document.createElement("div")
    itemEl.className = "fs-context-item"
    itemEl.textContent = item.label
    itemEl.addEventListener("click", async () => {
      closeContextMenu()
      try {
        await item.action()
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : "操作エラー"
      }
    })
    menu.appendChild(itemEl)
  }

  document.body.appendChild(menu)
  activeMenu = menu

  // メニュー外クリックで閉じる
  const closeOnClick = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      closeContextMenu()
      document.removeEventListener("click", closeOnClick)
    }
  }
  setTimeout(() => document.addEventListener("click", closeOnClick), 0)
}

function closeContextMenu(): void {
  if (activeMenu) {
    activeMenu.remove()
    activeMenu = null
  }
}

// --- ユーティリティ ---

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

// --- キーボードナビゲーション ---

let focusedPath: string | null = null

function setFocused(path: string | null): void {
  treeEl.querySelectorAll(".fs-entry-row.focused").forEach((r) => r.classList.remove("focused"))
  focusedPath = path
  if (!path) return
  const entry = treeEl.querySelector(`[data-path="${CSS.escape(path)}"]`)
  const row = entry?.querySelector(".fs-entry-row") as HTMLDivElement | null
  if (row) {
    row.classList.add("focused")
    row.scrollIntoView({ block: "nearest" })
  }
}

/** フォーカス中のディレクトリパスを返す（なければルート） */
function getTargetDir(): string {
  if (!focusedPath) return "."
  const entry = treeEl.querySelector(`[data-path="${CSS.escape(focusedPath)}"]`) as HTMLDivElement | null
  if (entry?.dataset.type === "directory") return focusedPath
  return focusedPath.includes("/") ? focusedPath.substring(0, focusedPath.lastIndexOf("/")) : "."
}

function getEntryContainer(path: string): HTMLElement | null {
  return treeEl.querySelector(`[data-path="${CSS.escape(path)}"]`)
}

/** リネーム開始（Enter/F2共通） */
function triggerRename(): void {
  if (!focusedPath) return
  const el = treeEl.querySelector(`[data-path="${CSS.escape(focusedPath)}"]`) as HTMLDivElement
  if (!el) return
  const currentName = focusedPath.includes("/")
    ? focusedPath.substring(focusedPath.lastIndexOf("/") + 1)
    : focusedPath
  const fp = focusedPath
  showInlineInput(el, "新しい名前", currentName).then(async (newName) => {
    if (!newName || newName === currentName) return
    const parentDir = fp.includes("/") ? fp.substring(0, fp.lastIndexOf("/")) : "."
    const newPath = parentDir === "." ? newName : `${parentDir}/${newName}`
    try {
      await window.fieldApi.fsMutate({ op: "rename", path: fp, newPath })
      focusedPath = null
      await refreshTree()
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : "リネームエラー"
    }
  })
}

function handleTreeKeydown(e: KeyboardEvent): void {
  // インライン入力中はツリー操作を無効化
  if ((e.target as HTMLElement).tagName === "INPUT") return

  const entries = Array.from(treeEl.querySelectorAll(".fs-entry")) as HTMLDivElement[]
  if (entries.length === 0) return
  const currentIndex = focusedPath
    ? entries.findIndex((el) => el.dataset.path === focusedPath)
    : -1

  switch (e.key) {
    case "ArrowDown": {
      e.preventDefault()
      const next = currentIndex < entries.length - 1 ? currentIndex + 1 : 0
      setFocused(entries[next].dataset.path || null)
      break
    }
    case "ArrowUp": {
      e.preventDefault()
      const prev = currentIndex > 0 ? currentIndex - 1 : entries.length - 1
      setFocused(entries[prev].dataset.path || null)
      break
    }
    case "ArrowRight": {
      if (!focusedPath) break
      const el = treeEl.querySelector(`[data-path="${CSS.escape(focusedPath)}"]`) as HTMLDivElement
      if (el?.dataset.type === "directory" && !expandedDirs.has(focusedPath)) {
        e.preventDefault()
        const row = el.querySelector(".fs-entry-row") as HTMLDivElement
        if (row) row.click()
      }
      break
    }
    case "ArrowLeft": {
      if (!focusedPath) break
      e.preventDefault()
      const el = treeEl.querySelector(`[data-path="${CSS.escape(focusedPath)}"]`) as HTMLDivElement
      if (el?.dataset.type === "directory" && expandedDirs.has(focusedPath)) {
        const row = el.querySelector(".fs-entry-row") as HTMLDivElement
        if (row) row.click()
      } else if (focusedPath.includes("/")) {
        const parentPath = focusedPath.substring(0, focusedPath.lastIndexOf("/"))
        setFocused(parentPath)
      }
      break
    }
    case "Enter":
    case "F2": {
      if (!focusedPath) break
      e.preventDefault()
      triggerRename()
      break
    }
    case "Backspace": {
      // macOS: Cmd+Backspace（VSCode準拠）
      if (!focusedPath || !e.metaKey) break
      e.preventDefault()
      const pathToDeleteMac = focusedPath
      window.fieldApi
        .fsMutate({ op: "delete", path: pathToDeleteMac })
        .then(() => {
          expandedDirs.delete(pathToDeleteMac)
          focusedPath = null
          return refreshTree()
        })
        .catch((err: unknown) => {
          errorEl.textContent = err instanceof Error ? err.message : "削除エラー"
        })
      break
    }
    case "Delete": {
      // Windows/Linux: Deleteキー単体（VSCode準拠）
      if (!focusedPath) break
      e.preventDefault()
      const pathToDelete = focusedPath
      window.fieldApi
        .fsMutate({ op: "delete", path: pathToDelete })
        .then(() => {
          expandedDirs.delete(pathToDelete)
          focusedPath = null
          return refreshTree()
        })
        .catch((err: unknown) => {
          errorEl.textContent = err instanceof Error ? err.message : "削除エラー"
        })
      break
    }
  }
}

// --- 公開API ---

/** ツリー全体をリフレッシュ（ルートから再描画） */
export async function refreshTree(): Promise<void> {
  const result = await loadDir(currentPath)
  if (!result) return
  treeEl.innerHTML = ""
  for (const entry of result.entries) {
    treeEl.appendChild(createEntryEl(entry, currentPath))
  }
}

/** 初期化 — ルートディレクトリを読み込む + リフレッシュボタン接続 */
export async function initFilesystemPane(): Promise<void> {
  const rootName = await window.fieldApi.fsRootName()
  pathDisplay.textContent = rootName + "/"
  refreshBtn.addEventListener("click", () => refreshTree())

  // ヘッダーボタン: ルートまたはフォーカス中ディレクトリに作成
  newFileBtn.addEventListener("click", async () => {
    const targetDir = getTargetDir()
    const container = targetDir === "." ? treeEl : getEntryContainer(targetDir)
    if (!container) return
    const name = await showInlineInput(container, "ファイル名")
    if (!name) return
    const filePath = targetDir === "." ? name : `${targetDir}/${name}`
    try {
      await window.fieldApi.fsWrite({ path: filePath, content: "" })
      await refreshTree()
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : "作成エラー"
    }
  })

  newFolderBtn.addEventListener("click", async () => {
    const targetDir = getTargetDir()
    const container = targetDir === "." ? treeEl : getEntryContainer(targetDir)
    if (!container) return
    const name = await showInlineInput(container, "フォルダ名")
    if (!name) return
    const dirPath = targetDir === "." ? name : `${targetDir}/${name}`
    try {
      await window.fieldApi.fsMutate({ op: "mkdir", path: dirPath })
      await refreshTree()
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : "作成エラー"
    }
  })

  // キーボードナビゲーション
  treeEl.tabIndex = 0
  treeEl.addEventListener("keydown", handleTreeKeydown)

  await refreshTree()
}
