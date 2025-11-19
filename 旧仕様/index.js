(function (global) {
  const Terminal = global.Terminal;

  function writeLine(term, text, color) {
    if (!term || !text) return;
    if (color) {
      term.writeln(`\u001b[${color}${text}\u001b[0m`);
    } else {
      term.writeln(text);
    }
  }

  function createAvatarController(img) {
    const idle = img?.dataset?.idle || img?.src || null;
    const talk = img?.dataset?.talk || null;
    function setTalking(isTalking) {
      if (!img) return;
      const next = isTalking ? talk : idle;
      if (next && img.src !== next) img.src = next;
    }
    return Object.freeze({ setTalking });
  }

  function createTextSurface() {
    let container = null;
    let logEl = null;
    let proposedNode = null;

    function ensureDom() {
      if (container && logEl) return container;
      container = document.createElement('div');
      container.className = 'surface surface--text';
      logEl = document.createElement('div');
      logEl.className = 'text-scroll';
      container.appendChild(logEl);
      return container;
    }

    function scrollToBottom() {
      if (!logEl) return;
      logEl.scrollTop = logEl.scrollHeight;
    }

    function appendMessage(label, text, className) {
      if (!logEl || !text) return;
      const line = document.createElement('p');
      line.className = className ? `text-line ${className}` : 'text-line';
      if (label) {
        const strong = document.createElement('strong');
        strong.textContent = label;
        line.appendChild(strong);
        line.appendChild(document.createTextNode(` ${text}`));
      } else {
        line.textContent = text;
      }
      logEl.appendChild(line);
      scrollToBottom();
    }

    function removeProposed() {
      if (proposedNode && proposedNode.parentNode) {
        proposedNode.parentNode.removeChild(proposedNode);
      }
      proposedNode = null;
    }

    return Object.freeze({
      key: 'text',
      mount(host) {
        const node = ensureDom();
        host.appendChild(node);
        scrollToBottom();
      },
      unmount(host) {
        if (container && container.parentNode === host) {
          host.removeChild(container);
        }
      },
      focus() {
        scrollToBottom();
      },
      showSystemMessage(message) {
        if (message) appendMessage('[SYSTEM]', message, 'text-line--system');
      },
      showUserMessage(text) {
        if (text) appendMessage('USER>', text);
      },
      showAiMessage(text) {
        if (text) appendMessage('Spectra>', text);
      },
      showError(message) {
        if (message) appendMessage('ERROR>', message, 'text-line--error');
      },
      showProposed(commands) {
        removeProposed();
        if (!commands || !commands.length || !logEl) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'text-line text-line--proposed';
        const title = document.createElement('div');
        title.textContent = 'Proposed:';
        wrapper.appendChild(title);
        const code = document.createElement('pre');
        code.textContent = commands.join('\n');
        wrapper.appendChild(code);
        logEl.appendChild(wrapper);
        proposedNode = wrapper;
        scrollToBottom();
      },
      clearProposed(reason) {
        removeProposed();
        if (reason) appendMessage(null, reason, 'text-line--system');
      },
      handleTerminalStdout() {},
      handleTerminalExit() {
        removeProposed();
      },
    });
  }

  function createShellSurface(core, bridge) {
    let container = null;
    let terminalHost = null;
    let terminal = null;
    let resizeObserver = null;
    let lastProposed = null;

    function teardown() {
      if (resizeObserver) {
        try { resizeObserver.disconnect(); } catch (_) {}
        resizeObserver = null;
      }
      if (terminal) {
        try { terminal.dispose(); } catch (_) {}
        terminal = null;
      }
      terminalHost = null;
      container = null;
    }

    function handleResize() {
      if (!terminal || !terminalHost) return;
      const rect = terminalHost.getBoundingClientRect();
      const renderService = terminal._core?._renderService;
      const dimensions = renderService?.dimensions || {};
      const cellWidth = dimensions.actualCellWidth || 9;
      const cellHeight = dimensions.actualCellHeight || 17;
      const cols = Math.max(10, Math.floor(rect.width / cellWidth));
      const rows = Math.max(5, Math.floor(rect.height / cellHeight) - 2);
      try {
        terminal.resize(cols, rows);
      } catch (error) {
        console.warn('[ui-classic] termResize 失敗:', error);
      }
      try { bridge?.termResize?.({ cols, rows }); } catch (_) {}
      if (core && typeof core.publish === 'function') {
        core.publish({
          topic: 'input',
          type: core.EVENT_TYPES.TERMINAL_RESIZE,
          payload: { cols, rows },
        }).catch((error) => {
          console.error('[ui-classic] core.publish(TERMINAL_RESIZE) failed', error);
        });
      }
    }

    function showProposedLines(commands) {
      if (!terminal || !commands || !commands.length) return;
      writeLine(terminal, 'Proposed:', '38;2;0;204;0m');
      commands.forEach((cmd) => writeLine(terminal, cmd));
      writeLine(terminal, '[Enter=実行 / Esc=キャンセル]', '38;2;0;204;0m');
    }

    return Object.freeze({
      key: 'shell',
      mount(host) {
        container = document.createElement('div');
        container.className = 'surface surface--shell';
        terminalHost = document.createElement('div');
        terminalHost.className = 'terminal-host';
        terminalHost.id = 'terminal';
        container.appendChild(terminalHost);
        host.appendChild(container);

        if (!Terminal) {
          console.error('Terminal クラスが見つかりません。@xterm/xterm の読み込みを確認してください。');
          return;
        }

        terminal = new Terminal({
          convertEol: true,
          cursorBlink: true,
          scrollback: 2000,
          theme: { background: '#000000', foreground: '#00ff00', cursor: '#00ff00' },
        });
        terminal.open(terminalHost);
        terminal.focus();
        terminal.onData((data) => {
          if (!data || !core) return;
          core.publish({
            topic: 'input',
            type: core.EVENT_TYPES.TERMINAL_INPUT,
            payload: { data },
          }).catch((error) => {
            console.error('[ui-classic] core.publish(TERMINAL_INPUT) failed', error);
          });
        });

        if (typeof ResizeObserver === 'function') {
          resizeObserver = new ResizeObserver(handleResize);
          try { resizeObserver.observe(container); } catch (_) {}
          handleResize();
        }

        if (lastProposed && lastProposed.length) {
          const copy = lastProposed.slice();
          lastProposed = null;
          showProposedLines(copy);
          lastProposed = copy;
        }
      },
      unmount(host) {
        if (container && container.parentNode === host) {
          host.removeChild(container);
        }
        teardown();
      },
      focus() {
        if (terminal) terminal.focus();
      },
      showSystemMessage(message) {
        if (!message || !terminal) return;
        writeLine(terminal, message, '38;2;0;204;0m');
      },
      showUserMessage(text) {
        if (!text || !terminal) return;
        writeLine(terminal, `USER> ${text}`, '96m');
      },
      showAiMessage(text) {
        if (!text || !terminal) return;
        writeLine(terminal, `Spectra> ${text}`, '37m');
      },
      showError(message) {
        if (!message || !terminal) return;
        writeLine(terminal, `ERROR> ${message}`, '31m');
      },
      showProposed(commands) {
        lastProposed = Array.isArray(commands) ? commands.slice() : null;
        showProposedLines(lastProposed);
      },
      clearProposed(reason) {
        lastProposed = null;
        if (reason && terminal) {
          writeLine(terminal, reason, '38;2;0;204;0m');
        }
      },
      handleTerminalStdout(chunk) {
        if (!terminal || typeof chunk !== 'string') return;
        terminal.write(chunk);
      },
      handleTerminalExit() {
        lastProposed = null;
      },
      getPendingCommands() {
        return lastProposed ? lastProposed.slice() : null;
      },
    });
  }

  function bootstrapUi() {
    const bridge = global.bridge || null;
    const core = global.core || null;
    if (!core || typeof core.publish !== 'function' || typeof core.subscribe !== 'function') {
      console.error('window.core が見つからないか機能が不足しています。preload.js を確認してください。');
      return;
    }

    const surfaceHost = document.getElementById('surface-host');
    const input = document.getElementById('input');
    const avatarImg = document.getElementById('avatar-img');
    const avatarLabel = document.querySelector('.avatar-label');
    const metaBar = document.getElementById('meta');

    if (!surfaceHost) {
      console.error('[ui-classic] surface-host が見つかりません。layout.html を確認してください。');
      return;
    }

    const avatar = createAvatarController(avatarImg);
    avatar.setTalking(false);

    const coreSubscriptions = [];
    const surfaceFactories = {
      text: () => createTextSurface(),
      shell: () => createShellSurface(core, bridge),
    };
    const surfaceCache = new Map();

    let currentSurfaceKey = null;
    let pendingCommands = null;
    let initialSystemMessage = null;
    let systemMessageShown = false;

    function getSurface(key) {
      if (!surfaceFactories[key]) return null;
      if (!surfaceCache.has(key)) {
        surfaceCache.set(key, surfaceFactories[key]());
      }
      return surfaceCache.get(key);
    }

    function setSurface(surfaceName) {
      const normalized = typeof surfaceName === 'string' ? surfaceName.trim().toLowerCase() : '';
      if (!surfaceFactories[normalized]) {
        console.warn(`[ui-classic] 未対応の surface が指定されました: ${surfaceName}`);
        return;
      }
      if (currentSurfaceKey === normalized) {
        if (pendingCommands && pendingCommands.length) {
          const surface = getSurface(currentSurfaceKey);
          surface?.showProposed(pendingCommands);
        }
        if (initialSystemMessage && !systemMessageShown) {
          const surface = getSurface(currentSurfaceKey);
          surface?.showSystemMessage(initialSystemMessage);
          systemMessageShown = true;
        }
        return;
      }

      const previous = currentSurfaceKey ? getSurface(currentSurfaceKey) : null;
      if (previous && typeof previous.clearProposed === 'function') {
        try { previous.clearProposed(); } catch (_) {}
      }
      if (previous && typeof previous.unmount === 'function') {
        try { previous.unmount(surfaceHost); } catch (error) {
          console.error('[ui-classic] surface unmount failed', error);
        }
      }
      while (surfaceHost.firstChild) {
        surfaceHost.removeChild(surfaceHost.firstChild);
      }

      const next = getSurface(normalized);
      if (!next) return;
      try {
        next.mount(surfaceHost);
        currentSurfaceKey = normalized;
      } catch (error) {
        console.error('[ui-classic] surface mount failed', error);
        currentSurfaceKey = null;
        return;
      }

      if (initialSystemMessage && !systemMessageShown) {
        next.showSystemMessage(initialSystemMessage);
        systemMessageShown = true;
      }
      if (pendingCommands && pendingCommands.length) {
        next.showProposed(pendingCommands);
      }
    }

    function subscribeCore(topic, handler) {
      try {
        const unsubscribe = core.subscribe(topic, handler);
        coreSubscriptions.push(unsubscribe);
        return unsubscribe;
      } catch (error) {
        console.error('[ui-classic] core.subscribe failed', error);
        return () => {};
      }
    }

    function showProposed(commands) {
      if (!commands || !commands.length) {
        clearPending();
        return;
      }
      pendingCommands = commands.slice();
      avatar.setTalking(true);
      const surface = currentSurfaceKey ? getSurface(currentSurfaceKey) : null;
      surface?.showProposed(pendingCommands);
    }

    function clearPending(reason) {
      pendingCommands = null;
      avatar.setTalking(false);
      const surface = currentSurfaceKey ? getSurface(currentSurfaceKey) : null;
      surface?.clearProposed(reason);
    }

    subscribeCore('output', (event) => {
      if (!event || typeof event !== 'object') return;
      if (event.type === core.EVENT_TYPES.CORE_SURFACE_SET) {
        setSurface(event.payload?.surface || 'text');
        return;
      }
      switch (event.type) {
        case core.EVENT_TYPES.LLM_OUTPUT:
          if (event.payload && typeof event.payload.text === 'string') {
            const surface = currentSurfaceKey ? getSurface(currentSurfaceKey) : null;
            surface?.showAiMessage(event.payload.text);
          }
          break;
        case core.EVENT_TYPES.PROPOSED_COMMANDS:
          if (event.payload && Array.isArray(event.payload.items) && event.payload.items.length) {
            showProposed(event.payload.items);
          } else {
            clearPending();
          }
          break;
        case core.EVENT_TYPES.TERMINAL_STDOUT:
          if (event.payload && typeof event.payload.chunk === 'string') {
            const shellSurface = getSurface('shell');
            shellSurface?.handleTerminalStdout(event.payload.chunk);
          }
          break;
        case core.EVENT_TYPES.TERMINAL_EXIT:
          clearPending('Process exited.');
          getSurface('shell')?.handleTerminalExit();
          break;
        default:
          break;
      }
    });

    if (bridge && typeof bridge.getAppMeta === 'function') {
      bridge.getAppMeta().then((meta) => {
        if (meta && meta.name && meta.version && metaBar) {
          metaBar.textContent = `${meta.name} v${meta.version}`;
        }
      }).catch(() => {});
    }

    if (bridge && typeof bridge.getConfig === 'function') {
      bridge.getConfig().then((config) => {
        if (!config) return;
        if (config.title) document.title = config.title;
        if (avatarLabel && config.avatar?.name) {
          avatarLabel.textContent = config.avatar.name;
        }
        if (config.avatar?.image && avatarImg) {
          const idle = `../../../ui-classic/src/assets/${config.avatar.image.idle}`;
          const talk = `../../../ui-classic/src/assets/${config.avatar.image.talk}`;
          avatarImg.dataset.idle = idle;
          avatarImg.dataset.talk = talk;
          avatarImg.src = idle;
          avatar.setTalking(false);
        }
        if (config.systemMessage) {
          initialSystemMessage = config.systemMessage;
          if (currentSurfaceKey) {
            const surface = getSurface(currentSurfaceKey);
            surface?.showSystemMessage(initialSystemMessage);
            systemMessageShown = true;
          }
        }
      }).catch(() => {});
    }

    if (input) {
      input.addEventListener('keydown', (event) => {
        if (event.isComposing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          const surface = currentSurfaceKey ? getSurface(currentSurfaceKey) : null;
          surface?.showUserMessage(text);
          core.publish({
            topic: 'input',
            type: core.EVENT_TYPES.USER_INPUT,
            payload: { text },
          }).catch((error) => {
            console.error('[ui-classic] core.publish(USER_INPUT) failed', error);
          });
          input.value = '';
        }
      });
    }

    document.addEventListener('keydown', (event) => {
      if (!pendingCommands || !pendingCommands.length) return;
      if (currentSurfaceKey !== 'shell') return;
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        clearPending('Canceled.');
        try { bridge?.logEvent?.('proposed:cancel'); } catch (_) {}
        core.publish({
          topic: 'output',
          type: core.EVENT_TYPES.PROPOSED_COMMANDS,
          payload: { items: [] },
        }).catch((error) => {
          console.error('[ui-classic] core.publish(PROPOSED_COMMANDS cancel) failed', error);
        });
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const commands = pendingCommands.slice();
        clearPending();
        try { bridge?.logEvent?.('proposed:run', { commands }); } catch (_) {}
        commands.forEach((cmd) => {
          core.publish({
            topic: 'input',
            type: core.EVENT_TYPES.COMMAND_EXECUTE,
            payload: { cmd },
          }).catch((error) => {
            console.error('[ui-classic] core.publish(COMMAND_EXECUTE) failed', error);
          });
        });
        const shellSurface = getSurface('shell');
        shellSurface?.focus();
      }
    });

    window.addEventListener('beforeunload', () => {
      while (coreSubscriptions.length) {
        const unsubscribe = coreSubscriptions.pop();
        try { unsubscribe(); } catch (_) {}
      }
      surfaceCache.forEach((surface) => {
        if (surface && typeof surface.unmount === 'function') {
          try { surface.unmount(surfaceHost); } catch (_) {}
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', bootstrapUi);

  global.uiClassic = { bootstrapUi };
})(window);
