import type OpenAI from "openai"
import type {
  Response,
  ResponseInput,
  Tool,
} from "openai/resources/responses/responses"
import type { State } from "../state/state-repository.js"
import type { Env } from "../config.js"
import { APP_CONFIG, isCollectionsEnabled, isRobloxEnabled } from "../config.js"
import { saveMemoryToolDef } from "../tools/save-memory-tool.js"
import {
  robloxActionToolDef,
  robloxActionArgsSchema,
} from "../tools/roblox-action-tool.js"
import {
  fsListToolDef,
  fsReadToolDef,
  fsWriteToolDef,
  fsMutateToolDef,
} from "../tools/filesystem-tool.js"
import {
  fsListArgsSchema,
  fsReadArgsSchema,
  fsWriteArgsSchema,
  fsMutateArgsSchema,
} from "../shared/fs-schema.js"
import { fsList, fsRead, fsWrite, fsMutate } from "../main/filesystem-service.js"
import {
  saveMemoryArgsSchema,
  createMemoryRecord,
} from "../memory/memory-record.js"
import { appendMemory } from "../memory/memory-log-repository.js"
import { uploadMemoryToCollection } from "../collections/collections-repository.js"
import { appendIntent } from "../roblox/intent-log.js"
import { projectIntent } from "../roblox/projector.js"
import * as log from "../logger.js"

// ツール呼び出し情報（UIに表示するための構造化データ）
export type ToolCallInfo = {
  name: string
  args: Record<string, unknown>
  result: string
}

// sendMessage()の戻り値（テキスト + ツール呼び出し情報）
export type SendMessageResult = {
  text: string
  toolCalls: ToolCallInfo[]
}

// Responses APIにリクエストを送り、ツール呼び出しがあれば処理する
export async function sendMessage(
  client: OpenAI,
  env: Env,
  state: State,
  beingPrompt: string,
  userInput: string,
  forceSystemPrompt = false,
): Promise<SendMessageResult> {
  // 初回 or forceSystemPrompt: systemロール + userロール、継続: userのみ + previous_response_id
  const input: ResponseInput =
    state.lastResponseId && !forceSystemPrompt
      ? [{ role: "user" as const, content: userInput }]
      : [
          { role: "system" as const, content: beingPrompt },
          { role: "user" as const, content: userInput },
        ]

  const tools = buildTools(env)

  let response = await client.responses.create({
    model: APP_CONFIG.model,
    input,
    tools,
    store: true,
    ...(state.lastResponseId
      ? { previous_response_id: state.lastResponseId }
      : {}),
  })

  state.lastResponseId = response.id

  // ツール呼び出しループ（Grokがツールを呼んだら処理して再送信）
  const allToolCalls: ToolCallInfo[] = []
  const maxToolRounds = 5
  for (let round = 0; round < maxToolRounds; round++) {
    const toolCalls = extractFunctionCalls(response)
    if (toolCalls.length === 0) break

    const toolResults: ResponseInput = []
    for (const call of toolCalls) {
      log.info(`[TOOL_CALL] ${call.name}: ${call.args}`)
      const result = await handleToolCall(call, client, env, response.id)
      log.info(`[TOOL_RESULT] ${call.name}: ${result}`)

      allToolCalls.push({
        name: call.name,
        args: JSON.parse(call.args) as Record<string, unknown>,
        result,
      })

      toolResults.push({
        type: "function_call_output",
        call_id: call.callId,
        output: result,
      } as ResponseInput[number])
    }

    response = await client.responses.create({
      model: APP_CONFIG.model,
      input: toolResults,
      tools,
      store: true,
      previous_response_id: response.id,
    })
    state.lastResponseId = response.id
  }

  return {
    text: response.output_text ?? "(応答なし)",
    toolCalls: allToolCalls,
  }
}

// ツール定義を組み立てる
function buildTools(env: Env): Tool[] {
  const tools: Tool[] = [
    saveMemoryToolDef,
    fsListToolDef,
    fsReadToolDef,
    fsWriteToolDef,
    fsMutateToolDef,
  ]
  if (isCollectionsEnabled(env) && env.XAI_COLLECTION_ID) {
    tools.push({
      type: "file_search",
      vector_store_ids: [env.XAI_COLLECTION_ID],
    } as Tool)
  }
  if (isRobloxEnabled(env)) {
    tools.push(robloxActionToolDef)
  }
  return tools
}

// レスポンスからfunction_call出力を抽出
function extractFunctionCalls(
  response: Response,
): Array<{ callId: string; name: string; args: string }> {
  const calls: Array<{ callId: string; name: string; args: string }> = []
  for (const item of response.output) {
    if (item.type === "function_call") {
      calls.push({
        callId: item.call_id,
        name: item.name,
        args: item.arguments,
      })
    }
  }
  return calls
}

