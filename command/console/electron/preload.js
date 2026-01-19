const fs = require('fs');
const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');

// .envは標準の場所があるので、環境変数があれば優先して読み込む。
const envPath = process.env.SPECTRA_ENV_PATH || path.join(__dirname, '..', '..', '..', '.env');
if (!fs.existsSync(envPath)) {
  throw new Error(`.env not found: ${envPath}`);
}
require('dotenv').config({ path: envPath });

// Core APIのURLとAPIキーは必須。未設定なら起動時に止める。
const apiUrl = process.env.SPECTRA_CORE_URL;
const apiKey = process.env.SPECTRA_API_KEY;
if (!apiUrl) {
  throw new Error('SPECTRA_CORE_URL is not set');
}
if (!apiKey) {
  throw new Error('SPECTRA_API_KEY is not set');
}

// UIからの入力をCoreに送信し、JSON応答を返す。
const think = async ({ prompt, sessionId, channel }) => {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify({
      prompt,
      session_id: sessionId,
      channel,
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

// レンダラに必要最小限のAPIだけ公開する。
contextBridge.exposeInMainWorld('spectraApi', {
  think,
  getAppInfo,
  getConsoleConfig,
  getAdminConfig,
  updateAdminConfig,
});

// 端末操作をレンダラに公開する。
contextBridge.exposeInMainWorld('spectraTerminal', {
  create: (cols, rows) => ipcRenderer.invoke('terminal:create', { cols, rows }),
  write: (data) => ipcRenderer.send('terminal:write', data),
  resize: (cols, rows) => ipcRenderer.send('terminal:resize', { cols, rows }),
  onData: (handler) => {
    const listener = (_, data) => handler(data);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
});
