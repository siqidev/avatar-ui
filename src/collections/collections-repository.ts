import type OpenAI from "openai"
import { type AppResult, ok, fail } from "../types/result.js"
import { APP_CONFIG } from "../config.js"

// ファイルアップロード結果
type UploadedFile = {
  fileId: string
}

// Collectionsにファイルをアップロードして追加する（2段階）
// 1. api.x.ai/v1/files にファイルアップロード → fileId取得
// 2. management-api.x.ai/v1/collections/{id}/documents/{fileId} に追加
export async function uploadMemoryToCollection(
  client: OpenAI,
  collectionId: string,
  managementApiKey: string,
  memoryId: string,
  text: string,
): Promise<AppResult<UploadedFile>> {
  // Step 1: ファイルアップロード（通常キー）
  const fileResult = await uploadFile(client, memoryId, text)
  if (!fileResult.success) return fileResult

  // Step 2: コレクションにドキュメント追加（管理キー）
  const attachResult = await attachToCollection(
    collectionId,
    managementApiKey,
    fileResult.data.fileId,
  )
  if (!attachResult.success) {
    // Step1成功・Step2失敗の場合、fileIdを返して再試行可能にする
    return fail(
      "COLLECTION_ATTACH_FAILED",
      attachResult.error.message,
      { fileId: fileResult.data.fileId },
    )
  }

  return ok({ fileId: fileResult.data.fileId })
}

// 中断復帰: fileId既知でStep2のみ再実行
export async function retryAttachToCollection(
  collectionId: string,
  managementApiKey: string,
  fileId: string,
): Promise<AppResult<void>> {
  return attachToCollection(collectionId, managementApiKey, fileId)
}

// Step 1: ファイルアップロード
async function uploadFile(
  client: OpenAI,
  memoryId: string,
  text: string,
): Promise<AppResult<UploadedFile>> {
  try {
    const file = await client.files.create({
      file: new File([text], `${memoryId}.txt`, { type: "text/plain" }),
      purpose: "assistants",
    })
    return ok({ fileId: file.id })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail("FILE_UPLOAD_FAILED", `ファイルアップロード失敗: ${msg}`)
  }
}

// Step 2: コレクションにドキュメント追加
async function attachToCollection(
  collectionId: string,
  managementApiKey: string,
  fileId: string,
): Promise<AppResult<void>> {
  try {
    const url = `${APP_CONFIG.managementApiBaseUrl}/collections/${collectionId}/documents/${fileId}`
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementApiKey}`,
        "Content-Type": "application/json",
      },
    })
    if (!resp.ok) {
      const body = await resp.text()
      return fail(
        "COLLECTION_ATTACH_FAILED",
        `ドキュメント追加失敗 (${resp.status}): ${body}`,
      )
    }
    return ok(undefined)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail("COLLECTION_ATTACH_FAILED", `ドキュメント追加失敗: ${msg}`)
  }
}

// コレクションからドキュメントを削除
export async function deleteFromCollection(
  collectionId: string,
  managementApiKey: string,
  fileId: string,
): Promise<AppResult<void>> {
  try {
    const url = `${APP_CONFIG.managementApiBaseUrl}/collections/${collectionId}/documents/${fileId}`
    const resp = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${managementApiKey}`,
      },
    })
    if (!resp.ok) {
      const body = await resp.text()
      return fail(
        "COLLECTION_DELETE_FAILED",
        `ドキュメント削除失敗 (${resp.status}): ${body}`,
      )
    }
    return ok(undefined)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail("COLLECTION_DELETE_FAILED", `ドキュメント削除失敗: ${msg}`)
  }
}
