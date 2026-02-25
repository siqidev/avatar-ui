import "dotenv/config"
import { app, BrowserWindow } from "electron"
import { join } from "node:path"
import { registerIpcHandlers } from "./ipc-handlers.js"
import { stopRuntime } from "./field-runtime.js"
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
  registerIpcHandlers(() => mainWindow)
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

// アプリ終了時に観測サーバーをクリーンアップ
app.on("before-quit", () => {
  stopRuntime()
})
