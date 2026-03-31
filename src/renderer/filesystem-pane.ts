// Spaceペイン — Avatar Spaceのツリー表示と操作

import { t } from "../shared/i18n.js"
import type { FsEntry, FsListResult } from "../shared/fs-schema.js"
import {
  getBaseName,
  getParentDir,
  joinPath,
  rewritePathPrefix,
  validateTreeMove,
} from "./filesystem-dnd.js"

export type FilesystemPaneOptions = {
  onFileOpen?: (path: string) => void
}

// --- DOM参照 ---

const treeEl = document.getElementById("fs-tree") as HTMLDivElement
const treePaneBodyEl = treeEl.parentElement as HTMLDivElement
const errorEl = document.getElementById("fs-error") as HTMLDivElement
const spaceLabel = document.getElementById("space-label") as HTMLSpanElement
const refreshBtn = document.getElementById("fs-refresh") as HTMLButtonElement
const newFileBtn = document.getElementById("fs-new-file") as HTMLButtonElement
const newFolderBtn = document.getElementById("fs-new-folder") as HTMLButtonElement

// --- 状態 ---

let paneOptions: FilesystemPaneOptions = {}

/** 現在表示中のパス */
let currentPath = "."

/** 展開済みディレクトリのセット */
const expandedDirs = new Set<string>()

/** ファイルツリー内クリップボード（切り取り/コピー） */
let clipboard: { path: string; mode: "cut" | "copy" } | null = null

// macOS: Cmd (metaKey), Windows/Linux: Ctrl (ctrlKey) — VSCode準拠
const isMac = navigator.platform.toUpperCase().includes("MAC")
function modKey(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey
}

// --- Undo/Redo ---

type UndoEntry =
  | { type: "rename"; from: string; to: string }
  | { type: "delete"; path: string }

const undoStack: UndoEntry[] = []
const redoStack: UndoEntry[] = []
const MAX_UNDO = 50
const INTERNAL_FS_DND_MIME = "application/x-aui-fs-path"

function pushUndo(entry: UndoEntry): void {
  undoStack.push(entry)
  if (undoStack.length > MAX_UNDO) undoStack.shift()
  redoStack.length = 0
}

function reverseEntry(entry: UndoEntry): UndoEntry {
  switch (entry.type) {
    case "rename": return { type: "rename", from: entry.to, to: entry.from }
    case "delete": return { type: "delete", path: entry.path }
  }
}

async function executeUndoEntry(entry: UndoEntry): Promise<void> {
  switch (entry.type) {
    case "rename":
      await window.fieldApi.fsMutate({ op: "rename", path: entry.from, newPath: entry.to })
      syncTrackedPaths(entry.from, entry.to)
      break
    case "delete":
      await window.fieldApi.fsMutate({ op: "delete", path: entry.path })
      clearTrackedPaths(entry.path)
      break
  }
}

async function undo(): Promise<void> {
  const entry = undoStack.pop()
  if (!entry) return
  const reversed = reverseEntry(entry)
  await executeUndoEntry(reversed)
  redoStack.push(entry)
  await refreshTree()
}

async function redo(): Promise<void> {
  const entry = redoStack.pop()
  if (!entry) return
  await executeUndoEntry(entry)
  undoStack.push(entry)
  await refreshTree()
}

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

/** ツリー内 D&D を無効化すべき状態か */
function isTreeDnDDisabled(): boolean {
  return activeMenu !== null || treePaneBodyEl.querySelector(".fs-inline-input") !== null
}

// --- ファイルツリー ---

