// 画面の主要要素をまとめて取得。
const outputEl = document.getElementById('output');
const inputEl = document.getElementById('input');
const avatarImg = document.getElementById('avatar-img');
const metaBar = document.getElementById('meta');
const avatarLabel = document.getElementById('avatar-label');
const terminalSurface = document.getElementById('terminal-surface');
const terminalHost = document.getElementById('terminal-host');
const commandPaletteEl = document.getElementById('command-palette');
const missionPurposeEl = document.getElementById('mission-purpose');
const missionGoalsEl = document.getElementById('mission-goals');
const inspectorTimelineEl = document.getElementById('inspector-timeline');
const vitalsCpuEl = document.getElementById('vitals-cpu');
const vitalsCpuBarEl = document.getElementById('vitals-cpu-bar');
const vitalsMemoryEl = document.getElementById('vitals-memory');
const vitalsMemoryBarEl = document.getElementById('vitals-memory-bar');
const vitalsNetworkEl = document.getElementById('vitals-network');
const vitalsNetworkBarEl = document.getElementById('vitals-network-bar');
const vitalsApiEl = document.getElementById('vitals-api');
const vitalsApiBarEl = document.getElementById('vitals-api-bar');

if (!outputEl || !inputEl || !avatarImg || !metaBar || !avatarLabel || !terminalSurface || !terminalHost || !commandPaletteEl || !missionPurposeEl || !missionGoalsEl) {
  throw new Error('UI elements missing');
}

// 会話セッションIDはブラウザに保存し、次回も同じ文脈を使えるようにする。
const idleSrc = avatarImg?.dataset?.idle;
const talkSrc = avatarImg?.dataset?.talk;
if (!idleSrc || !talkSrc) {
  throw new Error('Avatar data attributes are missing');
}
const sessionKey = 'avatar-session-id';
const storedSessionId = window.localStorage.getItem(sessionKey);
const sessionId = storedSessionId || crypto.randomUUID();
if (!storedSessionId) {
  window.localStorage.setItem(sessionKey, sessionId);
}
const runId = crypto.randomUUID();
let consoleLogSeq = 0;

// アバターエフェクト設定（configから読み込み、デフォルト値付き）
let avatarEffect = {
  enabled: true,
  charDelayMs: 25,
  blipFreqHz: 880,
  blipDurationMs: 25,
  blipVolume: 0.03,
  lipSyncIntervalMs: 80,
};

inputEl.disabled = true;

const getConsoleKind = (className) => {
  if (!className) return 'system';
  if (className.includes('text-line--avatar')) return 'avatar';
  if (className.includes('text-line--assistant')) return 'avatar';
  if (className.includes('text-line--user')) return 'user';
  if (className.includes('text-line--error')) return 'error';
  if (className.includes('text-line--system')) return 'system';
  return 'system';
};

const logConsoleEntry = ({ kind, text, pane }) => {
  if (!text || !text.trim()) {
    return;
  }
  const api = window.avatarApi;
  if (!api || !api.logConsole) {
    return;
  }
  const payload = {
    session_id: sessionId,
    run_id: runId,
    seq: consoleLogSeq++,
    kind,
    text,
    pane,
    client_time: new Date().toISOString(),
  };
  api.logConsole(payload).catch(() => {});
};

const logConsoleLine = (className, text) => {
  logConsoleEntry({ kind: getConsoleKind(className), text, pane: 'dialogue' });
};

let manualTalking = false;
let lipSyncActive = false;
let lipSyncOn = false;
let lipSyncTimer = null;
let isStreaming = false;
let streamQueue = [];
let audioContext = null;

const applyTalkingState = () => {
  const shouldTalk = manualTalking || (lipSyncActive && lipSyncOn);
  avatarImg.src = shouldTalk ? talkSrc : idleSrc;
};

const setTalking = (isTalking) => {
  manualTalking = Boolean(isTalking);
  applyTalkingState();
};

const scheduleLipSync = () => {
  if (!lipSyncActive) return;
  lipSyncOn = !lipSyncOn;
  applyTalkingState();
  lipSyncTimer = window.setTimeout(scheduleLipSync, avatarEffect.lipSyncIntervalMs);
};

const startLipSync = () => {
  if (lipSyncActive) {
    return;
  }
  lipSyncActive = true;
  if (lipSyncTimer) {
    window.clearTimeout(lipSyncTimer);
    lipSyncTimer = null;
  }
  scheduleLipSync();
};

const stopLipSync = () => {
  lipSyncActive = false;
  if (lipSyncTimer) {
    window.clearTimeout(lipSyncTimer);
    lipSyncTimer = null;
  }
  lipSyncOn = false;
  applyTalkingState();
};

const initAudioContext = () => {
  if (audioContext) {
    return audioContext;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return null;
  }
  audioContext = new AudioCtx();
  return audioContext;
};

const playBlip = () => {
  if (!avatarEffect.enabled) return;
  const ctx = initAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = avatarEffect.blipFreqHz;
  osc.connect(gain).connect(ctx.destination);
  
  const t = ctx.currentTime;
  const dur = avatarEffect.blipDurationMs / 1000;
  const vol = avatarEffect.blipVolume;
  // 軽いフェードアウトで「ポッ」感を出す
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.start(t);
  osc.stop(t + dur + 0.01);
};

const splitLabel = (text) => {
  if (!text) {
    return { label: '', body: '' };
  }
  const match = /^([^\s>]{1,32}>)(\s?)(.*)$/.exec(text);
  if (!match) {
    return { label: '', body: text };
  }
  const label = `${match[1]}${match[2] || ''}`;
  return { label, body: match[3] || '' };
};

const streamText = (targetEl, text) => new Promise((resolve) => {
  if (!text) { resolve(); return; }
  let i = 0;
  const step = () => {
    if (i >= text.length) { resolve(); return; }
    const char = text.charAt(i++);
    targetEl.textContent += char;
    outputEl.scrollTop = outputEl.scrollHeight;
    if (!/\s/.test(char)) playBlip();
    window.setTimeout(step, avatarEffect.charDelayMs);
  };
  step();
});

