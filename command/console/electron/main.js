// Electronの起動に必要な標準モジュールを読み込む。
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const pty = require('node-pty');
const si = require('systeminformation');

// .envはプロジェクトルート直下が標準なので、環境変数があれば優先する。
const envPath = process.env.SPECTRA_ENV_PATH || path.join(__dirname, '..', '..', '..', '.env');
// .envが存在しない場合は起動時に止める。
if (!fs.existsSync(envPath)) {
  throw new Error(`.env not found: ${envPath}`);
}

// 環境変数をロードしてpreloadで参照できるようにする。
require('dotenv').config({ path: envPath });

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

// OS標準のシェルを返す。
const getDefaultShell = () => {
  if (process.platform === 'win32') return 'powershell.exe';
  if (process.platform === 'darwin') return '/bin/zsh';
  return '/bin/bash';
};

// Avatar Spaceのパスを返す（優先順位: 環境変数 > 設定 > デフォルト）。
const getDefaultAvatarSpace = () => {
  const home = process.env.HOME || process.env.USERPROFILE;
  return path.join(home, 'Avatar', 'space');
};

const getConfigPath = () => (
  process.env.AVATAR_CONFIG ||
  process.env.SPECTRA_CONFIG ||  // 後方互換（非推奨）
  path.join(__dirname, '..', '..', '..', 'config.yaml')
);

const readAvatarSpaceFromConfig = () => {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      if (!trimmed.startsWith('avatar_space:')) {
        continue;
      }
      let value = trimmed.slice('avatar_space:'.length).trim();
      if (!value) {
        return null;
      }
      value = value.split('#')[0].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return value || null;
    }
  } catch (error) {
    return null;
  }
  return null;
};

const getAvatarSpace = () => (
  process.env.AVATAR_SPACE ||
  readAvatarSpaceFromConfig() ||
  getDefaultAvatarSpace()
);

// シェルが許可されているか確認する。
const isAllowedShell = (shell) => {
  const lower = shell.toLowerCase();
  return lower.includes('bash') || lower.includes('zsh') || lower.includes('powershell');
};

// シェル起動時の引数を返す（バナー消去等）。
const getShellArgs = (shell) => {
  const lower = shell.toLowerCase();
  if (lower.includes('powershell')) {
    return ['-NoLogo', '-NoProfile'];  // バナー消去 + プロファイル無効化
  }
  return [];
};

// プロンプトカスタマイズ用の環境変数を返す。
const getShellEnv = (shell) => {
  const lower = shell.toLowerCase();
  const env = { ...process.env };
  
  if (lower.includes('bash') || lower.includes('zsh')) {
    // ディレクトリ名を表示するプロンプト
    env.PS1 = '\\W$ ';
  }
  // PowerShellはプロンプト関数が必要だが、-NoProfileでは効かないため別対応が必要
  // 現状はデフォルトプロンプトを使用
  
  return env;
};

// 端末プロセスを作成し、レンダラに入出力を流す。
const createTerminal = (webContents, cols, rows) => {
  if (terminals.has(webContents.id)) {
    return;
  }
  // シェル選択: 環境変数優先、未設定ならOS標準。
  const shell = process.env.SPECTRA_SHELL || getDefaultShell();
  // bash/zsh/PowerShellを許可する。
  if (!isAllowedShell(shell)) {
    throw new Error('SPECTRA_SHELL must be bash, zsh, or powershell');
  }
  // Avatar Space: アバターの生命活動空間
  const shellCwd = getAvatarSpace();
  // Avatar Spaceが存在しない場合は作成する。
  if (!fs.existsSync(shellCwd)) {
    fs.mkdirSync(shellCwd, { recursive: true });
  }
  const terminal = pty.spawn(shell, getShellArgs(shell), {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: shellCwd,
    env: getShellEnv(shell),
  });
  const dataSubscription = terminal.onData((data) => {
    webContents.send('terminal:data', data);
  });
  terminal._spectraDataSubscription = dataSubscription;
  terminals.set(webContents.id, terminal);
};

// 端末プロセスを破棄する。
const disposeTerminal = (webContentsId) => {
  const terminal = terminals.get(webContentsId);
  if (!terminal) {
    return;
  }
  if (terminal._spectraDataSubscription) {
    terminal._spectraDataSubscription.dispose();
    delete terminal._spectraDataSubscription;
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

// システム情報を取得する（CPU, メモリ, ネットワーク）。
ipcMain.handle('system:info', async () => {
  const [load, mem, net] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.networkStats(),
  ]);
  
  // ネットワーク速度はプライマリインターフェースから取得
  const primaryNet = net.find(n => n.operstate === 'up') || net[0] || {};
  const netSpeed = ((primaryNet.rx_sec || 0) + (primaryNet.tx_sec || 0)) / 1e6; // Mbps
  
  return {
    cpu: {
      value: Math.round(load.currentLoad),
      unit: '%',
      max: 100,
    },
    memory: {
      value: parseFloat((mem.used / 1e9).toFixed(1)),
      unit: 'GB',
      max: Math.round(mem.total / 1e9),
    },
    network: {
      value: parseFloat(netSpeed.toFixed(1)),
      unit: 'Mbps',
      max: 100, // 仮の上限
    },
  };
});

// ウィンドウが閉じたら端末プロセスも破棄する。
app.on('web-contents-created', (_, contents) => {
  contents.on('destroyed', () => {
    disposeTerminal(contents.id);
  });
});
