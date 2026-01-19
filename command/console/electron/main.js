// Electronの起動に必要な標準モジュールを読み込む。
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const pty = require('node-pty');

// .envはプロジェクトルート直下が標準なので、環境変数があれば優先する。
const envPath = process.env.SPECTRA_ENV_PATH || path.join(__dirname, '..', '..', '..', '.env');
// .envが存在しない場合は起動時に止める。
if (!fs.existsSync(envPath)) {
  throw new Error(`.env not found: ${envPath}`);
}

// 環境変数をロードしてpreloadで参照できるようにする。
require('dotenv').config({ path: envPath });

// ログの保存先を用意する。
const logDir = path.join(__dirname, '..', '..', '..', 'logs');
const chatLogPath = path.join(logDir, 'chat.log');
const cliLogPath = path.join(logDir, 'cli.log');

// メインウィンドウを作成し、UI（index.html）を読み込む。
const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 640,
    backgroundColor: '#000000',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
};

// 端末プロセスは1つだけ保持する。
const terminals = new Map();

// 端末プロセスを作成し、レンダラに入出力を流す。
const createTerminal = (webContents, cols, rows) => {
  if (terminals.has(webContents.id)) {
    return;
  }
  // OS非依存にするため、シェルは環境変数で明示する。
  const shell = process.env.SPECTRA_SHELL;
  if (!shell) {
    throw new Error('SPECTRA_SHELL is not set');
  }
  if (!shell.toLowerCase().includes('bash')) {
    throw new Error('SPECTRA_SHELL must be bash');
  }
  const shellCwd = process.env.SPECTRA_SHELL_CWD;
  if (!shellCwd) {
    throw new Error('SPECTRA_SHELL_CWD is not set');
  }
  const terminal = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: shellCwd,
    env: process.env,
  });
  terminal.onData((data) => {
    webContents.send('terminal:data', data);
  });
  terminals.set(webContents.id, terminal);
};

// 端末プロセスを破棄する。
const disposeTerminal = (webContentsId) => {
  const terminal = terminals.get(webContentsId);
  if (!terminal) {
    return;
  }
  terminal.kill();
  terminals.delete(webContentsId);
};

app.whenReady().then(() => {
  createWindow();

  // macOSはドックから復帰したときに再生成する。
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Windows/Linuxは全ウィンドウが閉じたら終了する。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// レンダラからの端末操作を受け付ける。
ipcMain.handle('terminal:create', (event, payload) => {
  if (!payload || !payload.cols || !payload.rows) {
    throw new Error('terminal size is missing');
  }
  createTerminal(event.sender, payload.cols, payload.rows);
});
ipcMain.on('terminal:write', (event, data) => {
  const terminal = terminals.get(event.sender.id);
  if (!terminal) {
    throw new Error('terminal is not initialized');
  }
  terminal.write(data);
});
ipcMain.on('terminal:resize', (event, payload) => {
  const terminal = terminals.get(event.sender.id);
  if (!terminal || !payload) {
    throw new Error('terminal is not initialized');
  }
  terminal.resize(payload.cols, payload.rows);
});

// チャット/CLIのログをファイルに書き込む。
ipcMain.on('log:chat', (_, line) => {
  if (!line) {
    throw new Error('chat log line is missing');
  }
  fs.appendFileSync(chatLogPath, `${line}\n`, 'utf8');
});
ipcMain.on('log:cli', (_, line) => {
  if (!line) {
    throw new Error('cli log line is missing');
  }
  fs.appendFileSync(cliLogPath, `${line}\n`, 'utf8');
});

// ウィンドウが閉じたら端末プロセスも破棄する。
app.on('web-contents-created', (_, contents) => {
  contents.on('destroyed', () => {
    disposeTerminal(contents.id);
  });
});
