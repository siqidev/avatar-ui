import "dotenv/config"
import { app, BrowserWindow } from "electron"
import { join } from "node:path"
import { getConfig, ensureDirectories } from "../config.js"
import { registerIpcHandlers, safeDetach, getStateSnapshot, handleStreamPost } from "./ipc-handlers.js"
import { registerFsIpcHandlers } from "./fs-ipc-handlers.js"
import { registerTerminalIpcHandlers } from "./terminal-ipc-handlers.js"
import { spawnPty, dispose as disposeTerminal } from "../runtime/terminal-service.js"
import { stopRuntime } from "../runtime/field-runtime.js"
import { createSessionWsServer } from "../runtime/session-ws-server.js"
import type { SessionWsServer } from "../runtime/session-ws-server.js"
import { startTunnel, stopTunnel } from "./tunnel-manager.js"
import { isDiscordEnabled } from "../config.js"
import { createDiscordBridge } from "../discord/discord-bridge.js"
import type { DiscordBridge } from "../discord/discord-bridge.js"
import { loadSettings, getSettings } from "../runtime/settings-store.js"
import { setLocale } from "../shared/i18n.js"
import { buildAppMenu } from "./menu.js"
import { registerDemoIpcHandlers } from "./demo-ipc-handlers.js"
import * as log from "../logger.js"

let mainWindow: BrowserWindow | null = null
let sessionWs: SessionWsServer | null = null
let discordBridge: DiscordBridge | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 640,
    minHeight: 480,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  // 開発時はVite DevServer、プロダクションはローカルHTML
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }

  // ページロード完了後、Mainの正本設定をRendererへ送信（SSOT: settings.json → localStorage同期）
  mainWindow.webContents.on("did-finish-load", () => {
    const s = getSettings()
    mainWindow?.webContents.send("settings.theme", s.theme)
    mainWindow?.webContents.send("settings.locale", s.locale)
  })

  // ウィンドウ閉じ → safeDetach（場の状態を永続化）
  mainWindow.on("close", () => {
    safeDetach()
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })

  // レンダラプロセス異常終了 → safeDetach
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log.error(`[ELECTRON] レンダラプロセス異常終了: ${details.reason}`)
    safeDetach()
  })
}

app.whenReady().then(() => {
  // fail-fast: config初期化（.envのZodバリデーション）
  const config = getConfig()
  ensureDirectories(config)

  // 設定ストア初期化（ユーザー嗜好: テーマ・モデル・言語・共振モード）
  loadSettings(config.dataDir)
  setLocale(getSettings().locale)

  // Aboutパネル（version: "" でElectronビルド番号の括弧表示を抑制）
  app.setAboutPanelOptions({
    applicationName: "Avatar UI",
    applicationVersion: "0.3.0",
    version: "",
    copyright: `© ${new Date().getFullYear()} siqidev`,
  })

  // カスタムメニュー（テーマ・モデル・言語）
  buildAppMenu(() => mainWindow)

  // cloudflaredトンネル起動（トークン設定時のみ）
  if (config.cloudflaredToken) {
    startTunnel(config.cloudflaredToken)
  }

  registerIpcHandlers(() => mainWindow)

  // セッションWebSocketサーバー起動（SESSION_WS_TOKEN設定時のみ認証有効）
  sessionWs = createSessionWsServer({
    port: config.sessionWsPort,
    token: config.sessionWsToken,
    getStateSnapshot,
    onStreamPost: handleStreamPost,
  })
  sessionWs.start()

  // Discord窓口起動（DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID 設定時のみ）
  if (isDiscordEnabled(config)) {
    discordBridge = createDiscordBridge(config)
    discordBridge.start().catch((err) => {
      log.error(`[DISCORD] 起動失敗: ${err instanceof Error ? err.message : String(err)}`)
      discordBridge = null
    })
  }

  registerFsIpcHandlers()
  registerTerminalIpcHandlers(() => mainWindow)
  spawnPty()
  registerDemoIpcHandlers(app.getAppPath())
  createWindow()
  log.info("[ELECTRON] ウィンドウ起動")
})

// macOS: Dockアイコンクリックでウィンドウ再生成
app.on("activate", () => {
  if (mainWindow === null) {
    createWindow()
  }
})

// 全ウィンドウ閉じてもMain常駐（macOS以外でも場を維持するため）
app.on("window-all-closed", () => {
  // app.quit() しない = Main常駐
  log.info("[ELECTRON] 全ウィンドウ閉じ — Main常駐")
})

// アプリ終了時にクリーンアップ
app.on("before-quit", () => {
  safeDetach()
  void discordBridge?.stop()
  discordBridge = null
  sessionWs?.stop()
  sessionWs = null
  disposeTerminal()
  stopTunnel()
  stopRuntime()
})
