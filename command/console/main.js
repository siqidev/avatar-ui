// 画面の主要要素をまとめて取得。
const outputEl = document.getElementById('output');
const inputEl = document.getElementById('input');
const avatarImg = document.getElementById('avatar-img');
const metaBar = document.getElementById('meta');
const avatarLabel = document.getElementById('avatar-label');
const terminalSurface = document.getElementById('terminal-surface');
const terminalHost = document.getElementById('terminal-host');
const commandPaletteEl = document.getElementById('command-palette');

if (!outputEl || !inputEl || !avatarImg || !metaBar || !avatarLabel || !terminalSurface || !terminalHost || !commandPaletteEl) {
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
let adminConfig = null;
let isFatal = false;
let commandState = null;

const requireSpectraApi = () => {
  if (!window.spectraApi) {
    failFast('spectraApi is not available');
  }
  return window.spectraApi;
};

// 端末APIが無ければ即停止する。
const requireTerminalApi = () => {
  if (!window.spectraTerminal) {
    failFast('spectraTerminal is not available');
  }
  return window.spectraTerminal;
};

// 管理APIが無ければ即停止する。
const requireAdminApi = () => {
  const api = requireSpectraApi();
  if (!api.getAdminConfig || !api.updateAdminConfig) {
    failFast('Admin config API is not available');
  }
  return api;
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

  if (!ui.command_palette?.commands || !ui.command_palette?.options) {
    failFast('console_ui.command_palette is missing.');
  }

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

// xtermを初期化して端末を接続する。
const setupTerminal = () => {
  const terminalApi = requireTerminalApi();
  if (!window.Terminal) {
    failFast('xterm is not available');
  }
  const fitFactory = window.FitAddon?.FitAddon;
  if (!fitFactory) {
    failFast('xterm-addon-fit is not available');
  }

  const terminal = new window.Terminal({
    fontFamily: 'Consolas, Menlo, monospace',
    cursorBlink: true,
    theme: {
      background: 'transparent',
      foreground: 'rgba(220, 255, 240, 0.95)',
    },
  });
  const fitAddon = new fitFactory();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalHost);
  fitAddon.fit();

  terminalApi.create(terminal.cols, terminal.rows).catch((error) => {
    failFast(error instanceof Error ? error.message : String(error));
  });
  terminalApi.onData((data) => {
    terminal.write(data);
  });
  terminal.onData((data) => {
    terminalApi.write(data);
  });

  const resizeTerminal = () => {
    fitAddon.fit();
    terminalApi.resize(terminal.cols, terminal.rows);
  };
  window.addEventListener('resize', resizeTerminal);
  terminal.focus();
};

// 管理用の設定を読み込み、コマンドに使う。
const loadAdminConfig = async () => {
  const api = requireAdminApi();
  return api.getAdminConfig();
};

// コマンド候補の表示を制御する。
const showPalette = () => {
  commandPaletteEl.classList.remove('is-hidden');
};

const hidePalette = () => {
  commandPaletteEl.classList.add('is-hidden');
  commandPaletteEl.innerHTML = '';
};

const renderPalette = (items, activeIndex) => {
  commandPaletteEl.innerHTML = '';
  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = `command-item${index === activeIndex ? ' is-active' : ''}`;
    row.dataset.value = item.value ?? '';
    row.dataset.commandId = item.commandId ?? '';
    row.innerHTML = `
      <span class="command-label">${item.label}</span>
      <span class="command-desc">${item.description ?? ''}</span>
    `.trim();
    commandPaletteEl.appendChild(row);
  });
  if (items.length === 0) {
    hidePalette();
    return;
  }
  showPalette();
};

const resetCommandState = () => {
  commandState = null;
  hidePalette();
};

// コマンドを選ぶ画面を表示する。
const openCommandPalette = (filterText) => {
  if (!consoleConfig?.command_palette?.commands) {
    failFast('Command palette config is missing.');
  }
  const keyword = filterText.toLowerCase();
  const items = consoleConfig.command_palette.commands
    .filter((cmd) => cmd.label.toLowerCase().startsWith(`/${keyword}`))
    .map((cmd) => ({
      label: cmd.label,
      description: cmd.description,
      commandId: cmd.id,
    }));
  commandState = { type: 'commands', items, activeIndex: 0 };
  renderPalette(items, 0);
};

