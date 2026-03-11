import type OpenAI from "openai"
import type {
  Response,
  ResponseInput,
  Tool,
} from "openai/resources/responses/responses"
import type { State, PersistedMessage } from "../state/state-repository.js"
import { getConfig, isCollectionsEnabled, isRobloxEnabled } from "../config.js"
import { getSettings } from "../main/settings-store.js"
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
import { terminalToolDef, terminalArgsSchema } from "../tools/terminal-tool.js"
import { requestApproval } from "../main/tool-approval-service.js"
import type { ToolName } from "../shared/tool-approval-schema.js"
import {
  execCommand,
  waitForExit,
  getCommandOutput,
  getSnapshot,
  getCwd,
  isBusy,
} from "../main/terminal-service.js"
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
import { appendMemory, readRecentMemories } from "../memory/memory-log-repository.js"
import { uploadMemoryToCollection } from "../collections/collections-repository.js"
import { appendIntent } from "../roblox/intent-log.js"
import { projectIntent } from "../roblox/projector.js"
import { t } from "../shared/i18n.js"
import * as log from "../logger.js"

// ツール呼び出し情報（UIに表示するための構造化データ）
export type ToolCallInfo = {
  name: string
  args: Record<string, unknown>
  result: string
}

// sendMessage()の戻り値（元テキスト + UI表示テキスト + ツール呼び出し情報）
export type SendMessageResult = {
  text: string
  displayText: string
  toolCalls: ToolCallInfo[]
}

export function resolveDisplayText(
  text: string,
  toolCalls: ToolCallInfo[],
): string {
  const sayTexts = toolCalls.flatMap(extractAvatarSayTexts)
  return sayTexts.length > 0 ? sayTexts.join("\n") : text
}

function extractAvatarSayTexts(call: ToolCallInfo): string[] {
  if (call.name !== "roblox_action") return []

  const args = call.args
  if (args.category !== "npc" || !Array.isArray(args.ops)) return []

  return (args.ops as Record<string, unknown>[]).flatMap((op) => {
    if (op.op !== "say") return []
    return typeof op.text === "string" ? [op.text] : []
  })
}

// チェーン断裂エラーかどうか判定する（400/404 = レスポンスID無効/期限切れ）
function isChainBreakError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  const status = (err as { status?: number }).status
  return status === 400 || status === 404
}

// messageHistoryからResponseInput用の会話コンテキストを構築する
// チェーン断裂時の復旧素材として使用（直近の会話を要約的に再注入）
const MAX_RECOVERY_MESSAGES = 20
function buildRecoveryContext(
  beingPrompt: string,
  history: PersistedMessage[],
  userInput: string,
): ResponseInput {
  const input: ResponseInput = [
    { role: "system" as const, content: beingPrompt },
  ]

  // memory.jsonlから直近の記憶を読み込む（文脈の厚みを確保）
  const memoryResult = readRecentMemories(10)
  if (memoryResult.success && memoryResult.data.length > 0) {
    const memoryContext = memoryResult.data
      .map((m) => `[記憶 ${(m.tags ?? []).join(",")}] ${m.text}`)
      .join("\n")
    input.push({
      role: "developer" as const,
      content: `以下はあなたが過去に保存した記憶です。文脈の再構築に使ってください:\n${memoryContext}`,
    })
  }

  // messageHistoryから直近の会話を復元
  const recent = history.slice(-MAX_RECOVERY_MESSAGES)
  for (const msg of recent) {
    input.push({
      role: msg.actor === "human" ? "user" as const : "assistant" as const,
      content: msg.text,
    })
  }

  // 今回のユーザー入力
  input.push({ role: "user" as const, content: userInput })
  return input
}

// API呼び出しタイムアウト（1回のresponses.createの上限）
// SDKデフォルトは10分×3回=最大30分。fail-fast方針で20秒×リトライなしに制限
const API_CALL_TIMEOUT_MS = 20_000
const API_CALL_OPTIONS = { timeout: API_CALL_TIMEOUT_MS, maxRetries: 0 } as const

