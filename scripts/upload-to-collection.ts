#!/usr/bin/env npx tsx
// Collections知識アップロードスクリプト
// 指定ファイルをxAI Collectionにアップロードし、file_searchで検索可能にする
//
// 使い方:
//   npx tsx scripts/upload-to-collection.ts docs/architecture.md README.md
//   npx tsx scripts/upload-to-collection.ts docs/*.md
//
// 必要な環境変数（.envから自動読込）:
//   XAI_API_KEY, XAI_MANAGEMENT_API_KEY, XAI_COLLECTION_ID

import * as fs from "node:fs"
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

type UploadResult = {
  file: string
  fileId?: string
  status: "ok" | "error"
  error?: string
}

// ファイルをアップロードしてCollectionに追加する
async function uploadFile(filePath: string): Promise<UploadResult> {
  const absPath = path.resolve(filePath)
  if (!fs.existsSync(absPath)) {
    return { file: filePath, status: "error", error: "ファイルが見つかりません" }
  }

  const content = fs.readFileSync(absPath)
  const fileName = path.basename(absPath)

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
      return { file: filePath, status: "error", error: `ファイルアップロード失敗 (${res.status}): ${text}` }
    }
    const data = await res.json() as { id: string }
    fileId = data.id
    console.log(`  [1/3] アップロード完了: ${fileName} → ${fileId}`)
  } catch (err) {
    return { file: filePath, status: "error", error: `アップロードエラー: ${err instanceof Error ? err.message : String(err)}` }
  }

  // Step 2: Collectionにドキュメント追加
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
      return { file: filePath, fileId, status: "error", error: `Collection追加失敗 (${res.status}): ${text}` }
    }
    console.log(`  [2/3] Collection追加完了: ${fileId}`)
  } catch (err) {
    return { file: filePath, fileId, status: "error", error: `Collection追加エラー: ${err instanceof Error ? err.message : String(err)}` }
  }

  // Step 3: 処理完了を待つ（ポーリング）
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
        if (doc.status === "DOCUMENT_STATUS_PROCESSED") {
          console.log(`  [3/3] 処理完了: ${fileName}`)
          return { file: filePath, fileId, status: "ok" }
        }
        if (doc.status === "DOCUMENT_STATUS_FAILED") {
          return { file: filePath, fileId, status: "error", error: "ドキュメント処理失敗" }
        }
      }
    } catch { /* ポーリング中のエラーは無視 */ }
    await new Promise((r) => setTimeout(r, interval))
  }

  return { file: filePath, fileId, status: "error", error: "処理タイムアウト（60秒）" }
}

// メイン処理
async function main(): Promise<void> {
  console.log(`Collection: ${collectionId}`)
  console.log(`対象ファイル: ${files.length}件\n`)

  const results: UploadResult[] = []

  for (const file of files) {
    console.log(`[${results.length + 1}/${files.length}] ${file}`)
    const result = await uploadFile(file)
    results.push(result)
    if (result.status === "error") {
      console.error(`  エラー: ${result.error}`)
    }
    console.log()
  }

  // サマリー
  const ok = results.filter((r) => r.status === "ok")
  const errors = results.filter((r) => r.status === "error")
  console.log(`完了: ${ok.length}件成功, ${errors.length}件失敗`)
  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`  失敗: ${e.file} — ${e.error}`)
    }
    process.exit(1)
  }
}

main()
