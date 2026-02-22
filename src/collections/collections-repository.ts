import type OpenAI from "openai"
import { type AppResult, ok, fail } from "../types/result.js"
import { APP_CONFIG } from "../config.js"

// Collectionsにメモリをアップロードする（2段階: files → documents attach）
// JS/TSではxAI SDKが存在しないため、OpenAI SDK + fetch直叩きが必要
export async function uploadMemoryToCollection(
  client: OpenAI,
  collectionId: string,
  managementApiKey: string,
  memoryId: string,
  text: string,
): Promise<AppResult<{ fileId: string }>> {
  // Step 1: ファイルアップロード（api.x.ai/v1/files、通常キー）
  let fileId: string
  try {
    const file = await client.files.create({
      file: new File([text], `${memoryId}.txt`, { type: "text/plain" }),
      purpose: "assistants",
    })
    fileId = file.id
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail("FILE_UPLOAD_FAILED", `ファイルアップロード失敗: ${msg}`)
  }

  // Step 2: コレクションにドキュメント追加（management-api.x.ai/v1、管理キー）
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail("COLLECTION_ATTACH_FAILED", `ドキュメント追加失敗: ${msg}`)
  }

  return ok({ fileId })
}
