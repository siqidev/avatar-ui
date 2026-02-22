import type OpenAI from "openai"
import type { State } from "../state/state-repository.js"
import { readMemoriesAfter } from "../memory/memory-log-repository.js"
import {
  uploadMemoryToCollection,
  retryAttachToCollection,
} from "../collections/collections-repository.js"

// 未同期のメモリをCollectionsに反映する（非同期・結果整合）
// main.tsから対話ループの合間に呼ばれる
export async function syncMemoriesToCollection(
  client: OpenAI,
  collectionId: string,
  managementApiKey: string,
  state: State,
): Promise<void> {
  // 中断復帰: 前回Step1成功・Step2未完了の場合
  if (state.memory.stagedUpload) {
    const { memoryId, fileId } = state.memory.stagedUpload
    const retryResult = await retryAttachToCollection(
      collectionId,
      managementApiKey,
      fileId,
    )
    if (retryResult.success) {
      state.memory.stagedUpload = null
      state.memory.syncCursorId = memoryId
      state.memory.consecutiveSyncFailures = 0
    } else {
      state.memory.consecutiveSyncFailures += 1
      state.memory.lastSyncErrorAt = new Date().toISOString()
      return // 復帰失敗、次回再試行
    }
  }

  // 未同期レコードを取得
  const result = readMemoriesAfter(state.memory.syncCursorId)
  if (!result.success || result.data.length === 0) return

  // 1件ずつ同期（順序保証）
  for (const record of result.data) {
    const uploadResult = await uploadMemoryToCollection(
      client,
      collectionId,
      managementApiKey,
      record.id,
      record.text,
    )

    if (uploadResult.success) {
      state.memory.syncCursorId = record.id
      state.memory.consecutiveSyncFailures = 0
    } else {
      // Step1成功・Step2失敗の場合、中断復帰用にfileIdを保存
      const fileId = uploadResult.meta?.fileId as string | undefined
      if (fileId) {
        state.memory.stagedUpload = { memoryId: record.id, fileId }
      }
      state.memory.consecutiveSyncFailures += 1
      state.memory.lastSyncErrorAt = new Date().toISOString()
      return // エラー時は中断、次回再試行
    }
  }
}
