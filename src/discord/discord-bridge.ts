// Discord Bridge: Discord窓口のライフサイクル統括
// 責務: Discord Bot起動 + session-ws-server接続 + イベント→Discord投稿

import { Client, GatewayIntentBits, Events, ChannelType } from "discord.js"
import type { TextChannel, ButtonInteraction, ActionRowBuilder, ButtonBuilder, Message } from "discord.js"
import type { AppConfig } from "../config.js"
import { resolveDiscordRole } from "../services/input-role-resolver.js"
import { createDiscordSessionClient } from "./discord-session-client.js"
import type { DiscordSessionClient } from "./discord-session-client.js"
import {
  renderStreamItem,
  renderHumanMessage,
  renderApprovalRequest,
  renderApprovalResolved,
} from "./discord-message-renderer.js"
import type { PendingApproval } from "../shared/session-event-schema.js"
import * as log from "../logger.js"

// --- 型定義 ---

export type DiscordBridge = {
  start: () => Promise<void>
  stop: () => Promise<void>
}

// --- Bridge生成 ---

export function createDiscordBridge(config: AppConfig): DiscordBridge {
  const botToken = config.discordBotToken!
  const channelId = config.discordChannelId!

  let client: Client | null = null
  let sessionClient: DiscordSessionClient | null = null
  let channel: TextChannel | null = null
  // requestId → Discord messageId（承認メッセージの更新に使用）
  const approvalMessages = new Map<string, string>()
  // typing indicator用タイマー
  let typingTimer: ReturnType<typeof setInterval> | null = null

  async function start(): Promise<void> {
    // 1. Discord Bot起動
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    })

    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isButton()) return
      await handleButtonInteraction(interaction as ButtonInteraction)
    })

    client.on(Events.MessageCreate, (message) => {
      void handleMessageCreate(message)
    })

    await client.login(botToken)
    log.info("[DISCORD] Bot ログイン完了")

    // 2. チャンネル取得・検証
    const fetched = await client.channels.fetch(channelId)
    if (!fetched || fetched.type !== ChannelType.GuildText) {
      log.error(`[DISCORD] チャンネル ${channelId} がテキストチャンネルではない — Discord窓口を無効化`)
      await client.destroy()
      client = null
      return
    }
    channel = fetched as TextChannel
    log.info(`[DISCORD] チャンネル取得: #${channel.name}`)

    // 3. session-ws-server に接続
    const wsUrl = config.sessionWsToken
      ? `ws://localhost:${config.sessionWsPort}?token=${config.sessionWsToken}`
      : `ws://localhost:${config.sessionWsPort}`

    sessionClient = createDiscordSessionClient(wsUrl, {
      onSessionState: (payload) => {
        // pending承認リクエストの復元
        if (payload.pendingApprovals && payload.pendingApprovals.length > 0) {
          void restorePendingApprovals(payload.pendingApprovals)
        }
      },

      onStreamItem: (payload) => {
        // 観測応答（Roblox共振）はDiscordに流さない（monitor pane + Roblox sayで十分）
        if (payload.source === "observation") return
        // Discord発のhuman発話はecho防止
        if (payload.actor === "human" && payload.channel === "discord") return
        // Console等からのhuman発話はDiscordに表示
        if (payload.actor === "human") {
          void sendToChannel(renderHumanMessage(payload))
          return
        }

        stopTyping()
        const content = renderStreamItem(payload)
        void sendToChannel(content)
      },

      onApprovalRequested: (payload) => {
        const msg = renderApprovalRequest(payload)
        void sendApprovalToChannel(payload.requestId, msg.content, msg.components)
      },

      onApprovalResolved: (payload) => {
        const content = renderApprovalResolved(payload)
        void updateApprovalMessage(payload.requestId, content)
      },

      onDisconnect: () => {
        // 再接続はsession-clientが自動で行う
        approvalMessages.clear()
      },
    })

    sessionClient.connect()
    log.info("[DISCORD] Bridge起動完了")
  }

  async function stop(): Promise<void> {
    stopTyping()
    sessionClient?.close()
    sessionClient = null

    if (client) {
      await client.destroy()
      client = null
    }
    channel = null
    approvalMessages.clear()
    log.info("[DISCORD] Bridge停止")
  }

  // --- Typing indicator ---

  function startTyping(): void {
    stopTyping()
    if (!channel) return
    void channel.sendTyping().catch(() => {})
    // sendTypingは10秒で切れるので8秒ごとにリピート
    typingTimer = setInterval(() => {
      void channel?.sendTyping().catch(() => {})
    }, 8_000)
  }

  function stopTyping(): void {
    if (typingTimer) {
      clearInterval(typingTimer)
      typingTimer = null
    }
  }

  // --- Discord投稿 ---

  async function sendToChannel(content: string): Promise<void> {
    if (!channel) return
    try {
      await channel.send(content)
    } catch (err) {
      log.error(`[DISCORD] 投稿失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function sendApprovalToChannel(
    requestId: string,
    content: string,
    components: ActionRowBuilder<ButtonBuilder>[],
  ): Promise<void> {
    if (!channel) return
    try {
      const msg = await channel.send({ content, components })
      approvalMessages.set(requestId, msg.id)
    } catch (err) {
      log.error(`[DISCORD] 承認メッセージ投稿失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function updateApprovalMessage(requestId: string, content: string): Promise<void> {
    if (!channel) return
    const messageId = approvalMessages.get(requestId)
    if (!messageId) return

    try {
      const msg = await channel.messages.fetch(messageId)
      await msg.edit({ content, components: [] })
      approvalMessages.delete(requestId)
    } catch (err) {
      log.error(`[DISCORD] 承認メッセージ更新失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function restorePendingApprovals(approvals: PendingApproval[]): Promise<void> {
    for (const approval of approvals) {
      const msg = renderApprovalRequest(approval)
      await sendApprovalToChannel(approval.requestId, msg.content, msg.components)
    }
  }

  // --- メッセージハンドラ ---

  async function handleMessageCreate(message: Message): Promise<void> {
    // Bot自身のメッセージはスキップ
    if (message.author.bot) return
    // 対象チャンネルのみ
    if (message.channelId !== channelId) return
    // @Spectraメンションのみ受理
    if (!client?.user || !message.mentions.has(client.user.id)) return

    // メンション文字列を除去してテキスト抽出
    const text = message.content
      .replace(/<@!?\d+>/g, "")
      .trim()
    if (!text) return

    // ロール判定
    const role = resolveDiscordRole(message.author.id, config)
    const correlationId = `discord-${Date.now()}`

    log.info(`[DISCORD] メッセージ受信 (${role}): ${text.substring(0, 80)}`)
    startTyping()
    sessionClient?.sendStreamPost(text, correlationId, role)
  }

  // --- ボタン操作ハンドラ ---

  async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const [action, requestId] = interaction.customId.split(":")
    if (!action || !requestId) return
    if (action !== "approve" && action !== "deny") return

    // 承認操作はownerのみ
    const role = resolveDiscordRole(interaction.user.id, config)
    if (role !== "owner") {
      await interaction.reply({ content: "⛔ 承認権限がありません", ephemeral: true })
      return
    }

    const decision = action as "approve" | "deny"
    sessionClient?.sendApprovalRespond(requestId, decision)

    // 即座にUIフィードバック
    const label = decision === "approve" ? "✅ 承認しました" : "❌ 拒否しました"
    await interaction.update({ content: `${label}: \`${requestId.substring(0, 8)}...\``, components: [] })
  }

  return { start, stop }
}