const processStreamQueue = async () => {
  if (isStreaming) {
    return;
  }
  isStreaming = true;
  startLipSync();
  while (streamQueue.length > 0) {
    const { targetEl, text } = streamQueue.shift();
    await streamText(targetEl, text);
  }
  stopLipSync();
  isStreaming = false;
  if (streamQueue.length > 0) {
    processStreamQueue();
  }
};

const enqueueStream = (targetEl, text) => {
  if (!targetEl || !text) {
    return;
  }
  streamQueue.push({ targetEl, text });
  processStreamQueue();
};

// 画面に1行追加し、自動でスクロールする。
const addLine = (className, text) => {
  const line = document.createElement('div');
  line.className = `text-line ${className}`.trim();
  logConsoleLine(className, text);

  const isAvatarLine = className?.includes('text-line--avatar') || className?.includes('text-line--assistant');
  if (isAvatarLine) {
    const { label, body } = splitLabel(text);
    if (label) {
      const labelSpan = document.createElement('span');
      labelSpan.className = 'text-line-label';
      labelSpan.textContent = label;
      line.appendChild(labelSpan);
    }
    const bodySpan = document.createElement('span');
    bodySpan.className = 'text-line-body';
    line.appendChild(bodySpan);
    outputEl.appendChild(line);
    outputEl.scrollTop = outputEl.scrollHeight;
    if (body) {
      enqueueStream(bodySpan, body);
    }
  } else {
    line.textContent = text;
    outputEl.appendChild(line);
    outputEl.scrollTop = outputEl.scrollHeight;
  }
};

const failFast = (message) => {
  isFatal = true;
  addLine('text-line--error', `ERROR> ${message}`);
  inputEl.disabled = true;
  throw new Error(message);
};

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

const setRgbVar = (root, key, value) => {
  const rgb = hexToRgb(value);
  if (!rgb) {
    failFast(`console_ui.${key.replace('-', '_')} is invalid.`);
  }
  root.style.setProperty(`--${key}-r`, String(rgb.r));
  root.style.setProperty(`--${key}-g`, String(rgb.g));
  root.style.setProperty(`--${key}-b`, String(rgb.b));
};

const applyThemeColors = (ui) => {
  if (!ui) {
    failFast('console_ui is missing.');
  }
  const root = document.documentElement;
  setRgbVar(root, 'theme-color', ui.theme_color);
  setRgbVar(root, 'user-color', ui.user_color);
  setRgbVar(root, 'tool-color', ui.tool_color);
};

let consoleConfig = null;
let adminConfig = null;
let isFatal = false;
let commandState = null;
let pendingApproval = null;
let approvalMenuIndex = 0; // 承認メニューの選択インデックス (0=Yes, 1=Always, 2=No)
let pendingNoInput = null; // No選択後の自由入力モード
let terminalCapture = null;
let resumeAfterUserInput = false;

const getLanguage = () => consoleConfig?.language || 'ja';
const t = (ja, en) => (getLanguage() === 'en' ? en : ja);

const resumeAfterUserInputIfNeeded = () => {
  if (!resumeAfterUserInput) {
    return Promise.resolve();
  }
  resumeAfterUserInput = false;
  const api = requireAvatarApi();
  if (!api.getState || !api.continueLoop) {
    return Promise.resolve();
  }
  return api.getState()
    .then((state) => {
      if (state?.action?.phase !== 'awaiting_continue') {
        return;
      }
      return api.continueLoop()
        .then(() => {
          addLine('text-line--system', `> ${t('続行', 'Continue')}`);
          updateMissionPane();
          updateInspectorPane();
        })
        .catch(() => {});
    })
    .catch(() => {});
};

const requireAvatarApi = () => {
  if (!window.avatarApi) {
    failFast('avatarApi is not available');
  }
  return window.avatarApi;
};

// ホワイトリスト管理（Always allow用）- data/allowlist.json に保存
const addToApprovalWhitelist = (command) => {
  if (!command) return;
  const program = command.split(' ')[0];
  const api = window.avatarApi;
  if (api?.addToAllowlist) {
    api.addToAllowlist(program);
  }
};

const isCommandWhitelisted = (command) => {
  const api = window.avatarApi;
  return api?.isInAllowlist ? api.isInAllowlist(command) : false;
};

// 端末APIが無ければ即停止する。
const requireAvatarTerminal = () => {
  if (!window.avatarTerminal) {
    failFast('avatarTerminal is not available');
  }
  return window.avatarTerminal;
};

// 管理APIが無ければ即停止する。
const requireAdminApi = () => {
  const api = requireAvatarApi();
  if (!api.getAdminConfig || !api.updateAdminConfig) {
    failFast('Admin config API is not available');
  }
  return api;
};

