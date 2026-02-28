import "dotenv/config"
import { app, BrowserWindow } from "electron"
import { join } from "node:path"
import { getConfig } from "../config.js"
import { registerIpcHandlers } from "./ipc-handlers.js"
import { registerFsIpcHandlers } from "./fs-ipc-handlers.js"
import { registerTerminalIpcHandlers } from "./terminal-ipc-handlers.js"
import { dispose as disposeTerminal } from "./terminal-service.js"
import { stopRuntime } from "./field-runtime.js"
import { startTunnel, stopTunnel } from "./tunnel-manager.js"
import * as log from "../logger.js"

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 800,
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

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // fail-fast: config初期化（.envのZodバリデーション）
  const config = getConfig()

  // cloudflaredトンネル起動（トークン設定時のみ）
  if (config.cloudflaredToken) {
    startTunnel(config.cloudflaredToken)
  }

  registerIpcHandlers(() => mainWindow)
  registerFsIpcHandlers()
  registerTerminalIpcHandlers(() => mainWindow)
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
  disposeTerminal()
  stopTunnel()
  stopRuntime()
})
