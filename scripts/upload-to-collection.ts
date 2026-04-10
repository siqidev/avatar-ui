#!/usr/bin/env npx tsx
// Collections知識同期スクリプト
// 指定ファイルをxAI Collectionにアップロードし、file_searchで検索可能にする
// 冪等: 変更なし→スキップ、変更あり→差し替え、新規→アップ
//
// 使い方:
//   npx tsx scripts/upload-to-collection.ts docs/architecture.md README.md
//   npx tsx scripts/upload-to-collection.ts docs/*.md
//
// 必要な環境変数（.envから自動読込）:
//   XAI_API_KEY, XAI_MANAGEMENT_API_KEY, XAI_COLLECTION_ID

import * as fs from "node:fs"
import * as crypto from "node:crypto"
import * as path from "node:path"
import * as dotenv from "dotenv"

dotenv.config()

const API_BASE = "https://api.x.ai/v1"
const MANAGEMENT_API_BASE = "https://management-api.x.ai/v1"

const apiKey = process.env.XAI_API_KEY
const managementApiKey = process.env.XAI_MANAGEMENT_API_KEY
const collectionId = process.env.XAI_COLLECTION_ID

if (!apiKey || !managementApiKey || !collectionId) {
  console.error("エラー: XAI_API_KEY, XAI_MANAGEMENT_API_KEY, XAI_COLLECTION_ID が必要です")
  process.exit(1)
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error("使い方: npx tsx scripts/upload-to-collection.ts <file1> [file2] ...")
  process.exit(1)
}

// --- 型定義 ---

type ExistingDoc = {
  file_id: string
  name: string
  hash?: string
  size_bytes?: number
}

type SyncResult = {
  file: string
  action: "uploaded" | "replaced" | "skipped" | "error"
  fileId?: string
  error?: string
}

// --- Collection内の既存ドキュメント一覧を取得 ---

