import type OpenAI from "openai"
import type {
  Response,
  ResponseInput,
  Tool,
} from "openai/resources/responses/responses"
import type { State, PersistedMessage } from "../state/state-repository.js"
import type { Source } from "../shared/ipc-schema.js"
import type { ChannelId } from "../shared/channel.js"
import type { InputRole } from "./input-role-resolver.js"
import { getConfig, isCollectionsEnabled, isRobloxEnabled, isXEnabled } from "../config.js"
import { getAllowedTools, isToolAllowed } from "./input-gate.js"
import { getSettings } from "../runtime/settings-store.js"
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
import { xPostToolDef, xPostArgsSchema } from "../tools/x-post-tool.js"
import { xReplyToolDef, xReplyArgsSchema } from "../tools/x-reply-tool.js"
import { createPost, createReply } from "../x/x-api-repository.js"
import { requestApproval } from "../runtime/tool-approval-service.js"
import type { ToolName } from "../shared/tool-approval-schema.js"
import {
  execAiCommand,
  isAiBusy,
  getScrollback,
  getSnapshot,
} from "../runtime/terminal-service.js"
import {
  fsListArgsSchema,
  fsReadArgsSchema,
  fsWriteArgsSchema,
  fsMutateArgsSchema,
} from "../shared/fs-schema.js"
import { fsList, fsRead, fsWrite, fsMutate } from "../runtime/filesystem-service.js"
import {
  saveMemoryArgsSchema,
  createMemoryRecord,
} from "../memory/memory-record.js"
import { appendMemory, readRecentMemories } from "../memory/memory-log-repository.js"
import { uploadMemoryToCollection } from "../collections/collections-repository.js"
import { appendIntent } from "../roblox/intent-log.js"
import { projectIntent } from "../roblox/projector.js"
import { startSuppression as startMotionSuppression } from "../roblox/motion-state.js"
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
  // source="observation"のメッセージは観測プレフィックスを付与して復元
  // （AIが復旧後も「これは観測だった」と認識できるようにする）
  const recent = history.slice(-MAX_RECOVERY_MESSAGES)
  for (const msg of recent) {
    const content = msg.actor === "human" && msg.source === "observation"
      ? t("obs.recoveryPrefix", msg.text)
      : msg.text
    input.push({
      role: msg.actor === "human" ? "user" as const : "assistant" as const,
      content,
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
// source/channel: InputGateでツール権限を制御
// options.toolChoice: ツール使用ポリシー（"required"でツール呼び出し強制）
// options.toolNames: 指定時、ツールリストをこの名前だけに絞る
export async function sendMessage(
  client: OpenAI,
  state: State,
  beingPrompt: string,
  userInput: string,
  forceSystemPrompt = false,
  source: Source = "user",
  channel: ChannelId = "console",
  inputRole: InputRole = "owner",
  options?: { toolChoice?: "auto" | "required" | "none"; toolNames?: string[] },
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

  let tools = buildTools(config, source, channel, inputRole)
  if (options?.toolNames) {
    tools = tools.filter((t) => "name" in t && options.toolNames!.includes(t.name as string))
  }

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
      ...(options?.toolChoice
        ? { tool_choice: options.toolChoice }
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

      // InputGate: 入力文脈で許可されていないツールはreject（二重防御の2段目）
      if (!isToolAllowed(call.name, source, channel, inputRole)) {
        const gateResult = JSON.stringify({
          status: "denied",
          message: `このツールは${channel}チャネルの${source}入力（${inputRole}）からは使用できません`,
        })
        log.info(`[INPUT_GATE] ${call.name} 拒否: source=${source} channel=${channel} role=${inputRole}`)
        allToolCalls.push({ name: call.name, args: parsedArgs, result: gateResult })
        toolResults.push({
          type: "function_call_output",
          call_id: call.callId,
          output: gateResult,
        } as ResponseInput[number])
        continue
      }

      // 承認ゲート: auto-approveリスト外のツールはユーザー承認を待つ
      const approval = await requestApproval(call.name as ToolName, parsedArgs)
      let result: string
      if (approval.approved) {
        try {
          result = await handleToolCall(call, client, response.id)
        } catch (err) {
          // ツール実行エラーをAIに返して続行（ENOENT等は正常な探索行動）
          result = JSON.stringify({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          })
          log.info(`[TOOL_ERROR] ${call.name}: ${result}`)
        }
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

// ツール定義を組み立てる（InputGateで入力文脈に応じてフィルタリング）
function buildTools(config: import("../config.js").AppConfig, source: Source, channel: ChannelId, role: InputRole = "owner"): Tool[] {
  const allowed = getAllowedTools(source, channel, role)

  // 全ツール定義のマッピング（name → Tool）
  const allTools: Array<{ name: string; def: Tool; condition: boolean }> = [
    { name: "save_memory", def: saveMemoryToolDef, condition: true },
    { name: "fs_list", def: fsListToolDef, condition: true },
    { name: "fs_read", def: fsReadToolDef, condition: true },
    { name: "fs_write", def: fsWriteToolDef, condition: true },
    { name: "fs_mutate", def: fsMutateToolDef, condition: true },
    { name: "terminal", def: terminalToolDef, condition: config.avatarShell },
    { name: "roblox_action", def: robloxActionToolDef, condition: isRobloxEnabled(config) },
    { name: "x_post", def: xPostToolDef, condition: isXEnabled(config) },
    { name: "x_reply", def: xReplyToolDef, condition: isXEnabled(config) },
  ]

  // InputGateで許可されたツールのみ追加
  const tools: Tool[] = allTools
    .filter((t) => t.condition && allowed.includes(t.name as import("../shared/tool-approval-schema.js").ToolName))
    .map((t) => t.def)

  // file_search（Grok内部ツール、InputGate対象外）
  if (isCollectionsEnabled(config) && config.xaiCollectionId) {
    tools.push({
      type: "file_search",
      vector_store_ids: [config.xaiCollectionId],
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
  if (call.name === "x_post") {
    return handleXPost(call.args)
  }
  if (call.name === "x_reply") {
    return handleXReply(call.args)
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

  // ③ npc_motion投影成功: 自己起因のproximityを抑制開始
  // go_to_player/follow_playerの移動結果としてproximity enterが発火するのを防ぐ
  if (category === "npc_motion") {
    startMotionSuppression()
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

  // cmd省略: 直近のターミナル出力を取得
  if (!cmd) {
    const snapshot = getSnapshot()
    const scrollback = getScrollback()
    return JSON.stringify({
      status: "output",
      alive: snapshot.alive,
      output: scrollback.lines,
      truncated: scrollback.truncated,
    })
  }

  // cmd指定: コマンド実行（共有PTYに書き込み、完了を待つ）
  if (isAiBusy()) {
    return JSON.stringify({ status: "error", reason: "TERMINAL_BUSY" })
  }

  const result = await execAiCommand(cmd, timeoutMs)

  return JSON.stringify({
    status: "executed",
    cmd,
    exitCode: result.exitCode,
    output: result.output,
    truncated: result.truncated,
  })
}

// x_postツールの実行
async function handleXPost(argsJson: string): Promise<string> {
  const parsed = JSON.parse(argsJson)
  const validation = xPostArgsSchema.safeParse(parsed)
  if (!validation.success) {
    throw new Error(`x_post引数バリデーション失敗: ${JSON.stringify(validation.error.issues)}`)
  }

  const result = await createPost(validation.data.text)
  if (!result.success) {
    throw new Error(`Xポスト作成失敗: ${result.error}`)
  }

  return JSON.stringify({ status: "posted", tweet_id: result.tweetId })
}

// x_replyツールの実行（X連携有効時に利用可能、TOOL_AUTO_APPROVEで自動実行を制御）
async function handleXReply(argsJson: string): Promise<string> {
  const parsed = JSON.parse(argsJson)
  const validation = xReplyArgsSchema.safeParse(parsed)
  if (!validation.success) {
    throw new Error(`x_reply引数バリデーション失敗: ${JSON.stringify(validation.error.issues)}`)
  }

  const result = await createReply(validation.data.text, validation.data.reply_to_tweet_id)
  if (!result.success) {
    throw new Error(`X返信作成失敗: ${result.error}`)
  }

  return JSON.stringify({ status: "replied", tweet_id: result.tweetId, reply_to: validation.data.reply_to_tweet_id })
}
