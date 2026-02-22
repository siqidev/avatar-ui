import type OpenAI from "openai"
import type {
  Response,
  ResponseInput,
  Tool,
} from "openai/resources/responses/responses"
import type { State } from "../state/state-repository.js"
import type { Env } from "../config.js"
import { APP_CONFIG, isCollectionsEnabled } from "../config.js"
import { saveMemoryToolDef } from "../tools/save-memory-tool.js"
import {
  saveMemoryArgsSchema,
  createMemoryRecord,
} from "../memory/memory-record.js"
import { appendMemory, readRecentMemories } from "../memory/memory-log-repository.js"

// ツール使用結果
type ToolOutput = {
  // ツール処理後の最終テキスト応答
  reply: string
  // save_memoryが呼ばれたか
  memorySaved: boolean
}

// Responses APIにリクエストを送り、ツール呼び出しがあれば処理する
export async function sendMessage(
  client: OpenAI,
  env: Env,
  state: State,
  beingPrompt: string,
  userInput: string,
): Promise<ToolOutput> {
  // 初回: systemロール + userロール、継続: userのみ + previous_response_id
  const input: ResponseInput = state.lastResponseId
    ? [{ role: "user" as const, content: userInput }]
    : [
        { role: "system" as const, content: beingPrompt },
        { role: "user" as const, content: userInput },
      ]

  // ツール定義（save_memory + file_search（Collections有効時））
  const tools = buildTools(env)

  // Responses API呼び出し
  let response = await client.responses.create({
    model: APP_CONFIG.model,
    input,
    tools,
    store: true,
    ...(state.lastResponseId
      ? { previous_response_id: state.lastResponseId }
      : {}),
  })

  // response_idを即座に保存（ツール処理中にクラッシュしても会話は継続可能）
  state.lastResponseId = response.id

  // ツール呼び出しループ（Grokがツールを呼んだら処理して再送信）
  let memorySaved = false
  const maxToolRounds = 5
  for (let round = 0; round < maxToolRounds; round++) {
    const toolCalls = extractFunctionCalls(response)
    if (toolCalls.length === 0) break

    // ツール呼び出しを処理
    const toolResults: ResponseInput = []
    for (const call of toolCalls) {
      const result = await handleToolCall(call, state, response.id)
      if (call.name === "save_memory" && result.includes("保存しました")) {
        memorySaved = true
      }
      toolResults.push({
        type: "function_call_output",
        call_id: call.callId,
        output: result,
      } as ResponseInput[number])
    }

    // ツール結果を送信して次の応答を取得
    response = await client.responses.create({
      model: APP_CONFIG.model,
      input: toolResults,
      tools,
      store: true,
      previous_response_id: response.id,
    })
    state.lastResponseId = response.id
  }

  const reply = response.output_text ?? "(応答なし)"
  return { reply, memorySaved }
}

// file_search障害時のfallback: 直近N件の記憶をシステムプロンプトに注入して再送信
export async function sendMessageWithFallback(
  client: OpenAI,
  env: Env,
  state: State,
  beingPrompt: string,
  userInput: string,
): Promise<ToolOutput> {
  try {
    return await sendMessage(client, env, state, beingPrompt, userInput)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)

    // previous_response_id無効（30日超過等）
    if (message.includes("previous_response_id")) {
      process.stderr.write("セッションをリセットします\n\n")
      state.lastResponseId = null
      return sendMessage(client, env, state, beingPrompt, userInput)
    }

    // file_search関連のエラー → fallback
    if (
      message.includes("file_search") ||
      message.includes("vector_store")
    ) {
      process.stderr.write(
        "Collections検索に失敗。ローカル記憶で代替します\n\n",
      )
      return sendWithLocalMemoryFallback(
        client,
        state,
        beingPrompt,
        userInput,
      )
    }

    throw err
  }
}

// ローカル記憶をプロンプトに注入して送信（fallback）
async function sendWithLocalMemoryFallback(
  client: OpenAI,
  state: State,
  beingPrompt: string,
  userInput: string,
): Promise<ToolOutput> {
  const recentResult = readRecentMemories(APP_CONFIG.fallbackRecentCount)
  const memories = recentResult.success ? recentResult.data : []

  let systemContent = beingPrompt
  if (memories.length > 0) {
    const memoryText = memories
      .map((m) => `[${m.at}] ${m.text}`)
      .join("\n")
    systemContent += `\n\n## 長期記憶（直近${memories.length}件）\n${memoryText}`
  }

  // fallback時はfile_searchを除外し、save_memoryのみ
  const tools: Tool[] = [saveMemoryToolDef]

  const input: ResponseInput = [
    { role: "system" as const, content: systemContent },
    { role: "user" as const, content: userInput },
  ]

  // fallback時はセッション継続を諦めて新規セッション
  const response = await client.responses.create({
    model: APP_CONFIG.model,
    input,
    tools,
    store: true,
  })

  state.lastResponseId = response.id

  const reply = response.output_text ?? "(応答なし)"
  return { reply, memorySaved: false }
}

// ツール定義を組み立てる
function buildTools(env: Env): Tool[] {
  const tools: Tool[] = [saveMemoryToolDef]

  if (isCollectionsEnabled(env) && env.XAI_COLLECTION_ID) {
    tools.push({
      type: "file_search",
      vector_store_ids: [env.XAI_COLLECTION_ID],
    } as Tool)
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
  state: State,
  responseId: string,
): Promise<string> {
  if (call.name === "save_memory") {
    return handleSaveMemory(call.args, call.callId, responseId)
  }
  return JSON.stringify({ error: `未知のツール: ${call.name}` })
}

// save_memoryツールの実行
function handleSaveMemory(
  argsJson: string,
  callId: string,
  responseId: string,
): string {
  try {
    const parsed = JSON.parse(argsJson)
    const validation = saveMemoryArgsSchema.safeParse(parsed)
    if (!validation.success) {
      return JSON.stringify({
        error: "引数バリデーション失敗",
        details: validation.error.issues,
      })
    }

    const record = createMemoryRecord(validation.data, {
      actor: "ai",
      responseId,
      callId,
    })

    const result = appendMemory(record)
    if (!result.success) {
      return JSON.stringify({ error: result.error.message })
    }

    return JSON.stringify({
      status: "保存しました",
      id: record.id,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return JSON.stringify({ error: `save_memory実行エラー: ${msg}` })
  }
}