// ツール呼び出しを処理
async function handleToolCall(
  call: { callId: string; name: string; args: string },
  client: OpenAI,
  env: Env,
  responseId: string,
): Promise<string> {
  if (call.name === "save_memory") {
    return handleSaveMemory(call.args, call.callId, responseId, client, env)
  }
  if (call.name === "roblox_action") {
    return handleRobloxAction(call.args, env)
  }
  if (call.name === "fs_list") {
    return handleFsList(call.args)
  }
  if (call.name === "fs_read") {
    return handleFsRead(call.args)
  }
  if (call.name === "fs_write") {
    return handleFsWrite(call.args)
  }
  if (call.name === "fs_mutate") {
    return handleFsMutate(call.args)
  }
  throw new Error(`未知のツール: ${call.name}`)
}

// save_memoryツールの実行（ローカル保存 + Collectionsアップロード）
async function handleSaveMemory(
  argsJson: string,
  callId: string,
  responseId: string,
  client: OpenAI,
  env: Env,
): Promise<string> {
  const parsed = JSON.parse(argsJson)
  const validation = saveMemoryArgsSchema.safeParse(parsed)
  if (!validation.success) {
    throw new Error(
      `save_memory引数バリデーション失敗: ${JSON.stringify(validation.error.issues)}`,
    )
  }

  const record = createMemoryRecord(validation.data, {
    actor: "ai",
    responseId,
    callId,
  })

  // ① ローカル保存（同期・先に確定）
  const localResult = appendMemory(record)
  if (!localResult.success) {
    throw new Error(`ローカル保存失敗: ${localResult.error.message}`)
  }

  // ② Collectionsにアップロード（fire-and-forget: 失敗時はthrowでプロセス停止）
  if (
    isCollectionsEnabled(env) &&
    env.XAI_COLLECTION_ID &&
    env.XAI_MANAGEMENT_API_KEY
  ) {
    void uploadMemoryToCollection(
      client,
      env.XAI_COLLECTION_ID,
      env.XAI_MANAGEMENT_API_KEY,
      record.id,
      record.text,
      record.tags,
    ).then((result) => {
      if (!result.success) {
        log.fatal(`Collectionsアップロード失敗 (記憶ID: ${record.id}): ${result.error.code} - ${result.error.message}`)
      }
    })
  }

  return JSON.stringify({ status: "ローカルに保存しました", id: record.id })
}

// roblox_actionツール v2 の実行（IntentLog記録 → Projector投影）
async function handleRobloxAction(
  argsJson: string,
  env: Env,
): Promise<string> {
  const parsed = JSON.parse(argsJson)
  const validation = robloxActionArgsSchema.safeParse(parsed)
  if (!validation.success) {
    throw new Error(
      `roblox_action引数バリデーション失敗: ${JSON.stringify(validation.error.issues)}`,
    )
  }

  const { category, ops, reason } = validation.data

  // ① IntentLogに記録（場が正本）
  const intentResult = appendIntent({ category, ops, reason })
  if (!intentResult.success) {
    throw new Error(
      `意図の記録に失敗: ${intentResult.error.message}`,
    )
  }

  const intent = intentResult.data
  log.info(`[INTENT] ${intent.id} category=${category} ops=${ops.length}件 reason=${reason}`)

  // ② Projectorで投影（Robloxへ送信 + ステータス更新）
  const sent = await projectIntent(intent, env)
  if (!sent) {
    throw new Error(
      `Roblox投影失敗（意図は記録済み: ${intent.id}）`,
    )
  }

  return JSON.stringify({ status: "記録・投影完了", id: intent.id, category, ops_count: ops.length })
}

// fs_listツールの実行
async function handleFsList(argsJson: string): Promise<string> {
  const parsed = JSON.parse(argsJson)
  const validation = fsListArgsSchema.safeParse(parsed)
  if (!validation.success) {
    throw new Error(`fs_list引数バリデーション失敗: ${JSON.stringify(validation.error.issues)}`)
  }
  const result = await fsList(validation.data)
  return JSON.stringify(result)
}

// fs_readツールの実行
async function handleFsRead(argsJson: string): Promise<string> {
  const parsed = JSON.parse(argsJson)
  const validation = fsReadArgsSchema.safeParse(parsed)
  if (!validation.success) {
    throw new Error(`fs_read引数バリデーション失敗: ${JSON.stringify(validation.error.issues)}`)
  }
  const result = await fsRead(validation.data)
  return JSON.stringify(result)
}

// fs_writeツールの実行
async function handleFsWrite(argsJson: string): Promise<string> {
  const parsed = JSON.parse(argsJson)
  const validation = fsWriteArgsSchema.safeParse(parsed)
  if (!validation.success) {
    throw new Error(`fs_write引数バリデーション失敗: ${JSON.stringify(validation.error.issues)}`)
  }
  const result = await fsWrite(validation.data)
  return JSON.stringify(result)
}

// fs_mutateツールの実行
async function handleFsMutate(argsJson: string): Promise<string> {
  const parsed = JSON.parse(argsJson)
  const validation = fsMutateArgsSchema.safeParse(parsed)
  if (!validation.success) {
    throw new Error(`fs_mutate引数バリデーション失敗: ${JSON.stringify(validation.error.issues)}`)
  }
  const result = await fsMutate(validation.data)
  return JSON.stringify(result)
}
