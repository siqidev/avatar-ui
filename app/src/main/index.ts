import { app, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'
import { config as loadEnv } from 'dotenv'

// ルートの .env を読み込む（dev/prod を合わせて扱うため）
loadEnv({ path: join(__dirname, '../../.env') })

const APP_ENV = process.env.APP_ENV ?? 'dev'
const OPEN_DEVTOOLS = process.env.OPEN_DEVTOOLS
const ELECTRON_WARNINGS = process.env.ELECTRON_WARNINGS

// Electron の警告表示可否（デフォルト: dev=表示, prod=非表示）
const warningsEnabled = (() => {
  if (ELECTRON_WARNINGS === 'true') return true
  if (ELECTRON_WARNINGS === 'false') return false
  return APP_ENV !== 'prod' // デフォルト: prodでは隠す
})()

if (!warningsEnabled) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

function createWindow() {
  const win = new BrowserWindow({
    width: 720,      // 16:9 aspect ratio based on height 360 (360 * 16 / 9 = 640)
    height: 360,     // 最小高さに合わせる
    minWidth: 600,   // レイアウト崩れを防ぐ最小幅
    minHeight: 360,  // 最小高さを合わせる
    frame: false,    // ネイティブタイトルバーを除去
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false, // 透過ウィンドウの影を削除（アーティファクト防止）
    webPreferences: {
      nodeIntegration: false,      // ✅ 安全設定: Node機能無効
      contextIsolation: true,      // ✅ 安全設定: コンテキスト分離
    }
  })

  // 開発時は Vite dev server、本番時はファイル
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    const shouldOpenDevTools =
      (APP_ENV === 'dev') || (OPEN_DEVTOOLS === 'true')
    if (OPEN_DEVTOOLS === 'false') {
      // 明示的に閉じる指定
    } else if (shouldOpenDevTools) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    // ビルド後: dist-electron/index.js から dist/renderer/index.html
    win.loadFile(join(__dirname, '../dist/renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  // 共通ショートカット: Cmd/Ctrl+Q で終了
  globalShortcut.register('CommandOrControl+Q', () => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