// 観測APIが無ければ即停止する。
const requireObservationApi = () => {
  const api = requireAvatarApi();
  if (!api.sendObservation) {
    failFast('Observation API is not available');
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
  applyThemeColors(ui);

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

  // アバターエフェクト設定をconfigから読み込み
  const eff = ui.avatar_effect || {};
  avatarEffect = {
    enabled: eff.enabled !== false,
    charDelayMs: eff.char_delay_ms ?? 25,
    blipFreqHz: eff.blip_freq_hz ?? 880,
    blipDurationMs: eff.blip_duration_ms ?? 25,
    blipVolume: eff.blip_volume ?? 0.03,
    lipSyncIntervalMs: eff.lip_sync_interval_ms ?? 80,
  };

  consoleConfig = ui;
};

// CoreからConsole設定を取得する。
const loadConsoleConfig = async () => {
  const api = requireAvatarApi();
  if (!api.getConsoleConfig) {
    throw new Error('getConsoleConfig is not available');
  }
  return api.getConsoleConfig();
};

// 最後に処理したイベントの時刻。
let lastEventTime = null;
// 初回ポーリングフラグ（過去イベントをスキップ）。
let isFirstPoll = true;

// イベントをポーリングしてdialogueに表示する。
const pollEvents = async () => {
  const api = requireAvatarApi();
  if (!api.getRecentEvents) {
    return;
  }
  try {
    const data = await api.getRecentEvents(lastEventTime);
    const events = data?.events || [];
    for (const event of events) {
      // 時刻を更新。
      if (event.time) {
        lastEventTime = event.time;
      }
      // 初回は時刻同期のみ（過去イベントは表示しない）。
      if (isFirstPoll) {
        continue;
      }
      // outputイベントをdialogueに表示。
      if (event.type === 'output' && event.pane === 'dialogue') {
        addLine('text-line--avatar', event.text);
      }
    }
    isFirstPoll = false;
    // イベントがあればペインも更新。
    if (events.length > 0 && !isFirstPoll) {
      updateMissionPane();
      updateInspectorPane();
    }
  } catch (error) {
    // ポーリングエラーは静かに無視。
  }
};

// Missionペインを更新する。
const updateMissionPane = async () => {
  const api = requireAvatarApi();
  if (!api.getState) {
    return;
  }
  try {
    const state = await api.getState();
    const mission = state?.mission || {};

    // Purpose表示
    const purpose = mission.purpose || '(none)';
    missionPurposeEl.textContent = `Purpose: ${purpose}`;

    // Goals表示
    const goals = mission.goals || [];
    missionGoalsEl.innerHTML = '';

    // 全体進捗を計算（ゴール達成数 / ゴール数）
    const totalGoals = goals.length;
    const doneGoals = goals.filter((g) => g.status === 'done').length;
    const totalRate = totalGoals > 0 ? Math.round((doneGoals / totalGoals) * 100) : 0;

    // 全体進捗バーを更新
    const barFill = document.getElementById('mission-bar-fill');
    const summaryRate = document.getElementById('mission-summary-rate');
    if (barFill) {
      barFill.style.width = `${totalRate}%`;
    }
    if (summaryRate) {
      summaryRate.textContent = `[${doneGoals}/${totalGoals}, ${totalRate}%]`;
    }

    if (goals.length === 0) {
      const noGoals = document.createElement('div');
      noGoals.className = 'mission-goal';
      noGoals.textContent = '(no goals)';
      missionGoalsEl.appendChild(noGoals);
      return;
    }

    goals.forEach((goal) => {
      const goalEl = document.createElement('div');
      goalEl.className = 'mission-goal';

      const tasks = goal.tasks || [];
      const doneCount = tasks.filter((t) => t.status === 'done').length;
      const totalCount = tasks.length;
      const rate = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

      // Goal header
      const header = document.createElement('div');
      header.className = 'mission-goal-header';

      const toggle = document.createElement('span');
      toggle.className = 'mission-goal-toggle';
      toggle.textContent = '▼';

      const goalId = document.createElement('span');
      goalId.className = 'mission-goal-id';
      goalId.textContent = goal.id;

      const goalName = document.createElement('span');
      goalName.className = 'mission-goal-name';
      goalName.textContent = goal.name;

      const goalRate = document.createElement('span');
      goalRate.className = 'mission-goal-rate';
      goalRate.textContent = `[${doneCount}/${totalCount}, ${rate}%]`;

      header.appendChild(toggle);
      header.appendChild(goalId);
      header.appendChild(goalName);
      header.appendChild(goalRate);
      goalEl.appendChild(header);

      // Tasks
      const tasksEl = document.createElement('div');
      tasksEl.className = 'mission-tasks';

      tasks.forEach((task) => {
        const taskEl = document.createElement('div');
        taskEl.className = 'mission-task';

        const icon = document.createElement('span');
        icon.className = `mission-task-icon mission-task-icon--${task.status}`;
        if (task.status === 'done') {
          icon.textContent = '✓';
        } else if (task.status === 'active') {
          icon.textContent = '●';
        } else if (task.status === 'fail') {
          icon.textContent = '✗';
        } else {
          icon.textContent = '○';
        }

        const taskId = document.createElement('span');
        taskId.className = 'mission-task-id';
        taskId.textContent = task.id;

        const taskName = document.createElement('span');
        taskName.className = 'mission-task-name';
        taskName.textContent = task.name;

        const taskStatus = document.createElement('span');
        taskStatus.className = 'mission-task-status';
        // active/pending はラベル表示、done/failは表示しない
        if (task.status === 'active' || task.status === 'pending') {
          taskStatus.textContent = `(${task.status})`;
        }

        taskEl.appendChild(icon);
        taskEl.appendChild(taskId);
        taskEl.appendChild(taskName);
        taskEl.appendChild(taskStatus);
        tasksEl.appendChild(taskEl);
      });

      goalEl.appendChild(tasksEl);

      // Toggle click handler
      header.addEventListener('click', () => {
        const isCollapsed = tasksEl.classList.toggle('is-collapsed');
        toggle.textContent = isCollapsed ? '▶' : '▼';
      });

      missionGoalsEl.appendChild(goalEl);
    });
  } catch (error) {
    console.error('Failed to update mission pane:', error);
  }
};

// Inspectorタイムラインに表示済みのイベントIDを追跡
let inspectorDisplayedEvents = new Set();
let inspectorIgnoreBefore = null;
const INSPECTOR_MAX_ENTRIES = 10;

const resetInspectorTimeline = () => {
  inspectorDisplayedEvents = new Set();
  inspectorIgnoreBefore = new Date().toISOString();
  if (inspectorTimelineEl) {
    inspectorTimelineEl.innerHTML = "";
  }
};

// Inspectorタイムラインにエントリを追加する（THINKのみ、2行表示）。
const addInspectorEntry = (text, isNew = true) => {
  if (!inspectorTimelineEl) return;

  // 「タスク：」「目標設定:」などのプレフィックスを除去
  const cleanText = text
    .replace(/^(タスク|目標|目標設定|判断|意図)[：:]\s*/gi, '')
    .trim();

  if (!cleanText) return;

  // 重複チェック（同じテキストが直前にあればスキップ）
  const firstChild = inspectorTimelineEl.firstElementChild;
  if (firstChild) {
    const existingText = firstChild.querySelector('.inspector-entry-text')?.textContent;
    if (existingText === cleanText) return;
  }

  // 既存のis-latestを削除
  inspectorTimelineEl.querySelectorAll('.is-latest').forEach((el) => {
    el.classList.remove('is-latest');
  });

  // 2行（約50文字）を超えるかどうかの判定
  const hasMore = cleanText.length > 50;

  // 新しいエントリを作成
  const entry = document.createElement('div');
  entry.className = `inspector-entry is-latest${isNew ? ' is-new' : ''}${hasMore ? ' has-more' : ''}`;

  // プロンプトとテキストを同じ行に
  const lineEl = document.createElement('div');
  lineEl.className = 'inspector-entry-line';

  const promptEl = document.createElement('span');
  promptEl.className = 'inspector-entry-prompt';
  promptEl.textContent = '>';

  const textEl = document.createElement('span');
  textEl.className = 'inspector-entry-text';
  textEl.textContent = cleanText;

  lineEl.appendChild(promptEl);
  lineEl.appendChild(textEl);
  entry.appendChild(lineEl);

  // クリックで展開/折りたたみ
  entry.addEventListener('click', () => {
    if (hasMore) {
      entry.classList.toggle('is-expanded');
    }
  });

  // 先頭に追加
  inspectorTimelineEl.insertBefore(entry, inspectorTimelineEl.firstChild);

  // アニメーション後にis-newを削除
  if (isNew) {
    setTimeout(() => entry.classList.remove('is-new'), 400);
  }

  // 最大数を超えたら古いエントリを削除
  while (inspectorTimelineEl.children.length > INSPECTOR_MAX_ENTRIES) {
    inspectorTimelineEl.removeChild(inspectorTimelineEl.lastChild);
  }
};

// Inspectorペインを更新する（イベントベース）。
const updateInspectorPane = async () => {
  const api = requireAvatarApi();
  if (!api.getState || !api.getRecentEvents) {
    return;
  }
  try {
    const state = await api.getState();
    const action = state?.action;

    // 自律ループからの承認待ちを検知（未処理の場合のみ）
    // approving のみ処理（awaiting_purpose_confirm は別処理）
    if (action?.phase === 'approving' && action?.command && !pendingApproval) {
      requestApproval('__terminal__', action.command, action.summary || action.command);
    }

    // 最近のイベントを取得してタイムラインに追加
    const data = await api.getRecentEvents();
    const events = data?.events || [];
    if (events.length === 0) return;

    // 新しいイベントを古い順に処理（タイムラインの先頭に追加するため）
    const ignoreBefore = inspectorIgnoreBefore ? new Date(inspectorIgnoreBefore).getTime() : null;
    const newEvents = events.filter((e) => !inspectorDisplayedEvents.has(e.time + e.type));
    
    // 古い順にソート
    newEvents.sort((a, b) => new Date(a.time) - new Date(b.time));

    for (const event of newEvents) {
      const eventId = event.time + event.type;
      if (ignoreBefore) {
        const eventTime = event.time ? new Date(event.time).getTime() : 0;
        if (eventTime && eventTime <= ignoreBefore) {
          inspectorDisplayedEvents.add(eventId);
          continue;
        }
      }
      inspectorDisplayedEvents.add(eventId);

      // THINKのみ表示（ACT/DONEはDialogueに表示されるため）
      if (event.type === 'thought') {
        const text = event.judgment || event.intent || '-';
        addInspectorEntry(text);
      }
      // action, result は無視（Dialogueで表示）
    }
  } catch (error) {
    console.error('Failed to update inspector pane:', error);
  }
};

// Vitalsペインを更新する（CSSバー、1秒更新）。
const updateVitalsPane = async () => {
  const api = requireAvatarApi();
  
  try {
    // システム情報とヘルス情報を並列取得
    const [sysInfo, health] = await Promise.all([
      api.getSystemInfo ? api.getSystemInfo() : null,
      api.getHealth ? api.getHealth() : null,
    ]);

    // CPU
    if (vitalsCpuEl && vitalsCpuBarEl && sysInfo?.cpu) {
      vitalsCpuEl.textContent = `${sysInfo.cpu.value}%`;
      vitalsCpuBarEl.style.width = `${sysInfo.cpu.value}%`;
    }
    
    // メモリ（単位はAPIから取得）
    if (vitalsMemoryEl && vitalsMemoryBarEl && sysInfo?.memory) {
      const percent = Math.round((sysInfo.memory.value / sysInfo.memory.max) * 100);
      vitalsMemoryEl.textContent = `${sysInfo.memory.value}${sysInfo.memory.unit}`;
      vitalsMemoryBarEl.style.width = `${percent}%`;
    }
    
    // ネットワーク
    if (vitalsNetworkEl && vitalsNetworkBarEl && sysInfo?.network) {
      const percent = Math.min(100, Math.round((sysInfo.network.value / sysInfo.network.max) * 100));
      const speed = sysInfo.network.value < 1 ? `${(sysInfo.network.value * 1000).toFixed(0)}Kbps` : `${sysInfo.network.value.toFixed(1)}Mbps`;
      vitalsNetworkEl.textContent = speed;
      vitalsNetworkBarEl.style.width = `${percent}%`;
    }
    
    // API（トークン使用量）
    if (vitalsApiEl && vitalsApiBarEl && health?.tokens) {
      vitalsApiEl.textContent = `${health.tokens.percent}%`;
      vitalsApiBarEl.style.width = `${health.tokens.percent}%`;
    }
  } catch (error) {
    console.error('Failed to update vitals:', error);
  }
};

// 製品名とバージョンをUIに表示する。
const startUi = () => {
  const api = requireAvatarApi();
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
  const terminalApi = requireAvatarTerminal();
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
    if (terminalCapture) {
      terminalCapture.buffer += data;
      if (terminalCapture.buffer.length > terminalCapture.maxBytes) {
        terminalCapture.buffer = terminalCapture.buffer.slice(-terminalCapture.maxBytes);
        terminalCapture.truncated = true;
      }
      clearTimeout(terminalCapture.timer);
      terminalCapture.timer = setTimeout(() => {
        terminalCapture.finish();
      }, terminalCapture.idleMs);
    }
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

  // ANSIエスケープを除去して読みやすくする。
  const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '');
  // 制御文字（バックスペース等）を除去して検証精度を上げる。
  const stripControlChars = (value) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

  // ターミナル実行の出力を一定時間だけ集めて確認する。
  const runCommand = (command) => {
    if (terminalCapture) {
      failFast('Terminal is busy');
    }
    const maxBytes = 2000;
    const idleMs = 800;
    return new Promise((resolve) => {
      terminalCapture = {
        buffer: '',
        command,
        maxBytes,
        idleMs,
        truncated: false,
        timer: null,
        finish: () => {
          let buffer = terminalCapture.buffer;
          // コマンドエコーバックの先頭文字重複を除去
          const firstChar = command[0];
          if (firstChar && buffer.startsWith(firstChar + command)) {
            buffer = buffer.slice(1);
          }
          const result = { ...terminalCapture, buffer };
          terminalCapture = null;
          resolve(result);
        },
      };
      // コマンドをそのまま実行（マーカーなし）
      terminalApi.write(`${command}\r`);
    });
  };

  // 提案されたターミナル操作を実行し、結果をコアに渡す。
  // 成功/失敗はLLMによる差分検証で判定（終了コード不使用）。
  window.runTerminalCommand = (command, label) => {
    addLine('text-line--system', `> run: ${label}`);
    const api = requireAvatarApi();
    runCommand(command)
      .then((result) => {
        const cleaned = stripControlChars(stripAnsi(result.buffer)).replace(/\r/g, '').trimEnd();
        const suffix = result.truncated ? '\n... (truncated)' : '';
        const output = cleaned + suffix;
        if (output.trim()) {
          logConsoleEntry({ kind: 'terminal', text: output, pane: 'terminal' });
        }

        // 明確な失敗パターンはLLM不要で即判定
        const FAIL_PATTERNS = [
          /no such file or directory/i,
          /command not found/i,
          /permission denied/i,
          /not recognized as/i,
          /cannot find/i,
          /does not exist/i,
        ];
        const explicitFailure = FAIL_PATTERNS.find((p) => p.test(output));
        if (explicitFailure) {
          return { success: false, message: `failed: ${label}` };
        }

        // 明確な失敗がなければLLMに検証させる
        const observation = {
          session_id: sessionId,
          command,
          output: output || '(no output)',
          label,
        };
        return api.sendObservation(observation);
      })
      .then((verifyResult) => {
        // 検証結果を受け取る（即判定またはCore側の差分検証）
        const success = verifyResult?.success !== false;
        const rawMessage = verifyResult?.message || `done: ${label}`;
        let summary = rawMessage;
        const lower = rawMessage.toLowerCase();
        if (lower.startsWith('done:')) {
          summary = rawMessage.slice(5).trim();
        } else if (lower.startsWith('failed:')) {
          summary = rawMessage.slice(7).trim();
        }
        if (!summary) summary = label;
        return api.completeAction({ success, summary }).then((result) => ({
          success,
          summary,
          nextAction: result?.action,
        }));
      })
      .then(({ success, summary, nextAction }) => {
        const prefix = success ? '✓ Done' : '✗ Failed';
        addLine('text-line--system', `${prefix}: ${summary}`);
        // ペインを更新
        updateMissionPane();
        updateInspectorPane();
        // 次のアクションがあれば承認プロンプトを表示
        if (nextAction?.phase === 'approving' && nextAction?.command && !pendingApproval) {
          requestApproval('__terminal__', nextAction.command, nextAction.summary || nextAction.command);
        }
      })
      .catch((error) => {
        // 失敗時も完了通知を送る（ベストエフォート）。
        api.completeAction({ success: false, summary: error.message }).catch(() => {});
        failFast(error instanceof Error ? error.message : String(error));
      });
  };
};