// 選んだコマンドの値を選択する。
const openCommandOptions = (commandId) => {
  const options = consoleConfig?.command_palette?.options?.[commandId];
  if (!options) {
    commandState = { type: 'value', commandId };
    hidePalette();
    inputEl.value = '';
    inputEl.placeholder = `${commandId} value`;
    return;
  }
  const items = options.map((entry) => {
    if (entry && typeof entry === 'object') {
      return {
        label: entry.label ?? String(entry.value ?? ''),
        description: 'select value',
        value: entry.value,
        commandId,
      };
    }
    return {
      label: String(entry),
      description: 'select value',
      value: entry,
      commandId,
    };
  });
  commandState = { type: 'options', items, activeIndex: 0, commandId };
  renderPalette(items, 0);
};

// 管理APIで設定を更新する。
const applyAdminUpdate = (commandId, value) => {
  const api = requireAdminApi();
  const payload = { [commandId]: value };
  return api.updateAdminConfig(payload).then((updated) => {
    adminConfig = updated;
    addLine('text-line--system', `> updated ${commandId}`);
  });
};

// 初期化はfail-fastで行う（欠落や不整合は即停止）。
try {
  startUi();
  setupTerminal();
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

  // コマンド候補の選択を確定する。
  const confirmPaletteSelection = () => {
    if (!commandState) {
      return;
    }
    const { items, activeIndex, type } = commandState;
    const item = items?.[activeIndex];
    if (!item) {
      resetCommandState();
      return;
    }
    if (type === 'commands') {
      openCommandOptions(item.commandId);
      return;
    }
    if (type === 'options') {
      applyAdminUpdate(item.commandId, item.value)
        .then(() => {
          resetCommandState();
          inputEl.value = '';
          inputEl.placeholder = '';
          inputEl.focus();
        })
        .catch((error) => {
          failFast(error instanceof Error ? error.message : String(error));
        });
    }
  };

  // コマンド候補の選択位置を変更する。
  const movePaletteSelection = (direction) => {
    if (!commandState || !commandState.items) {
      return;
    }
    const total = commandState.items.length;
    if (total === 0) {
      return;
    }
    let nextIndex = commandState.activeIndex + direction;
    if (nextIndex < 0) {
      nextIndex = total - 1;
    }
    if (nextIndex >= total) {
      nextIndex = 0;
    }
    commandState.activeIndex = nextIndex;
    renderPalette(commandState.items, nextIndex);
  };

  // コマンドの値入力を確定する。
  const confirmValueInput = () => {
    if (!commandState || commandState.type !== 'value') {
      return false;
    }
    const value = inputEl.value.trim();
    if (!value) {
      failFast('Command value is missing.');
    }
    applyAdminUpdate(commandState.commandId, value)
      .then(() => {
        resetCommandState();
        inputEl.value = '';
        inputEl.placeholder = '';
        inputEl.focus();
      })
      .catch((error) => {
        failFast(error instanceof Error ? error.message : String(error));
      });
    return true;
  };

  inputEl.addEventListener('keydown', (event) => {
    if (event.isComposing || event.key !== 'Enter') {
      return;
    }
    event.preventDefault();

    if (commandState?.type === 'value') {
      confirmValueInput();
      return;
    }

    if (commandState?.type === 'commands' || commandState?.type === 'options') {
      confirmPaletteSelection();
      return;
    }

    if (isRunning) {
      return;
    }

    const value = inputEl.value.trim();
    if (!value) {
      return;
    }

    if (value.startsWith('/')) {
      openCommandPalette(value.slice(1));
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

  // 入力内容に応じてコマンド候補を出す。
  inputEl.addEventListener('input', () => {
    if (commandState?.type === 'value') {
      return;
    }
    const value = inputEl.value.trim();
    if (!value.startsWith('/')) {
      resetCommandState();
      return;
    }
    openCommandPalette(value.slice(1));
  });

  // 候補欄のクリックで選択する。
  commandPaletteEl.addEventListener('click', (event) => {
    const item = event.target.closest('.command-item');
    if (!item || !commandState) {
      return;
    }
    const index = Array.from(commandPaletteEl.children).indexOf(item);
    if (index < 0) {
      return;
    }
    commandState.activeIndex = index;
    confirmPaletteSelection();
  });

  // 矢印キーとESCで候補を操作する。
  inputEl.addEventListener('keydown', (event) => {
    if (!commandState || commandState.type === 'value') {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      movePaletteSelection(1);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      movePaletteSelection(-1);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      resetCommandState();
      inputEl.placeholder = '';
    }
  });
}
