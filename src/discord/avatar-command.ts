// AvatarCommand: $AVATAR_DIR/commands/*.{ts,mjs,js} で定義する
// オーナー専用カスタム slash command の contract。
//
// 使い方:
//   import type { AvatarCommand } from "avatar-ui/src/discord/avatar-command.js"
//   export default {
//     definition: new SlashCommandBuilder().setName("log").setDescription("...").toJSON(),
//     ownerOnly: true,
//     customIdPrefix: "avatar:log",
//     isEnabled: (config) => Boolean(config.selfAnalysisJournalFile),
//     async execute({ interaction, config }) { ... },
//     async handleStringSelectMenu({ interaction, config }) { ... },
//     async handleModalSubmit({ interaction, config }) { ... },
//   } satisfies AvatarCommand

import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  StringSelectMenuInteraction,
} from "discord.js"
import type { AppConfig } from "../config.js"

export type AvatarCommandContext<T> = {
  config: AppConfig
  interaction: T
}

export interface AvatarCommand {
  // Discord にスラッシュコマンドとして登録する定義（SlashCommandBuilder().toJSON() の出力でよい）
  definition: RESTPostAPIChatInputApplicationCommandsJSONBody
  // true なら DISCORD_OWNER_ID と一致するユーザーのみ実行可能
  ownerOnly?: boolean
  // StringSelectMenu / ModalSubmit の customId 先頭プレフィックス（例: "avatar:log"）
  // ここで宣言したプレフィックスに前方一致した interaction が本コマンドにルーティングされる
  customIdPrefix?: string
  // 必要な env がすべて揃っているか判定。false なら登録自体をスキップする
  isEnabled?: (config: AppConfig) => boolean

  execute: (ctx: AvatarCommandContext<ChatInputCommandInteraction>) => Promise<void>
  handleStringSelectMenu?: (ctx: AvatarCommandContext<StringSelectMenuInteraction>) => Promise<void>
  handleModalSubmit?: (ctx: AvatarCommandContext<ModalSubmitInteraction>) => Promise<void>
}
