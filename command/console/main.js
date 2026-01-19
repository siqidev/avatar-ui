// 画面の主要要素をまとめて取得。
const outputEl = document.getElementById('output');
const inputEl = document.getElementById('input');
const avatarImg = document.getElementById('avatar-img');
const metaBar = document.getElementById('meta');
const avatarLabel = document.getElementById('avatar-label');

if (!outputEl || !inputEl || !avatarImg || !metaBar || !avatarLabel) {
  throw new Error('UI elements missing');
}

// 会話セッションIDはブラウザに保存し、次回も同じ文脈を使えるようにする。
const idleSrc = avatarImg?.dataset?.idle;
const talkSrc = avatarImg?.dataset?.talk;
if (!idleSrc || !talkSrc) {
  throw new Error('Avatar data attributes are missing');
}
const sessionKey = 'spectra-session-id';
const storedSessionId = window.localStorage.getItem(sessionKey);
const sessionId = storedSessionId || crypto.randomUUID();
if (!storedSessionId) {
  window.localStorage.setItem(sessionKey, sessionId);
}

inputEl.disabled = true;

// 画面に1行追加し、自動でスクロールする。
const addLine = (className, text) => {
  const line = document.createElement('div');
  line.className = `text-line ${className}`.trim();
  line.textContent = text;
  outputEl.appendChild(line);
  outputEl.scrollTop = outputEl.scrollHeight;
};

// 応答中だけアバター画像を切り替える。
const setTalking = (isTalking) => {
  avatarImg.src = isTalking ? talkSrc : idleSrc;
};

const failFast = (message) => {
  isFatal = true;
  addLine('text-line--error', `ERROR> ${message}`);
  inputEl.disabled = true;
  throw new Error(message);
};

let consoleConfig = null;
let isFatal = false;

const requireSpectraApi = () => {
  if (!window.spectraApi) {
    failFast('spectraApi is not available');
  }
  return window.spectraApi;
};

// 取得したConsole設定をCSS変数と表示に反映する。
const applyConsoleConfig = (data) => {
  if (!data) {
    failFast('Console config is missing.');
  }
  const root = document.documentElement;
  const ui = data.console_ui;
  if (!ui) {
    failFast('console_ui is missing.');
  }

  const hexToRgb = (hex) => {
    if (typeof hex !== 'string') {
      return null;
    }
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!match) {
      return null;
    }
    return {
      r: parseInt(match[1], 16),
      g: parseInt(match[2], 16),
      b: parseInt(match[3], 16),
    };
  };

  const setRgb = (key, value) => {
    const rgb = hexToRgb(value);
    if (!rgb) {
      failFast(`console_ui.${key.replace('-', '_')} is invalid.`);
    }
    root.style.setProperty(`--${key}-r`, String(rgb.r));
    root.style.setProperty(`--${key}-g`, String(rgb.g));
    root.style.setProperty(`--${key}-b`, String(rgb.b));
  };

  setRgb('theme-color', ui.theme_color);
  setRgb('user-color', ui.user_color);
  setRgb('tool-color', ui.tool_color);

  if (ui.opacity !== undefined) {
    root.style.setProperty('--ui-opacity', String(ui.opacity));
  }
  if (ui.brightness !== undefined) {
    root.style.setProperty('--ui-brightness', String(ui.brightness));
  }
  if (ui.glow_text !== undefined) {
    root.style.setProperty('--glow-text-alpha1', String(0.6 * ui.glow_text));
    root.style.setProperty('--glow-text-alpha2', String(0.4 * ui.glow_text));
  }
  if (ui.glow_box !== undefined) {
    root.style.setProperty('--glow-box-alpha1', String(0.4 * ui.glow_box));
    root.style.setProperty('--glow-box-alpha2', String(0.2 * ui.glow_box));
  }
  if (ui.avatar_overlay_opacity !== undefined) {
    root.style.setProperty('--avatar-overlay-opacity', String(ui.avatar_overlay_opacity));
  }
  if (ui.avatar_brightness !== undefined) {
    root.style.setProperty('--avatar-brightness', String(ui.avatar_brightness));
  }

  if (!ui.name_tags?.avatar) {
    failFast('console_ui.name_tags.avatar is missing.');
  }
  avatarLabel.textContent = ui.name_tags.avatar;

  if (!ui.system_messages?.banner1 || !ui.system_messages?.banner2) {
    failFast('console_ui.system_messages is missing.');
  }
  addLine('text-line--system', `> ${ui.system_messages.banner1}`);
  addLine('text-line--system', `> ${ui.system_messages.banner2}`);

  consoleConfig = ui;
};

// CoreからConsole設定を取得する。
const loadConsoleConfig = async () => {
  const api = requireSpectraApi();
  if (!api.getConsoleConfig) {
    throw new Error('getConsoleConfig is not available');
  }
  return api.getConsoleConfig();
};

// 製品名とバージョンをUIに表示する。
const startUi = () => {
  const api = requireSpectraApi();
  if (!api.getAppInfo) {
    failFast('getAppInfo is not available');
  }
  const appInfo = api.getAppInfo();
  if (!appInfo?.name || !appInfo?.version) {
    failFast('App metadata is missing.');
  }
  metaBar.textContent = `${appInfo.name} v${appInfo.version}`;
};

// 初期化はfail-fastで行う（欠落や不整合は即停止）。
try {
  startUi();
  loadConsoleConfig()
    .then((data) => {
      applyConsoleConfig(data);
      inputEl.disabled = false;
      inputEl.focus();
    })
    .catch((error) => {
      failFast(error instanceof Error ? error.message : String(error));
    });
} catch (error) {
  failFast(error instanceof Error ? error.message : String(error));
}

// Enter入力でCore APIへ送信し、応答を表示する。
if (inputEl) {
  let isRunning = false;

  inputEl.addEventListener('keydown', (event) => {
    if (event.isComposing || event.key !== 'Enter') {
      return;
    }
    event.preventDefault();

    if (isRunning) {
      return;
    }

    const value = inputEl.value.trim();
    if (!value) {
      return;
    }

    if (!consoleConfig?.name_tags?.user) {
      failFast('console_ui.name_tags.user is missing.');
    }
    addLine('text-line--user', `${consoleConfig.name_tags.user}> ${value}`);
    inputEl.value = '';

    setTalking(true);
    isRunning = true;
    inputEl.disabled = true;

    // preloadで公開されたAPIが無ければエラー表示。
    const api = requireSpectraApi();
    if (!api.think) {
      failFast('Core API is unavailable.');
    }

    api.think({ prompt: value, sessionId, channel: 'command' })
      .then((data) => {
        if (!data?.response) {
          failFast('Core response is missing.');
        }
        addLine('text-line--assistant', `Spectra> ${data.response}`);
      })
      .catch((error) => {
        failFast(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setTalking(false);
        if (!isFatal) {
          inputEl.disabled = false;
          inputEl.focus();
        }
        isRunning = false;
      });
  });
}