// Responses APIにリクエストを送り、ツール呼び出しがあれば処理する
export async function sendMessage(
  client: OpenAI,
  state: State,
  beingPrompt: string,
  userInput: string,
  forceSystemPrompt = false,
): Promise<SendMessageResult> {
  const config = getConfig()
  // ターン開始時にモデルを固定（ツールループ中のメニュー変更で途中切替されるのを防ぐ）
  const model = getSettings().model
  const lastResponseId = state.participant.lastResponseId

  // 初回 or forceSystemPrompt: systemロール + userロール、継続: userのみ + previous_response_id
  const input: ResponseInput =
    lastResponseId && !forceSystemPrompt
      ? [{ role: "user" as const, content: userInput }]
      : [
          { role: "system" as const, content: beingPrompt },
          { role: "user" as const, content: userInput },
        ]

  const tools = buildTools(config)

  let response: Response
  try {
    response = await client.responses.create({
      model,
      input,
      tools,
      store: true,
      ...(lastResponseId
        ? { previous_response_id: lastResponseId }
        : {}),
    }, API_CALL_OPTIONS)
  } catch (err) {
    // チェーン断裂検知（400/404: レスポンスIDが無効/期限切れ）
    if (lastResponseId && isChainBreakError(err)) {
      log.info(`[CHAIN] 断裂検知 (${lastResponseId}) — 復旧コンテキストで再試行`)
      state.participant.lastResponseId = null
      state.participant.lastResponseAt = null

      // 復旧: being + memory + messageHistory + 今回の入力で新チェーン開始
      const recoveryInput = buildRecoveryContext(
        beingPrompt,
        state.field.messageHistory,
        userInput,
      )
      response = await client.responses.create({
        model,
        input: recoveryInput,
        tools,
        store: true,
      }, API_CALL_OPTIONS)
      log.info(`[CHAIN] 復旧成功 — 新チェーン開始 (${response.id})`)
    } else {
      throw err
    }
  }

  state.participant.lastResponseId = response.id

  // ツール呼び出しループ（Grokがツールを呼んだら処理して再送信）
  const allToolCalls: ToolCallInfo[] = []
  const maxToolRounds = 5
  for (let round = 0; round < maxToolRounds; round++) {
    const toolCalls = extractFunctionCalls(response)
    if (toolCalls.length === 0) break

    const toolResults: ResponseInput = []
    for (const call of toolCalls) {
      log.info(`[TOOL_CALL] ${call.name}: ${call.args}`)
      const parsedArgs = JSON.parse(call.args) as Record<string, unknown>

      // 承認ゲート: auto-approveリスト外のツールはユーザー承認を待つ
      const approval = await requestApproval(call.name as ToolName, parsedArgs)
      let result: string
      if (approval.approved) {
        result = await handleToolCall(call, client, response.id)
      } else {
        result = JSON.stringify({
          status: "denied",
          message: "ユーザーがこのツール実行を拒否しました",
        })
        log.info(`[TOOL_DENIED] ${call.name}: ${approval.reason}`)
      }
      log.info(`[TOOL_RESULT] ${call.name}: ${result}`)

      allToolCalls.push({
        name: call.name,
        args: parsedArgs,
        result,
      })

      toolResults.push({
        type: "function_call_output",
        call_id: call.callId,
        output: result,
      } as ResponseInput[number])
    }

    response = await client.responses.create({
      model,
      input: toolResults,
      tools,
      store: true,
      previous_response_id: response.id,
    }, API_CALL_OPTIONS)
    state.participant.lastResponseId = response.id
  }

  const text = response.output_text ?? t("noResponse")

  return {
    text,
    displayText: resolveDisplayText(text, allToolCalls),
    toolCalls: allToolCalls,
  }
}

