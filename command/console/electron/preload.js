const fs = require('fs');
const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');

// プロジェクトルートのパス
const projectRoot = path.join(__dirname, '..', '..', '..');

// .envは標準の場所があるので、環境変数があれば優先して読み込む。
const envPath = process.env.AVATAR_ENV_PATH || path.join(projectRoot, '.env');
if (!fs.existsSync(envPath)) {
  throw new Error(`.env not found: ${envPath}`);
}
require('dotenv').config({ path: envPath });

// Core APIのURLとAPIキーは必須。未設定なら起動時に止める。
const apiUrl = process.env.AVATAR_CORE_URL;
const apiKey = process.env.AVATAR_API_KEY;
if (!apiUrl) {
  throw new Error('AVATAR_CORE_URL is not set');
}
if (!apiKey) {
  throw new Error('AVATAR_API_KEY is not set');
}

// UIからの入力をCoreに送信し、JSON応答を返す。
const think = async ({ source, text, sessionId }) => {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify({
      source,
      text,
      session_id: sessionId,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// package.json から製品名とバージョンを取得する。
const getAppInfo = () => {
  const metadata = require(path.join(__dirname, '..', 'package.json'));
  return {
    name: metadata.name,
    version: metadata.version,
  };
};

// Core から Console 用設定を取得する。
const getConsoleConfig = async () => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const response = await fetch(`${baseUrl}/console-config`, {
    headers: {
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// Core から管理用の設定を取得する。
const getAdminConfig = async () => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const response = await fetch(`${baseUrl}/admin/config`, {
    headers: {
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// Core に管理用の設定を更新させる。
const updateAdminConfig = async (payload) => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const response = await fetch(`${baseUrl}/admin/config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// Core から現在の状態を取得する。
const getState = async () => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const response = await fetch(`${baseUrl}/state`, {
    headers: {
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// 最近のイベントを取得する。
const getRecentEvents = async (after = null) => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const params = new URLSearchParams();
  if (after) {
    params.set('after', after);
  }
  const url = `${baseUrl}/events/recent${params.toString() ? '?' + params.toString() : ''}`;
  const response = await fetch(url, {
    headers: {
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// Core にターミナル結果を渡す。
const sendObservation = async (payload) => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const response = await fetch(`${baseUrl}/admin/observation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// Consoleの出力ログを保存する。
const logConsole = async (payload) => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const response = await fetch(`${baseUrl}/admin/console-log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// Core に承認を通知する。
const approveAction = async () => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const response = await fetch(`${baseUrl}/admin/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// Core に承認拒否を通知する。
const rejectAction = async () => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const response = await fetch(`${baseUrl}/admin/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// Core にタスク完了を通知する。
const completeAction = async (payload = {}) => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const response = await fetch(`${baseUrl}/admin/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// Core にタスク再試行を通知する。
const retryTask = async (payload) => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const response = await fetch(`${baseUrl}/admin/retry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// Core の状態をリセットする。
const resetState = async () => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const response = await fetch(`${baseUrl}/admin/reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// Core のループを続行する。
const continueLoop = async () => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const response = await fetch(`${baseUrl}/admin/continue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// Core のヘルス情報を取得する。
const getHealth = async () => {
  const baseUrl = apiUrl.replace(/\/v1\/think$/, '');
  const response = await fetch(`${baseUrl}/health`, {
    headers: {
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.detail ?? response.statusText;
    throw new Error(message);
  }
  return data;
};

// システム情報を取得する（IPC経由）。
const getSystemInfo = async () => {
  return ipcRenderer.invoke('system:info');
};

// Allowlist管理（data/allowlist.json）
const allowlistPath = path.join(projectRoot, 'data', 'allowlist.json');

const getAllowlist = () => {
  try {
    if (fs.existsSync(allowlistPath)) {
      const content = fs.readFileSync(allowlistPath, 'utf8');
      return JSON.parse(content);
    }
  } catch {
    // ファイルがないか読み込みエラー
  }
  return [];
};

const addToAllowlist = (program) => {
  if (!program) return;
  const list = getAllowlist();
  if (!list.includes(program)) {
    list.push(program);
    // dataディレクトリがなければ作成
    const dataDir = path.dirname(allowlistPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(allowlistPath, JSON.stringify(list, null, 2), 'utf8');
  }
};

const isInAllowlist = (command) => {
  if (!command) return false;
  const program = command.split(' ')[0];
  return getAllowlist().includes(program);
};

// レンダラに必要最小限のAPIだけ公開する。
contextBridge.exposeInMainWorld('avatarApi', {
  think,
  getAppInfo,
  getConsoleConfig,
  getAdminConfig,
  updateAdminConfig,
  getState,
  getRecentEvents,
  sendObservation,
  logConsole,
  approveAction,
  rejectAction,
  completeAction,
  retryTask,
  resetState,
  continueLoop,
  getHealth,
  getSystemInfo,
  getAllowlist,
  addToAllowlist,
  isInAllowlist,
});

// 端末操作をレンダラに公開する。
contextBridge.exposeInMainWorld('avatarTerminal', {
  create: (cols, rows) => ipcRenderer.invoke('terminal:create', { cols, rows }),
  write: (data) => ipcRenderer.send('terminal:write', data),
  resize: (cols, rows) => ipcRenderer.send('terminal:resize', { cols, rows }),
  onData: (handler) => {
    const listener = (_, data) => handler(data);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
});