/** ディレクトリを読み込んでツリーノードを構築する */
async function loadDir(dirPath: string): Promise<FsListResult | null> {
  try {
    errorEl.textContent = ""
    const result = await window.fieldApi.fsList({ path: dirPath })
    return result
  } catch (err) {
    errorEl.textContent = err instanceof Error ? err.message : t("loadError")
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
  row.draggable = true

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

  row.appendChild(icon)
  row.appendChild(name)
  el.appendChild(row)

  // クリックハンドラ
  row.addEventListener("click", () => handleEntryClick(entry, entryPath, el))
  row.addEventListener("mousedown", () => setFocused(entryPath))
  row.addEventListener("dragstart", (e) => handleInternalDragStart(e, entryPath, row))
  row.addEventListener("dragend", () => clearDragFeedback())

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
    // ファイル: 選択状態の視覚フィードバック + Canvas連携
    treeEl.querySelectorAll(".fs-entry-row.selected").forEach((r) => r.classList.remove("selected"))
    const targetRow = el.querySelector(".fs-entry-row")
    if (targetRow) targetRow.classList.add("selected")
    paneOptions.onFileOpen?.(entryPath)
  }
}

// --- コンテキストメニュー ---

let activeMenu: HTMLDivElement | null = null

type MenuItem = { type: "item"; label: string; action: () => Promise<void> } | { type: "separator" }

