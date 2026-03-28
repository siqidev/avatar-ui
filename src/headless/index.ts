// ヘッドレスエントリーポイント: Electron無しでFieldRuntimeを起動する
// VPS/ローカル両対応。Console UIをHTTP配信し、ブラウザからアクセス可能

import "dotenv/config"
import { getConfig, ensureDirectories, isDiscordEnabled } from "../config.js"
import { loadSettings, getSettings } from "../runtime/settings-store.js"
import { setLocale } from "../shared/i18n.js"
import { setAlertSink } from "../runtime/integrity-manager.js"
import { boot, attach, safeDetach, getStateSnapshot, handleStreamPost } from "../runtime/field-orchestrator.js"
import { stopRuntime } from "../runtime/field-runtime.js"
import { createConsoleHttpServer } from "../runtime/console-http-server.js"
import type { ConsoleHttpServer } from "../runtime/console-http-server.js"
import { createSessionWsServer } from "../runtime/session-ws-server.js"
import type { SessionWsServer } from "../runtime/session-ws-server.js"
import { createDiscordBridge } from "../discord/discord-bridge.js"
import type { DiscordBridge } from "../discord/discord-bridge.js"
import { startTunnel, stopTunnel } from "../main/tunnel-manager.js"
import * as path from "node:path"
import * as log from "../logger.js"

// --- 起動 ---

let consoleHttp: ConsoleHttpServer | null = null
let sessionWs: SessionWsServer | null = null
let discordBridge: DiscordBridge | null = null

async function main(): Promise<void> {
  // 1. config初期化（fail-fast）
  const config = getConfig()
  ensureDirectories(config)

  // 2. 設定ストア初期化
  loadSettings(config.dataDir)
  setLocale(getSettings().locale)

  // 3. alertSink: ヘッドレスではログ出力のみ
  setAlertSink((code, message) => {
    log.error(`[INTEGRITY:ALERT] ${code}: ${message}`)
  })

  // 4. FieldRuntime初期化 + サービス起動
  const ready = boot()
  if (!ready) {
    log.error("[HEADLESS] Runtime初期化失敗 — 終了")
    process.exit(1)
  }

  // 5. 場を即座にアクティブ化（GUIのattach相当）
  attach()
  log.info("[HEADLESS] 場をアクティブ化")

  // 6. cloudflaredトンネル起動（設定時のみ）
  if (config.cloudflaredToken) {
    startTunnel(config.cloudflaredToken)
  }

  // 7. Console HTTP + WebSocket サーバー起動（同一ポート）
  // rendererDir: electron-vite buildの出力先
  const rendererDir = path.resolve("out/renderer")
  consoleHttp = createConsoleHttpServer({
    port: config.sessionWsPort,
    token: config.sessionWsToken,
    rendererDir,
    devMode: config.devMode,
  })

  sessionWs = createSessionWsServer({
    port: config.sessionWsPort,
    token: config.sessionWsToken,
    getStateSnapshot,
    onStreamPost: handleStreamPost,
    httpServer: consoleHttp.httpServer, // HTTPサーバーを共有
  })

  // HTTP配信開始 → WS upgradeハンドラ登録
  consoleHttp.start()
  sessionWs.start()

  // 8. Discord窓口起動（設定時のみ）
  if (isDiscordEnabled(config)) {
    discordBridge = createDiscordBridge(config)
    try {
      await discordBridge.start()
    } catch (err) {
      log.error(`[DISCORD] 起動失敗: ${err instanceof Error ? err.message : String(err)}`)
      discordBridge = null
    }
  }

  log.info("[HEADLESS] 起動完了")
}

// --- graceful shutdown ---

function shutdown(): void {
  log.info("[HEADLESS] シャットダウン開始")
  safeDetach()
  void discordBridge?.stop()
  discordBridge = null
  sessionWs?.stop()
  sessionWs = null
  consoleHttp?.stop()
  consoleHttp = null
  stopTunnel()
  stopRuntime()
  log.info("[HEADLESS] シャットダウン完了")
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

// --- エントリー ---

main().catch((err) => {
  log.error(`[HEADLESS] 致命的エラー: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