async function listExistingDocs(): Promise<ExistingDoc[]> {
  try {
    const res = await fetch(`${MANAGEMENT_API_BASE}/collections/${collectionId}/documents`, {
      headers: { Authorization: `Bearer ${managementApiKey}` },
    })
    if (!res.ok) {
      console.error(`既存ドキュメント一覧取得失敗 (${res.status})`)
      return []
    }
    const data = await res.json() as {
      documents?: Array<{
        file_metadata: { file_id: string; name: string; hash?: string; size_bytes?: string }
      }>
    }
    return (data.documents ?? []).map((d) => ({
      file_id: d.file_metadata.file_id,
      name: d.file_metadata.name,
      hash: d.file_metadata.hash,
      size_bytes: d.file_metadata.size_bytes ? Number(d.file_metadata.size_bytes) : undefined,
    }))
  } catch (err) {
    console.error(`既存ドキュメント一覧取得エラー: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

// --- 既存ドキュメントを削除 ---

async function deleteDoc(fileId: string): Promise<boolean> {
  try {
    const res = await fetch(`${MANAGEMENT_API_BASE}/collections/${collectionId}/documents/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${managementApiKey}` },
    })
    return res.ok
  } catch {
    return false
  }
}

// --- ファイルをアップロードしてCollectionに追加 ---

async function uploadFile(filePath: string, fileName: string): Promise<{ fileId?: string; error?: string }> {
  const content = fs.readFileSync(path.resolve(filePath))

  // Step 1: ファイルアップロード
  const formData = new FormData()
  formData.append("file", new File([content], fileName, { type: "text/plain" }))
  formData.append("purpose", "assistants")

  let fileId: string
  try {
    const res = await fetch(`${API_BASE}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    })
    if (!res.ok) {
      const text = await res.text()
      return { error: `アップロード失敗 (${res.status}): ${text}` }
    }
    const data = await res.json() as { id: string }
    fileId = data.id
  } catch (err) {
    return { error: `アップロードエラー: ${err instanceof Error ? err.message : String(err)}` }
  }

  // Step 2: Collectionに追加
  try {
    const res = await fetch(`${MANAGEMENT_API_BASE}/collections/${collectionId}/documents/${fileId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementApiKey}`,
        "Content-Type": "application/json",
      },
    })
    if (!res.ok) {
      const text = await res.text()
      return { error: `Collection追加失敗 (${res.status}): ${text}` }
    }
  } catch (err) {
    return { error: `Collection追加エラー: ${err instanceof Error ? err.message : String(err)}` }
  }

  // Step 3: 処理完了を待つ
  const maxWait = 60_000
  const interval = 3_000
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${MANAGEMENT_API_BASE}/collections/${collectionId}/documents/${fileId}`, {
        headers: { Authorization: `Bearer ${managementApiKey}` },
      })
      if (res.ok) {
        const doc = await res.json() as { status?: string }
        if (doc.status === "DOCUMENT_STATUS_PROCESSED") return { fileId }
        if (doc.status === "DOCUMENT_STATUS_FAILED") return { error: "処理失敗" }
      }
    } catch { /* ポーリング中のエラーは無視 */ }
    await new Promise((r) => setTimeout(r, interval))
  }

  return { error: "処理タイムアウト（60秒）" }
}

// --- ローカルマニフェスト（アップ済みファイルのhash記録） ---

const MANIFEST_PATH = path.resolve("data/collection-sync.json")

type Manifest = Record<string, { hash: string; fileId: string }>

function loadManifest(): Manifest {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8")) as Manifest
  } catch {
    return {}
  }
}

function saveManifest(manifest: Manifest): void {
  const dir = path.dirname(MANIFEST_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
}

function localHash(filePath: string): string {
  const content = fs.readFileSync(path.resolve(filePath))
  return crypto.createHash("sha256").update(content).digest("hex")
}

// --- 同期処理 ---

async function syncFile(
  filePath: string,
  existingDocs: ExistingDoc[],
  manifest: Manifest,
): Promise<SyncResult> {
  const absPath = path.resolve(filePath)
  if (!fs.existsSync(absPath)) {
    return { file: filePath, action: "error", error: "ファイルが見つかりません" }
  }

  const fileName = path.basename(absPath)
  const hash = localHash(filePath)

  // マニフェストでhash比較（ローカル同士なので確実に一致判定できる）
  const prev = manifest[fileName]
  if (prev && prev.hash === hash) {
    console.log(`  スキップ（変更なし）`)
    return { file: filePath, action: "skipped" }
  }

  // 変更あり or 新規: 同名の旧版をCollection上から全て削除
  const existing = existingDocs.filter((d) => d.name === fileName)
  for (const doc of existing) {
    const ok = await deleteDoc(doc.file_id)
    console.log(`  旧版削除: ${doc.file_id} ${ok ? "完了" : "失敗"}`)
  }

  // アップロード
  const result = await uploadFile(filePath, fileName)
  if (result.error) {
    return { file: filePath, action: "error", error: result.error }
  }

  // マニフェスト更新
  manifest[fileName] = { hash, fileId: result.fileId! }

  const action = existing.length > 0 || prev ? "replaced" : "uploaded"
  console.log(`  ${action === "replaced" ? "差し替え" : "アップ"}完了: ${result.fileId}`)
  return { file: filePath, action, fileId: result.fileId }
}

// --- メイン ---

async function main(): Promise<void> {
  console.log(`Collection: ${collectionId}`)
  console.log(`対象ファイル: ${files.length}件`)

  // 既存ドキュメント一覧 + ローカルマニフェスト取得
  console.log("既存ドキュメント確認中...\n")
  const existingDocs = await listExistingDocs()
  const manifest = loadManifest()

  const results: SyncResult[] = []

  for (const file of files) {
    console.log(`[${results.length + 1}/${files.length}] ${file}`)
    const result = await syncFile(file, existingDocs, manifest)
    results.push(result)
    if (result.action === "error") {
      console.error(`  エラー: ${result.error}`)
    }
    console.log()
  }

  // マニフェスト保存
  saveManifest(manifest)

  // サマリー
  const uploaded = results.filter((r) => r.action === "uploaded").length
  const replaced = results.filter((r) => r.action === "replaced").length
  const skipped = results.filter((r) => r.action === "skipped").length
  const errors = results.filter((r) => r.action === "error")
  console.log(`完了: ${uploaded}件アップ, ${replaced}件差し替え, ${skipped}件スキップ, ${errors.length}件失敗`)

  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`  失敗: ${e.file} — ${e.error}`)
    }
    process.exit(1)
  }
}

main()
