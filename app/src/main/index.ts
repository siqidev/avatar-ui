import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow() {
  const win = new BrowserWindow({
    width: 900,      // 横長レイアウトに最適化
    height: 500,     // スクリーンショットに近い比率
    minWidth: 600,   // レイアウト崩れを防ぐ最小幅
    minHeight: 400,  // レイアウト崩れを防ぐ最小高さ
    webPreferences: {
      nodeIntegration: false,      // ✅ 安全設定: Node機能無効
      contextIsolation: true,      // ✅ 安全設定: コンテキスト分離
    }
  })

  // 開発時は Vite dev server、本番時はファイル
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()  // 開発ツールを開く
  } else {
    // ビルド後: dist-electron/index.js から dist/renderer/index.html
    win.loadFile(join(__dirname, '../dist/renderer/index.html'))
  }
}

app.whenReady().then(createWindow)

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