// ツール定義を組み立てる
function buildTools(config: import("../config.js").AppConfig): Tool[] {
  const tools: Tool[] = [
    saveMemoryToolDef,
    fsListToolDef,
    fsReadToolDef,
    fsWriteToolDef,
    fsMutateToolDef,
  ]
  // AVATAR_SHELL=on の場合のみAIにterminalツールを提供
  if (config.avatarShell) {
    tools.push(terminalToolDef)
  }
  if (isCollectionsEnabled(config) && config.xaiCollectionId) {
    tools.push({
      type: "file_search",
      vector_store_ids: [config.xaiCollectionId],
    } as Tool)
  }
  if (isRobloxEnabled(config)) {
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
  responseId: string,
): Promise<string> {
  if (call.name === "save_memory") {
    return handleSaveMemory(call.args, call.callId, responseId, client)
  }
  if (call.name === "roblox_action") {
    return handleRobloxAction(call.args)
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
  if (call.name === "terminal") {
    return handleTerminal(call.args)
  }
  throw new Error(`未知のツール: ${call.name}`)
}

// save_memoryツールの実行（ローカル保存 + Collectionsアップロード）
async function handleSaveMemory(
  argsJson: string,
  callId: string,
  responseId: string,
  client: OpenAI,
): Promise<string> {
  const config = getConfig()
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
    isCollectionsEnabled(config) &&
    config.xaiCollectionId &&
    config.xaiManagementApiKey
  ) {
    void uploadMemoryToCollection(
      client,
      config.xaiCollectionId,
      config.xaiManagementApiKey,
      record.id,
      record.text,
      record.tags,
    ).then((result) => {
      if (!result.success) {
        log.fatal(`Collectionsアップロード失敗 (記憶ID: ${record.id}): ${result.error.code} - ${result.error.message}`)
      }
    })
  }

  return JSON.stringify({ status: t("memorySaved"), id: record.id })
}

// roblox_actionツール v2 の実行（IntentLog記録 → Projector投影）
async function handleRobloxAction(
  argsJson: string,
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
  const sent = await projectIntent(intent)
  if (!sent) {
    throw new Error(
      `Roblox投影失敗（意図は記録済み: ${intent.id}）`,
    )
  }

  return JSON.stringify({ status: t("intentProjected"), id: intent.id, category, ops_count: ops.length })
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

// terminalツールの実行（コマンド実行 or 直近出力取得）
// 二重ガード: buildToolsでツール定義を除外しても、万が一呼ばれた場合に備える
async function handleTerminal(argsJson: string): Promise<string> {
  const config = getConfig()
  if (!config.avatarShell) {
    return JSON.stringify({ status: "error", reason: "AVATAR_SHELL_DISABLED" })
  }
  const parsed = JSON.parse(argsJson)
  const validation = terminalArgsSchema.safeParse(parsed)
  if (!validation.success) {
    throw new Error(`terminal引数バリデーション失敗: ${JSON.stringify(validation.error.issues)}`)
  }

  const { cmd, timeoutMs } = validation.data

  // cmd省略: 直近のコマンド出力を取得
  if (!cmd) {
    const snapshot = getSnapshot()
    const output = getCommandOutput()
    return JSON.stringify({
      status: "output",
      busy: snapshot.busy,
      cwd: snapshot.cwd,
      lastCmd: snapshot.lastCmd ?? null,
      lastExitCode: snapshot.lastExitCode ?? null,
      output: output.lines,
      truncated: output.truncated,
    })
  }

  // cmd指定: コマンド実行
  if (isBusy()) {
    return JSON.stringify({ status: "error", reason: "TERMINAL_BUSY" })
  }

  const correlationId = crypto.randomUUID()
  const execResult = execCommand({
    actor: "ai",
    correlationId,
    cmd,
    timeoutMs,
  })

  if (!execResult.accepted) {
    return JSON.stringify({ status: "error", reason: execResult.reason })
  }

  // 完了を待つ
  const exitPromise = waitForExit()
  if (exitPromise) await exitPromise

  // 結果を返す
  const snapshot = getSnapshot()
  const output = getCommandOutput()
  return JSON.stringify({
    status: "executed",
    cmd,
    exitCode: snapshot.lastExitCode ?? null,
    cwd: snapshot.cwd,
    output: output.lines,
    truncated: output.truncated,
  })
}
