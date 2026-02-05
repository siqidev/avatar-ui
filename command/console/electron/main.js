// Electronの起動に必要な標準モジュールを読み込む。
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const pty = require('node-pty');
const si = require('systeminformation');

// .envはプロジェクトルート直下が標準なので、環境変数があれば優先する。
const envPath = process.env.AVATAR_ENV_PATH || path.join(__dirname, '..', '..', '..', '.env');
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
  process.env.AVATAR_CONFIG ||  // 後方互換（非推奨）
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
  const shell = process.env.AVATAR_SHELL || getDefaultShell();
  // bash/zsh/PowerShellを許可する。
  if (!isAllowedShell(shell)) {
    throw new Error('AVATAR_SHELL must be bash, zsh, or powershell');
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
  terminal._avatarDataSubscription = dataSubscription;
  terminals.set(webContents.id, terminal);
};

// 端末プロセスを破棄する。
const disposeTerminal = (webContentsId) => {
  const terminal = terminals.get(webContentsId);
  if (!terminal) {
    return;
  }
  if (terminal._avatarDataSubscription) {
    terminal._avatarDataSubscription.dispose();
    delete terminal._avatarDataSubscription;
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

// アプリ関連プロセスのPIDを収集する。
const collectAppPids = (allProcs) => {
  const pids = new Set();
  const mainPid = process.pid;
  
  // Electronプロセスツリー（自身と子孫）
  const addDescendants = (parentPid) => {
    pids.add(parentPid);
    for (const p of allProcs) {
      if (p.parentPid === parentPid && !pids.has(p.pid)) {
        addDescendants(p.pid);
      }
    }
  };
  addDescendants(mainPid);
  
  // Python Core（uvicorn + core.main を含む）
  for (const p of allProcs) {
    if (p.name?.toLowerCase().includes('python')) {
      const cmd = (p.command || '').toLowerCase();
      if (cmd.includes('uvicorn') || cmd.includes('core.main') || cmd.includes('core/main')) {
        pids.add(p.pid);
      }
    }
  }
  
  return pids;
};

// システム情報を取得する（アプリ固有のCPU, メモリ + PC全体のネットワーク）。
ipcMain.handle('system:info', async () => {
  const [procs, mem, net] = await Promise.all([
    si.processes(),
    si.mem(),
    si.networkStats(),
  ]);
  
  const allProcs = procs.list || [];
  const appPids = collectAppPids(allProcs);
  
  // アプリ関連プロセスのCPU/メモリを合計
  let totalCpu = 0;
  let totalMem = 0;
  for (const p of allProcs) {
    if (appPids.has(p.pid)) {
      totalCpu += p.cpu || 0;
      totalMem += p.memRss || 0; // KB単位
    }
  }
  
  // ネットワーク速度（プロセス別は不可、PC全体）
  const primaryNet = net.find(n => n.operstate === 'up') || net[0] || {};
  const netSpeed = ((primaryNet.rx_sec || 0) + (primaryNet.tx_sec || 0)) / 1e6;
  
  return {
    cpu: {
      value: Math.round(totalCpu * 10) / 10,
      unit: '%',
      max: 100,
    },
    memory: {
      value: Math.round(totalMem / 1024), // KB→MB
      unit: 'MB',
      max: Math.round(mem.total / 1e6), // bytes→MB
    },
    network: {
      value: parseFloat(netSpeed.toFixed(1)),
      unit: 'Mbps',
      max: 100,
    },
  };
});

// ウィンドウが閉じたら端末プロセスも破棄する。
app.on('web-contents-created', (_, contents) => {
  contents.on('destroyed', () => {
    disposeTerminal(contents.id);
  });
});