// 管理用の設定を読み込み、コマンドに使う。
const loadAdminConfig = async () => {
  const api = requireAdminApi();
  return api.getAdminConfig();
};

// ターミナル提案を実行する。
const runTerminalProposal = (command, label) => {
  if (!window.runTerminalCommand) {
    failFast('Terminal runner is not available');
  }
  window.runTerminalCommand(command, label);
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
  inputEl.placeholder = '';
};

// 承認メニューの選択肢
const APPROVAL_OPTIONS = [
  { key: 'y', label: 'Yes, allow once' },
  { key: 'a', label: 'Yes, always allow (add to allowlist)' },
  { key: 'n', label: "No — I'll give instructions" },
];

// 承認メニューを表示する。
const renderApprovalMenu = () => {
  if (!pendingApproval) return;
  // 既存のメニュー行を削除
  const existingMenu = document.querySelectorAll('.approval-menu-line');
  existingMenu.forEach((el) => el.remove());
  // 選択肢を表示
  APPROVAL_OPTIONS.forEach((opt, idx) => {
    const line = document.createElement('div');
    line.className = 'text-line text-line--system approval-menu-line';
    const marker = idx === approvalMenuIndex ? '▸' : ' ';
    line.textContent = `  ${marker} ${opt.label}`;
    outputEl.appendChild(line);
  });
  outputEl.scrollTop = outputEl.scrollHeight;
};