function showContextMenu(e: MouseEvent, entry: FsEntry, entryPath: string): void {
  closeContextMenu()

  const menu = document.createElement("div")
  menu.className = "fs-context-menu"
  menu.style.left = `${e.clientX}px`
  menu.style.top = `${e.clientY}px`

  const items: MenuItem[] = []

  // --- フォルダ専用: 新規作成 ---
  if (entry.type === "directory") {
    items.push({
      type: "item",
      label: t("newFile"),
      action: async () => {
        const entryEl = treeEl.querySelector(`[data-path="${CSS.escape(entryPath)}"]`)
        if (!entryEl) return
        const name = await showInlineInput(entryEl as HTMLElement, t("fileName"))
        if (!name) return
        const filePath = `${entryPath}/${name}`
        await window.fieldApi.fsWrite({ path: filePath, content: "" })
        pushUndo({ type: "delete", path: filePath })
        await refreshTree()
      },
    })
    items.push({
      type: "item",
      label: t("newFolder"),
      action: async () => {
        const entryEl = treeEl.querySelector(`[data-path="${CSS.escape(entryPath)}"]`)
        if (!entryEl) return
        const name = await showInlineInput(entryEl as HTMLElement, t("folderName"))
        if (!name) return
        const dirPath = `${entryPath}/${name}`
        await window.fieldApi.fsMutate({ op: "mkdir", path: dirPath })
        pushUndo({ type: "delete", path: dirPath })
        await refreshTree()
      },
    })
    items.push({ type: "separator" })
  }

  // --- 切り取り・コピー・貼り付け ---
  items.push({
    type: "item",
    label: t("cut"),
    action: async () => {
      clipboard = { path: entryPath, mode: "cut" }
    },
  })
  items.push({
    type: "item",
    label: t("copy"),
    action: async () => {
      clipboard = { path: entryPath, mode: "copy" }
    },
  })
  items.push({
    type: "item",
    label: t("paste"),
    action: async () => {
      await executePaste(entry.type === "directory" ? entryPath : getParentDir(entryPath))
    },
  })
  items.push({ type: "separator" })

  // --- パスのコピー ---
  items.push({
    type: "item",
    label: t("copyPath"),
    action: async () => {
      await navigator.clipboard.writeText(entryPath)
    },
  })
  items.push({
    type: "item",
    label: t("copyRelativePath"),
    action: async () => {
      await navigator.clipboard.writeText(entryPath)
    },
  })
  items.push({ type: "separator" })

  // --- 名前の変更・削除 ---
  items.push({
    type: "item",
    label: t("rename"),
    action: async () => {
      const entryEl = treeEl.querySelector(`[data-path="${CSS.escape(entryPath)}"]`)
      if (!entryEl) return
      const newName = await showInlineInput(entryEl as HTMLElement, t("newName"), entry.name)
      if (!newName || newName === entry.name) return
      const parentDir = getParentDir(entryPath)
      const newPath = joinPath(parentDir, newName)
      await window.fieldApi.fsMutate({ op: "rename", path: entryPath, newPath })
      pushUndo({ type: "rename", from: entryPath, to: newPath })
      syncTrackedPaths(entryPath, newPath)
      await refreshTree()
    },
  })
  items.push({
    type: "item",
    label: t("delete"),
    action: async () => {
      await window.fieldApi.fsMutate({ op: "delete", path: entryPath })
      clearTrackedPaths(entryPath)
      await refreshTree()
    },
  })

  for (const item of items) {
    if (item.type === "separator") {
      const sep = document.createElement("div")
      sep.className = "fs-context-separator"
      menu.appendChild(sep)
      continue
    }
    const itemEl = document.createElement("div")
    itemEl.className = "fs-context-item"
    itemEl.textContent = item.label
    itemEl.addEventListener("click", async () => {
      closeContextMenu()
      try {
        await item.action()
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : t("operationError")
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

/** ツリー背景（エントリ外）の右クリックメニュー */
function showTreeBackgroundMenu(e: MouseEvent): void {
  closeContextMenu()

  const menu = document.createElement("div")
  menu.className = "fs-context-menu"
  menu.style.left = `${e.clientX}px`
  menu.style.top = `${e.clientY}px`

  const items: MenuItem[] = [
    {
      type: "item",
      label: t("newFile"),
      action: async () => {
        const name = await showInlineInput(treeEl, t("fileName"))
        if (!name) return
        await window.fieldApi.fsWrite({ path: name, content: "" })
        pushUndo({ type: "delete", path: name })
        await refreshTree()
      },
    },
    {
      type: "item",
      label: t("newFolder"),
      action: async () => {
        const name = await showInlineInput(treeEl, t("folderName"))
        if (!name) return
        await window.fieldApi.fsMutate({ op: "mkdir", path: name })
        pushUndo({ type: "delete", path: name })
        await refreshTree()
      },
    },
  ]

  if (clipboard) {
    items.push({ type: "separator" })
    items.push({
      type: "item",
      label: t("paste"),
      action: async () => {
        await executePaste(".")
      },
    })
  }

  for (const item of items) {
    if (item.type === "separator") {
      const sep = document.createElement("div")
      sep.className = "fs-context-separator"
      menu.appendChild(sep)
      continue
    }
    const itemEl = document.createElement("div")
    itemEl.className = "fs-context-item"
    itemEl.textContent = item.label
    itemEl.addEventListener("click", async () => {
      closeContextMenu()
      try {
        await item.action()
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : t("operationError")
      }
    })
    menu.appendChild(itemEl)
  }

  document.body.appendChild(menu)
  activeMenu = menu

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

/** 追跡中のパス状態を移動先へ追従させる */
function syncTrackedPaths(fromPath: string, toPath: string): void {
  const nextExpandedDirs = new Set<string>()
  for (const dirPath of expandedDirs) {
    nextExpandedDirs.add(rewritePathPrefix(dirPath, fromPath, toPath))
  }
  expandedDirs.clear()
  for (const dirPath of nextExpandedDirs) expandedDirs.add(dirPath)

  if (focusedPath) {
    focusedPath = rewritePathPrefix(focusedPath, fromPath, toPath)
  }

  if (clipboard) {
    clipboard = {
      ...clipboard,
      path: rewritePathPrefix(clipboard.path, fromPath, toPath),
    }
  }
}

/** 削除されたパス配下の追跡状態を破棄する */
function clearTrackedPaths(targetPath: string): void {
  const targetPrefix = `${targetPath}/`
  for (const dirPath of Array.from(expandedDirs)) {
    if (dirPath === targetPath || dirPath.startsWith(targetPrefix)) {
      expandedDirs.delete(dirPath)
    }
  }

  if (focusedPath === targetPath || focusedPath?.startsWith(targetPrefix)) {
    focusedPath = null
  }

  if (clipboard && (clipboard.path === targetPath || clipboard.path.startsWith(targetPrefix))) {
    clipboard = null
  }
}

let dragSourceRow: HTMLDivElement | null = null
let dragTargetRow: HTMLDivElement | null = null

function clearDragFeedback(): void {
  dragSourceRow?.classList.remove("drag-source")
  dragSourceRow = null
  dragTargetRow?.classList.remove("drag-target-valid")
  dragTargetRow = null
  treePaneBodyEl.classList.remove("fs-drop-root-valid")
}

function resolveDropTarget(target: EventTarget | null): { dirPath: string; dirRow: HTMLDivElement | null } {
  const targetEl = target instanceof HTMLElement ? target : null
  const row = targetEl?.closest(".fs-entry-row") as HTMLDivElement | null
  if (!row) return { dirPath: ".", dirRow: null }

  const entryEl = row.closest(".fs-entry") as HTMLDivElement | null
  if (!entryEl?.dataset.path) return { dirPath: ".", dirRow: null }

  if (entryEl.dataset.type === "directory") {
    return { dirPath: entryEl.dataset.path, dirRow: row }
  }

  // ファイル行 → 親フォルダに解決し、親フォルダの行をハイライト対象にする
  const parentDir = getParentDir(entryEl.dataset.path)
  const parentEntry = parentDir === "."
    ? null
    : treeEl.querySelector(`[data-path="${CSS.escape(parentDir)}"]`) as HTMLDivElement | null
  const parentRow = parentEntry?.querySelector(".fs-entry-row") as HTMLDivElement | null ?? null
  return { dirPath: parentDir, dirRow: parentRow }
}

function applyDropFeedback(dirRow: HTMLDivElement | null, valid: boolean): void {
  dragTargetRow?.classList.remove("drag-target-valid")
  dragTargetRow = null
  treePaneBodyEl.classList.remove("fs-drop-root-valid")

  if (!valid) return

  if (dirRow) {
    dragTargetRow = dirRow
    dragTargetRow.classList.add("drag-target-valid")
  } else {
    treePaneBodyEl.classList.add("fs-drop-root-valid")
  }
}

function isInternalDrag(dt: DataTransfer | null): boolean {
  return dt ? Array.from(dt.types).includes(INTERNAL_FS_DND_MIME) : false
}

function hasExternalFiles(dt: DataTransfer | null): boolean {
  return dt ? Array.from(dt.types).includes("Files") : false
}

function getExternalFilePaths(dt: DataTransfer): string[] {
  return Array.from(dt.files)
    .map((f) => window.fieldApi.getFilePath(f))
    .filter((p) => p.length > 0)
}

function handleInternalDragStart(event: DragEvent, sourcePath: string, row: HTMLDivElement): void {
  if (!event.dataTransfer || isTreeDnDDisabled()) {
    event.preventDefault()
    return
  }
  dragSourceRow = row
  dragSourceRow.classList.add("drag-source")
  event.dataTransfer.setData(INTERNAL_FS_DND_MIME, sourcePath)
  event.dataTransfer.setData("text/plain", sourcePath)
  event.dataTransfer.effectAllowed = "move"
}

function handleTreeDragOver(event: DragEvent): void {
  const dt = event.dataTransfer
  if (!dt) return
  if (!isInternalDrag(dt) && !hasExternalFiles(dt)) return

  event.preventDefault()

  if (isTreeDnDDisabled()) {
    dt.dropEffect = "none"
    applyDropFeedback(null, false)
    return
  }

  const { dirPath, dirRow } = resolveDropTarget(event.target)

  if (isInternalDrag(dt)) {
    const sourcePath = dt.getData(INTERNAL_FS_DND_MIME)
    const valid = validateTreeMove(sourcePath, dirPath).ok
    dt.dropEffect = valid ? "move" : "none"
    applyDropFeedback(dirRow, valid)
    return
  }

  dt.dropEffect = "copy"
  applyDropFeedback(dirRow, true)
}

function handleTreeDragLeave(event: DragEvent): void {
  const next = document.elementFromPoint(event.clientX, event.clientY)
  if (next && treePaneBodyEl.contains(next)) return
  clearDragFeedback()
}

async function handleTreeDrop(event: DragEvent): Promise<void> {
  const dt = event.dataTransfer
  if (!dt) return

  const internal = isInternalDrag(dt)
  if (!internal && !hasExternalFiles(dt)) return

  event.preventDefault()
  clearDragFeedback()
  if (isTreeDnDDisabled()) return

  const { dirPath } = resolveDropTarget(event.target)

  try {
    if (internal) {
      const sourcePath = dt.getData(INTERNAL_FS_DND_MIME)
      const validation = validateTreeMove(sourcePath, dirPath)
      if (!validation.ok) return
      if (await existsInDir(dirPath, getBaseName(sourcePath))) return
      await window.fieldApi.fsMutate({ op: "rename", path: sourcePath, newPath: validation.destPath })
      syncTrackedPaths(sourcePath, validation.destPath)
      pushUndo({ type: "rename", from: sourcePath, to: validation.destPath })
    } else {
      const externalPaths = getExternalFilePaths(dt)
      for (const src of externalPaths) {
        const dest = joinPath(dirPath, getBaseName(src))
        await window.fieldApi.fsImportFile({ sourcePath: src, destPath: dest })
      }
    }
    await refreshTree()
  } catch (err) {
    errorEl.textContent = err instanceof Error ? err.message : t("operationError")
  }
}

/** コピー先のパスを生成する（同名が存在する場合は "name copy.ext" にリネーム） */
async function resolveDestPath(destDir: string, srcPath: string): Promise<string> {
  const name = getBaseName(srcPath)
  const basePath = destDir === "." ? name : `${destDir}/${name}`

  // 同じディレクトリへのコピー or 同名ファイルが存在する場合
  const srcDir = getParentDir(srcPath)
  if (srcDir === destDir || await existsInDir(destDir, name)) {
    const dotIdx = name.lastIndexOf(".")
    const stem = dotIdx > 0 ? name.substring(0, dotIdx) : name
    const ext = dotIdx > 0 ? name.substring(dotIdx) : ""
    const copyName = `${stem} copy${ext}`
    return destDir === "." ? copyName : `${destDir}/${copyName}`
  }
  return basePath
}

/** ディレクトリ内に指定名のエントリが存在するか確認 */
async function existsInDir(dirPath: string, name: string): Promise<boolean> {
  try {
    const result = await window.fieldApi.fsList({ path: dirPath })
    return result.entries.some((e) => e.name === name)
  } catch {
    return false
  }
}

/** 貼り付け実行（切り取り=移動、コピー=複製） */
async function executePaste(destDir: string): Promise<void> {
  if (!clipboard) return
  if (clipboard.mode === "cut") {
    const srcPath = clipboard.path
    const validation = validateTreeMove(srcPath, destDir)
    if (!validation.ok) return
    if (await existsInDir(destDir, getBaseName(srcPath))) return
    await window.fieldApi.fsMutate({ op: "rename", path: srcPath, newPath: validation.destPath })
    syncTrackedPaths(srcPath, validation.destPath)
    pushUndo({ type: "rename", from: srcPath, to: validation.destPath })
    clipboard = null
  } else {
    const destPath = await resolveDestPath(destDir, clipboard.path)
    await window.fieldApi.fsMutate({ op: "copy", path: clipboard.path, destPath })
    pushUndo({ type: "delete", path: destPath })
  }
  await refreshTree()
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
  return getParentDir(focusedPath)
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
  showInlineInput(el, t("newName"), currentName).then(async (newName) => {
    if (!newName || newName === currentName) return
    const parentDir = getParentDir(fp)
    const newPath = joinPath(parentDir, newName)
    try {
      await window.fieldApi.fsMutate({ op: "rename", path: fp, newPath })
      pushUndo({ type: "rename", from: fp, to: newPath })
      syncTrackedPaths(fp, newPath)
      await refreshTree()
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : t("renameError")
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
      // VSCode準拠: Enter/F2 → リネーム
      if (!focusedPath) break
      e.preventDefault()
      triggerRename()
      break
    }
    case " ": {
      // VSCode準拠: Space → ファイルを開く / フォルダを展開・折りたたみ
      if (!focusedPath) break
      e.preventDefault()
      const spaceEl = treeEl.querySelector(`[data-path="${CSS.escape(focusedPath)}"]`) as HTMLDivElement
      if (!spaceEl) break
      const spaceRow = spaceEl.querySelector(".fs-entry-row") as HTMLDivElement
      if (spaceRow) spaceRow.click()
      break
    }
    case "z": {
      if (!modKey(e)) break
      e.preventDefault()
      if (e.shiftKey) {
        // Cmd/Ctrl+Shift+Z: やり直し
        redo().catch((err: unknown) => {
          errorEl.textContent = err instanceof Error ? err.message : t("operationError")
        })
      } else {
        // Cmd/Ctrl+Z: 元に戻す
        undo().catch((err: unknown) => {
          errorEl.textContent = err instanceof Error ? err.message : t("operationError")
        })
      }
      break
    }
    case "x": {
      // Cmd/Ctrl+X: 切り取り
      if (!focusedPath || !modKey(e)) break
      e.preventDefault()
      clipboard = { path: focusedPath, mode: "cut" }
      break
    }
    case "c": {
      // Cmd/Ctrl+C: コピー
      if (!focusedPath || !modKey(e)) break
      e.preventDefault()
      clipboard = { path: focusedPath, mode: "copy" }
      break
    }
    case "v": {
      // Cmd/Ctrl+V: 貼り付け
      if (!modKey(e) || !clipboard) break
      e.preventDefault()
      const pasteDir = getTargetDir()
      executePaste(pasteDir).catch((err: unknown) => {
        errorEl.textContent = err instanceof Error ? err.message : t("operationError")
      })
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
          clearTrackedPaths(pathToDeleteMac)
          return refreshTree()
        })
        .catch((err: unknown) => {
          errorEl.textContent = err instanceof Error ? err.message : t("deleteError")
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
          clearTrackedPaths(pathToDelete)
          return refreshTree()
        })
        .catch((err: unknown) => {
          errorEl.textContent = err instanceof Error ? err.message : t("deleteError")
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
  setFocused(focusedPath)
}

/** 初期化 — ルートディレクトリを読み込む + リフレッシュボタン接続 */
export async function initFilesystemPane(options?: FilesystemPaneOptions): Promise<void> {
  if (options) paneOptions = options
  const rootName = await window.fieldApi.fsRootName()
  spaceLabel.textContent = "/" + rootName
  refreshBtn.addEventListener("click", () => refreshTree())

  // ヘッダーボタン: ルートまたはフォーカス中ディレクトリに作成
  newFileBtn.addEventListener("click", async () => {
    const targetDir = getTargetDir()
    const container = targetDir === "." ? treeEl : getEntryContainer(targetDir)
    if (!container) return
    const name = await showInlineInput(container, t("fileName"))
    if (!name) return
    const filePath = targetDir === "." ? name : `${targetDir}/${name}`
    try {
      await window.fieldApi.fsWrite({ path: filePath, content: "" })
      pushUndo({ type: "delete", path: filePath })
      await refreshTree()
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : t("createError")
    }
  })

  newFolderBtn.addEventListener("click", async () => {
    const targetDir = getTargetDir()
    const container = targetDir === "." ? treeEl : getEntryContainer(targetDir)
    if (!container) return
    const name = await showInlineInput(container, t("folderName"))
    if (!name) return
    const dirPath = targetDir === "." ? name : `${targetDir}/${name}`
    try {
      await window.fieldApi.fsMutate({ op: "mkdir", path: dirPath })
      pushUndo({ type: "delete", path: dirPath })
      await refreshTree()
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : t("createError")
    }
  })

  // キーボードナビゲーション
  treeEl.tabIndex = 0
  treeEl.addEventListener("keydown", handleTreeKeydown)
  treePaneBodyEl.addEventListener("dragover", handleTreeDragOver)
  treePaneBodyEl.addEventListener("dragleave", handleTreeDragLeave)
  treePaneBodyEl.addEventListener("drop", (event) => {
    void handleTreeDrop(event)
  })
  document.addEventListener("dragend", clearDragFeedback)
  document.addEventListener("drop", clearDragFeedback)

  // ツリー背景の右クリック（エントリ外の空白部分）
  treePaneBodyEl.addEventListener("contextmenu", (e) => {
    // エントリ上の右クリックはエントリ側で処理済み
    if ((e.target as HTMLElement).closest(".fs-entry-row")) return
    e.preventDefault()
    showTreeBackgroundMenu(e)
  })

  await refreshTree()
}
