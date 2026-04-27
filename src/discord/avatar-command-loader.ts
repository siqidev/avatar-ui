// AvatarCommandLoader: $AVATAR_DIR/commands/ 配下のカスタムコマンドを動的に読み込み、
// Discord interaction を該当コマンドにルーティングするレジストリ。
//
// 設計判断:
// - vite に解決させず、Node/Electron 実行時に import(pathToFileURL(absPath).href) で外部ロード
// - 同名ファイルは .mjs > .js > .ts の優先順（headless tsx で .ts、Electron では .mjs/.js を想定）
// - $AVATAR_DIR/commands/ がない or 空 → loader は no-op で起動を妨げない
// - owner enforcement は loader で一元化（plugin に散らさない）

import { existsSync, readdirSync, statSync } from "node:fs"
import { extname, join, basename } from "node:path"
import { pathToFileURL } from "node:url"
import type { Guild, Interaction } from "discord.js"
import type { AppConfig } from "../config.js"
import { resolveDiscordRole } from "../services/input-role-resolver.js"
import * as log from "../logger.js"
import type { AvatarCommand } from "./avatar-command.js"

const SUPPORTED_EXTS = [".mjs", ".js", ".ts"] as const

export type AvatarCommandRegistry = {
  // ロードされたコマンド数（0 なら無効）
  size: number
  // Discord に登録（特定 guild に対する set）
  registerToGuild: (guild: Guild) => Promise<void>
  // interaction を該当コマンドにルーティング。処理した場合 true を返す
  handle: (interaction: Interaction) => Promise<boolean>
}

// 拡張子の優先順位で同名コマンドの重複を解消する
function pickPreferredFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const byBase = new Map<string, { ext: string; full: string }>()
  for (const name of entries) {
    const ext = extname(name)
    if (!SUPPORTED_EXTS.includes(ext as (typeof SUPPORTED_EXTS)[number])) continue
    const full = join(dir, name)
    if (!statSync(full).isFile()) continue
    const base = basename(name, ext)
    const current = byBase.get(base)
    if (!current) {
      byBase.set(base, { ext, full })
      continue
    }
    // 優先順位の高い拡張子（先頭）を残す
    const currentRank = SUPPORTED_EXTS.indexOf(current.ext as (typeof SUPPORTED_EXTS)[number])
    const candidateRank = SUPPORTED_EXTS.indexOf(ext as (typeof SUPPORTED_EXTS)[number])
    if (candidateRank < currentRank) byBase.set(base, { ext, full })
  }
  return [...byBase.values()].map((v) => v.full)
}

function isAvatarCommand(value: unknown): value is AvatarCommand {
  if (!value || typeof value !== "object") return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.definition === "object" &&
    obj.definition !== null &&
    typeof obj.execute === "function"
  )
}

// 空のレジストリ（commands ディレクトリがない場合）
function createEmptyRegistry(): AvatarCommandRegistry {
  return {
    size: 0,
    async registerToGuild() {},
    async handle() {
      return false
    },
  }
}

export async function loadAvatarCommands(config: AppConfig): Promise<AvatarCommandRegistry> {
  const baseDir = config.avatarDir
  if (!baseDir) return createEmptyRegistry()

  const commandsDir = join(baseDir, "commands")
  if (!existsSync(commandsDir) || !statSync(commandsDir).isDirectory()) {
    return createEmptyRegistry()
  }

  const files = pickPreferredFiles(commandsDir)
  if (files.length === 0) return createEmptyRegistry()

  const byName = new Map<string, AvatarCommand>()
  const byPrefix = new Map<string, AvatarCommand>()

  for (const file of files) {
    let mod: Record<string, unknown>
    try {
      mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>
    } catch (err) {
      log.error(
        `[AVATAR-CMD] 読み込み失敗: ${file} — ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }

    const candidate = mod.default ?? mod.command
    if (!isAvatarCommand(candidate)) {
      log.error(`[AVATAR-CMD] AvatarCommand 形式ではありません: ${file}`)
      continue
    }
    const command = candidate

    if (command.isEnabled && !command.isEnabled(config)) {
      continue
    }

    if (byName.has(command.definition.name)) {
      throw new Error(`AvatarCommand 重複: ${command.definition.name}`)
    }
    byName.set(command.definition.name, command)
    if (command.customIdPrefix) byPrefix.set(command.customIdPrefix, command)
  }

  // customId からマッチするプレフィックスを引く（最長一致）
  function findByCustomId(customId: string): AvatarCommand | undefined {
    let best: AvatarCommand | undefined
    let bestLen = -1
    for (const [prefix, cmd] of byPrefix) {
      if (customId === prefix || customId.startsWith(`${prefix}:`)) {
        if (prefix.length > bestLen) {
          best = cmd
          bestLen = prefix.length
        }
      }
    }
    return best
  }

  return {
    size: byName.size,

    async registerToGuild(guild) {
      const definitions = [...byName.values()].map((v) => v.definition)
      await guild.commands.set(definitions)
    },

    async handle(interaction) {
      const isChat = interaction.isChatInputCommand()
      const isSelect = interaction.isStringSelectMenu()
      const isModal = interaction.isModalSubmit()
      if (!isChat && !isSelect && !isModal) return false

      const command = isChat
        ? byName.get(interaction.commandName)
        : findByCustomId(interaction.customId)
      if (!command) return false

      if (command.ownerOnly) {
        const role = resolveDiscordRole(interaction.user.id, config)
        if (role !== "owner") {
          await interaction.reply({ content: "⛔ 実行権限がありません", ephemeral: true })
          return true
        }
      }

      try {
        if (isChat) {
          await command.execute({ config, interaction })
        } else if (isSelect) {
          if (!command.handleStringSelectMenu) return false
          await command.handleStringSelectMenu({ config, interaction })
        } else {
          if (!command.handleModalSubmit) return false
          await command.handleModalSubmit({ config, interaction })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error(`[AVATAR-CMD] /${command.definition.name} 実行失敗: ${msg}`)
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction
            .reply({ content: `エラー: ${msg}`, ephemeral: true })
            .catch(() => {})
        }
      }
      return true
    },
  }
}