// 承認が必要な操作を記録する。
const requestApproval = (commandId, value, label) => {
  // 既に承認処理中なら二重発火を防ぐ
  if (pendingApproval) return;

  // ホワイトリストに登録されているコマンドは自動承認
  if (commandId === '__terminal__' && isCommandWhitelisted(value)) {
    pendingApproval = { commandId, value, label, auto: true };
    addLine('text-line--system', `> auto-approved (whitelisted): ${label}`);
    const api = requireAvatarApi();
    api.approveAction()
      .then(() => {
        runTerminalProposal(value, label);
      })
      .catch((error) => {
        addLine('text-line--error', `ERROR> ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        pendingApproval = null;
      });
    return;
  }
  
  pendingApproval = { commandId, value, label };
  approvalMenuIndex = 0;
  pendingNoInput = null;
    addLine('text-line--system', `> approve: ${label}`);
  renderApprovalMenu();
  inputEl.value = '';
  hidePalette();
};

// 空入力時に awaiting_continue なら続行する。
const handleEmptyContinue = async () => {
  const api = requireAvatarApi();
  try {
    const state = await api.getState();
    if (state?.action?.phase === 'awaiting_continue') {
      api.continueLoop()
        .then(() => {
          addLine('text-line--system', `> ${t('続行', 'Continue')}`);
          updateMissionPane();
          updateInspectorPane();
        })
        .catch((error) => {
          console.error('Continue failed:', error);
        });
    }
  } catch (error) {
    console.error('Failed to check continue state:', error);
  }
};

// 承認メニュー行を削除する。
const clearApprovalMenu = () => {
  const existingMenu = document.querySelectorAll('.approval-menu-line');
  existingMenu.forEach((el) => el.remove());
};

// No選択後の自由入力をLLMで処理する。
const handleNoInputWithLLM = async (action, userInput) => {
  const api = requireAvatarApi();
  const avatarName = consoleConfig?.name_tags?.avatar || 'SPECTRA';
  
  addLine('text-line--user', `USER> ${userInput}`);
  setTalking(true);
  
  try {
    // Coreに承認拒否を通知
    await api.rejectAction().catch(() => {}); // 既に拒否済みでもエラーを無視
    
    // ユーザー入力を送信
    const data = await api.think({ source: 'dialogue', text: userInput, sessionId });
    setTalking(false);
    
    // 新しいコマンド提案があれば承認メニューを表示
    if (data.intent === 'action' && data.proposal?.command) {
      const label = data.proposal.summary || data.proposal.command;
      requestApproval('__terminal__', data.proposal.command, label);
      return;
    }
    
    // 会話応答
    if (data.response) {
      addLine('text-line--assistant', `${avatarName}> ${data.response}`);
    }
    
    // LLMが新しい提案をしなかった場合、承認を終了
    // （ユーザーが「やめて」「別のことをやって」などと言った可能性）
    updateMissionPane();
    updateInspectorPane();
  } catch (error) {
    setTalking(false);
    addLine('text-line--error', `ERROR> ${error instanceof Error ? error.message : String(error)}`);
  }
};

// 承認メニューの選択を変更する。
const moveApprovalSelection = (delta) => {
  if (!pendingApproval || pendingNoInput) return;
  approvalMenuIndex = (approvalMenuIndex + delta + APPROVAL_OPTIONS.length) % APPROVAL_OPTIONS.length;
  renderApprovalMenu();
};

// 承認入力を処理する（Enterキー）。
const handleApprovalInput = () => {
  if (!pendingApproval) {
    return false;
  }
  
  // No選択後の自由入力モード
  if (pendingNoInput) {
    const userInput = inputEl.value.trim();
    if (!userInput) {
      return true; // 空入力は無視
    }
    const action = pendingNoInput;
    pendingNoInput = null;
    pendingApproval = null;
    clearApprovalMenu();
    inputEl.value = '';
    
    // LLMに入力を処理させる
    handleNoInputWithLLM(action, userInput);
    return true;
  }
  
  const action = pendingApproval;
  const selectedOption = APPROVAL_OPTIONS[approvalMenuIndex];
  clearApprovalMenu();
  inputEl.value = '';
  
  // No を選んだ場合は自由入力モードへ
  if (selectedOption.key === 'n') {
    pendingNoInput = action;
    addLine('text-line--system', `> ${selectedOption.label}`);
    addLine('text-line--system', '> Enter your instructions:');
    return true;
  }
  
  pendingApproval = null;
  
  // Always allow の場合、ホワイトリストに追加
  if (selectedOption.key === 'a') {
    addToApprovalWhitelist(action.value);
    addLine('text-line--system', `> added to allowlist: ${action.value?.split(' ')[0] || action.label}`);
  }
  
  addLine('text-line--system', `> ${selectedOption.label}`);
  
  // 承認処理
  const api = requireAvatarApi();

  // リセットは特別処理（Coreへの承認通知不要）
  if (action.commandId === '__reset__') {
    api.resetState()
      .then(() => {
        addLine('text-line--system', `> ${t('状態がリセットされました', 'State reset.')}`);
        resetInspectorTimeline();
        updateMissionPane();
        updateInspectorPane();
        inputEl.focus();
        return resumeAfterUserInputIfNeeded();
      })
      .catch((error) => {
        failFast(error instanceof Error ? error.message : String(error));
      });
    return true;
  }

  // 続行確認は特別処理
  if (action.commandId === '__continue__') {
    api.continueLoop()
      .then(() => {
        addLine('text-line--system', `> ${t('続行', 'Continue')}`);
        updateMissionPane();
        updateInspectorPane();
        inputEl.focus();
      })
      .catch((error) => {
        failFast(error instanceof Error ? error.message : String(error));
      });
    return true;
  }

  // 通常の承認をCoreに通知してからコマンドを実行。
  api.approveAction()
    .then(() => {
      if (action.commandId === '__terminal__') {
        runTerminalProposal(action.value, action.label);
      } else {
        applyAdminUpdate(action.commandId, action.value)
          .then(() => {
            inputEl.focus();
          })
          .catch((error) => {
            failFast(error instanceof Error ? error.message : String(error));
          });
      }
    })
    .catch((error) => {
      failFast(error instanceof Error ? error.message : String(error));
    });
  return true;
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
  // /reset は特別処理: 警告を出して確認を求める
  if (commandId === 'reset') {
    requestApproval(
      '__reset__',
      null,
      t('⚠️ 全ての状態（目的・目標・タスク）をリセット', '⚠️ Reset all state (purpose, goals, tasks)'),
    );
    resetCommandState();
    return;
  }
  if (commandId === 'retry') {
    commandState = { type: 'value', commandId };
    hidePalette();
    inputEl.value = '';
    inputEl.placeholder = 'retry task id (e.g., G4-T1)';
    return;
  }

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
  return api.updateAdminConfig(payload)
    .then((updated) => {
      adminConfig = updated;
      if (updated?.language && consoleConfig) {
        consoleConfig.language = updated.language;
      }
      if (commandId === 'language' && api.getState) {
        api.getState().then((state) => {
          renderStatePrompt(state);
        }).catch(() => {});
      }
      if (commandId === 'theme' && api.getConsoleConfig) {
        return api.getConsoleConfig().then((data) => {
          if (!data?.console_ui) {
            throw new Error('console_ui is missing.');
          }
          consoleConfig = data.console_ui;
          applyThemeColors(consoleConfig);
        });
      }
    })
    .then(() => resumeAfterUserInputIfNeeded())
    .catch((error) => {
      if (commandId === 'theme') {
        const message = error instanceof Error ? error.message : String(error);
        addLine('text-line--error', `ERROR> ${message}`);
        return resumeAfterUserInputIfNeeded();
      }
      throw error;
    });
};

const renderStatePrompt = (state) => {
  if (!state || !consoleConfig?.name_tags?.avatar) {
    return;
  }
  const purpose = state?.mission?.purpose;
  const judgment = state?.thought?.judgment;
  const action = state?.action;
  const avatarName = consoleConfig.name_tags.avatar || 'SPECTRA';

  // 承認待ち → 承認プロンプトを再表示
  if (action?.phase === 'approving' && action?.command && !pendingApproval) {
    requestApproval('__terminal__', action.command, action.summary || action.command);
    return;
  }

  // 続行待ち → [Enter] で続行を再表示
  if (action?.phase === 'awaiting_continue') {
    const label = action.summary || t('タスク完了', 'Task complete');
    addLine('text-line--system', `> ${label} ${t('[Enter] で続行', '[Enter] to continue')}`);
    return;
  }

  // 目的確認待ち → 確認プロンプトを再表示
  if (action?.phase === 'awaiting_purpose_confirm') {
    addLine(
      'text-line--avatar',
      `${avatarName}> ${t(
        `全ての目標が完了しました。目的「${purpose}」は達成されましたか？`,
        `All goals are complete. Has the purpose "${purpose}" been achieved?`,
      )}`,
    );
    addLine(
      'text-line--avatar',
      `${avatarName}> [y] Achieve / [n] Continue / ${t('新しい目的を入力', 'Enter a new purpose')}`,
    );
    return;
  }

  // 目的タイプ確認待ち → 再表示
  if (action?.phase === 'awaiting_purpose_type') {
    addLine(
      'text-line--avatar',
      `${avatarName}> ${t(`目的「${purpose}」は達成型ですか？`, `Is the purpose "${purpose}" finite?`)}`,
    );
    addLine('text-line--avatar', `${avatarName}> [y] Achieve / [n] Continue`);
    return;
  }

  // Goal候補承認待ち → 再表示
  if (action?.phase === 'awaiting_goals_confirm') {
    const goals = action?.data?.goals || [];
    const goalList = goals.map((g, i) => `  ${i + 1}. ${g.name}`).join('\n');
    addLine(
      'text-line--avatar',
      `${avatarName}> ${t('目標案を提案します。', 'Proposed goals:')}\n${goalList}\n${t('この目標群で進めますか？', 'Proceed with these goals?')} [y] ${t('承認', 'Approve')} / [n] ${t('再提案', 'Re-propose')} / ${t('修正内容を入力', 'Enter revisions')}`,
    );
    return;
  }

  // Task候補承認待ち → 再表示
  if (action?.phase === 'awaiting_tasks_confirm') {
    const tasks = action?.data?.tasks || [];
    const taskList = tasks.map((t, i) => `  ${i + 1}. ${t.name}`).join('\n');
    addLine(
      'text-line--avatar',
      `${avatarName}> ${t('タスク案を提案します。', 'Proposed tasks:')}\n${taskList}\n${t('このタスク群で進めますか？', 'Proceed with these tasks?')} [y] ${t('承認', 'Approve')} / [n] ${t('再提案', 'Re-propose')} / ${t('修正内容を入力', 'Enter revisions')}`,
    );
    return;
  }

  // 目標完了承認待ち → 再表示
  if (action?.phase === 'awaiting_goal_complete') {
    const goalId = action?.data?.goal_id;
    const goal = state?.mission?.goals?.find((g) => g.id === goalId);
    const goalName = goal?.name || action?.summary || t('目標', 'Goal');
    addLine(
      'text-line--avatar',
      `${avatarName}> ${t(
        `全てのタスクが完了しました。目標「${goalName}」は達成されましたか？`,
        `All tasks are complete. Has the goal "${goalName}" been achieved?`,
      )}`,
    );
    addLine('text-line--avatar', `${avatarName}> [y] Achieve / [n] Continue`);
    return;
  }

  // タスク失敗待ち → 再表示
  if (action?.phase === 'awaiting_task_fail') {
    const summary = action?.data?.summary || action?.summary || '';
    let taskName = t('タスク', 'Task');
    const goals = state?.mission?.goals || [];
    for (const goal of goals) {
      const activeTask = (goal.tasks || []).find((task) => task.status === 'active');
      if (activeTask) {
        taskName = activeTask.name || taskName;
        break;
      }
    }
    const summaryText = summary ? `: ${summary}` : '';
    addLine(
      'text-line--avatar',
      `${avatarName}> ${t(
        `タスク「${taskName}」が失敗しました${summaryText}`,
        `Task "${taskName}" failed${summaryText}`,
      )}\n[r] ${t('再試行', 'Retry')} / [s] ${t('スキップ', 'Skip')} / ${t('コンテキストを入力', 'Enter context')}`,
    );
    return;
  }

  // purpose未設定 → 問いかけを表示
  if (!purpose && (judgment === 'purpose未設定' || judgment === 'Purpose not set')) {
    addLine(
      'text-line--avatar',
      `${avatarName}> ${t('目的が設定されていません。何を達成しましょうか？', 'Purpose is not set. What should we achieve?')}`,
    );
  }
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
      // Missionペイン・Inspectorペイン・Vitalsペインを初期化
      updateMissionPane();
      updateInspectorPane();
      updateVitalsPane();
      // 起動時に現在の状態に応じたプロンプトを再表示
      const api = requireAvatarApi();
      api.getState().then((state) => {
        renderStatePrompt(state);
      }).catch(() => {});
      // イベントポーリング開始（3秒間隔）
      setInterval(pollEvents, 3000);
      pollEvents();
      // Vitals更新（1秒間隔）
      setInterval(updateVitalsPane, 1000);
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
      const label = `${item.commandId}=${item.label}`;
      applyAdminUpdate(item.commandId, item.value)
        .then(() => {
          resetCommandState();
          inputEl.value = '';
          inputEl.focus();
          addLine('text-line--system', `> updated: ${item.commandId}`);
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
  if (commandState.commandId === 'retry') {
    const api = requireAvatarApi();
    api.retryTask({ task_id: value })
      .then(() => {
        resetCommandState();
        inputEl.value = '';
        inputEl.focus();
        addLine('text-line--system', `> retry: ${value}`);
        updateMissionPane();
        updateInspectorPane();
        return resumeAfterUserInputIfNeeded();
      })
      .catch((error) => {
        failFast(error instanceof Error ? error.message : String(error));
      });
    return true;
  }
  applyAdminUpdate(commandState.commandId, value)
    .then(() => {
      resetCommandState();
      inputEl.value = '';
      inputEl.focus();
    addLine('text-line--system', `> updated: ${commandState.commandId}`);
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

    // パレット選択中はエンターで確定
    if (commandState?.type === 'commands' || commandState?.type === 'options') {
      confirmPaletteSelection();
      return;
    }

    if (commandState?.type === 'value') {
      confirmValueInput();
      return;
    }

    const value = inputEl.value.trim();

    // スラッシュコマンドは承認待ちより優先
    if (value.startsWith('/')) {
      // 承認待ちや継続待ちをキャンセル
      if (pendingApproval) {
        addLine('text-line--system', `> canceled: ${pendingApproval.label}`);
        clearApprovalMenu();
        // Coreにキャンセルを通知
        const api = requireAvatarApi();
        resumeAfterUserInput = true;
        api.cancelAction().catch(() => {});
        pendingApproval = null;
        pendingNoInput = null;
      }
      openCommandPalette(value.slice(1));
      return;
    }

    if (handleApprovalInput()) {
      return;
    }

    if (isRunning) {
      return;
    }

    if (!value) {
      // 空入力時: awaiting_continue なら続行
      handleEmptyContinue();
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
    const api = requireAvatarApi();
    if (!api.think) {
      failFast('Core API is unavailable.');
    }

    api.think({ source: 'dialogue', text: value, sessionId })
      .then((data) => {
        if (!data?.response) {
          failFast('Core response is missing.');
        }
        if (data.intent === 'action' && data.proposal?.command) {
          const label = data.proposal.summary || data.proposal.command;
          requestApproval('__terminal__', data.proposal.command, label);
          return;
        }
        const avatarName = consoleConfig?.name_tags?.avatar || 'SPECTRA';
        addLine('text-line--assistant', `${avatarName}> ${data.response}`);
      })
      .then(() => resumeAfterUserInputIfNeeded())
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
        // Missionペイン・Inspectorペインを更新
        updateMissionPane();
        updateInspectorPane();
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
    // 承認メニューの操作
    if (pendingApproval && !pendingNoInput) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveApprovalSelection(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveApprovalSelection(-1);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        // ESCで承認をキャンセル
        const action = pendingApproval;
        pendingApproval = null;
        clearApprovalMenu();
        addLine('text-line--system', `> canceled: ${action.label}`);
        // Coreにキャンセルを通知
        const api = requireAvatarApi();
        resumeAfterUserInput = true;
        api.cancelAction().catch(() => {});
        return;
      }
    }
    
    // コマンドパレットの操作
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

// --- スプリッター（リサイズハンドル）処理 ---
// ペイン間の境界をドラッグしてサイズ調整する。
(() => {
  const root = document.documentElement;
  const paneRight = document.getElementById('pane-right');
  const splitterMain = document.getElementById('splitter-main');
  const surfaceHost = document.getElementById('surface-host');

  if (!splitterMain || !paneRight || !surfaceHost) {
    return;
  }

  // 左右パネル間のスプリッター
  let isDraggingMain = false;

  splitterMain.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDraggingMain = true;
    splitterMain.classList.add('is-dragging');
    document.body.classList.add('is-resizing');
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDraggingMain) {
      return;
    }
    // 右パネル幅 = ウィンドウ右端 - マウスX座標 - 余白
    const appRect = document.querySelector('.app').getBoundingClientRect();
    const newWidth = appRect.right - e.clientX - 20;
    const clamped = Math.max(120, Math.min(400, newWidth));
    root.style.setProperty('--right-panel-width', `${clamped}px`);
  });

  document.addEventListener('mouseup', () => {
    if (isDraggingMain) {
      isDraggingMain = false;
      splitterMain.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing');
    }
  });

  // 垂直スプリッター（surface間）
  const verticalSplitters = surfaceHost.querySelectorAll('.splitter--vertical');

  verticalSplitters.forEach((splitter) => {
    let isDragging = false;
    let prevSurface = null;

    splitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      prevSurface = splitter.previousElementSibling;
      splitter.classList.add('is-dragging');
      document.body.classList.add('is-resizing', 'is-resizing-vertical');
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging || !prevSurface) {
        return;
      }
      const hostRect = surfaceHost.getBoundingClientRect();
      const surfaceRect = prevSurface.getBoundingClientRect();
      // 上surfaceの高さ = マウスY - surface上端
      const newHeight = e.clientY - surfaceRect.top;
      const minH = 60;
      const maxH = hostRect.height * 0.7;
      const clamped = Math.max(minH, Math.min(maxH, newHeight));
      prevSurface.style.flex = 'none';
      prevSurface.style.height = `${clamped}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        splitter.classList.remove('is-dragging');
        document.body.classList.remove('is-resizing', 'is-resizing-vertical');
        prevSurface = null;
      }
    });
  });
})();
