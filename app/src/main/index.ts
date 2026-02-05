import { app, BrowserWindow, globalShortcut, nativeImage } from 'electron'
import { join } from 'path'
import { config as loadEnv } from 'dotenv'

// Electron メインプロセスのエントリーポイント

// 開発判定: Vite dev server の有無
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

// 開発時だけ .env を読む（本番では同梱しない）
if (isDev) {
  loadEnv({ path: join(__dirname, '../../.env') })
}

// 環境変数から設定を読み取り（デフォルト: prod）
const APP_ENV = process.env.APP_ENV ?? 'prod'
const OPEN_DEVTOOLS = process.env.OPEN_DEVTOOLS       // DevTools 強制開閉
const ELECTRON_WARNINGS = process.env.ELECTRON_WARNINGS // 警告表示の強制指定
const APP_ID = 'com.avatar-ui.app'

// Electron の警告表示可否（デフォルト: dev=表示, prod=非表示）
const warningsEnabled = (() => {
  if (ELECTRON_WARNINGS === 'true') return true
  if (ELECTRON_WARNINGS === 'false') return false
  return APP_ENV !== 'prod' // デフォルト: prodでは隠す
})()

if (!warningsEnabled) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

// アイコンパスを解決（dev・prod両対応）
const resolveIconPath = () => {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(base, 'build', 'icon.png')
}

// メインウィンドウを生成
function createWindow() {
  const win = new BrowserWindow({
    width: 720,       // 16:9 に近い横幅。高さ360と組み合わせて初期レイアウトを確保
    height: 360,      // 初期高さ。全UIが収まる基準
    minWidth: 600,    // レイアウト崩れを防ぐ最小幅
    minHeight: 360,   // 主要UIが切れない最小高さ
    frame: false,     // ネイティブタイトルバーを除去
    transparent: true, // ウィンドウ背景を透過させる
    backgroundColor: '#00000000', // 透過背景の色（完全透明）
    roundedCorners: process.platform === 'darwin' ? false : undefined, // UI側の角丸と二重にしない
    hasShadow: false,  // 透過ウィンドウの影を消す
    title: 'Avatar UI', // フォールバック用タイトル
    icon: resolveIconPath(), // Windows/Linux でのウィンドウアイコン
    webPreferences: {
      nodeIntegration: false,      // 安全設定: レンダラーから Node を触らせない
      contextIsolation: true,      // 安全設定: コンテキスト分離
      sandbox: true,               // 安全設定: レンダラーをサンドボックス化
      devTools: isDev,             // 本番は無効
    }
  })

  // 開発時は Vite dev server、本番時はファイル
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    const shouldOpenDevTools =
      (APP_ENV === 'dev') || (OPEN_DEVTOOLS === 'true')
    if (shouldOpenDevTools && OPEN_DEVTOOLS !== 'false') {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    // ビルド後: dist-electron/index.js から dist/renderer/index.html
    win.loadFile(join(__dirname, '../dist/renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Windows タスクバー / 通知用 AppUserModelId
  app.setAppUserModelId(APP_ID)

  // Linux/Win のアプリ名を上書き（macは Info.plist 優先）
  app.setName('Avatar UI')
  app.setAboutPanelOptions({
    applicationName: 'Avatar UI',
    version: app.getVersion(),
  })

  // macOS 開発時でも Dock アイコンを上書き
  if (process.platform === 'darwin') {
    const icon = nativeImage.createFromPath(resolveIconPath())
    if (!icon.isEmpty()) {
      app.dock?.setIcon(icon)
    }
  }

  createWindow()
  // 共通ショートカット: Cmd/Ctrl+Q で終了
  globalShortcut.register('CommandOrControl+Q', () => app.quit())
})

// すべてのウィンドウが閉じられたら、macOS 以外ではアプリを終了する
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// macOS で Dock アイコンから再度アクティブになったらウィンドウを再作成する
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// アプリ終了時に登録済みショートカットを解放する
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
