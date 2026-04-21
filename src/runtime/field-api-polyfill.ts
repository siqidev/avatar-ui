// ブラウザ用 window.fieldApi ポリフィル生成器
// Electron preloadの代替。Web profile（browser）のFieldApi実装をJS文字列として生成する
// 設計契約:
// - Web profile の実能力は WEB_CAPABILITIES に従う
// - 能力なし (false) のメソッドはrejectまたはno-op（FieldContract不変条件「能力を偽らない」）
// - ポリフィルはIIFEとしてブラウザで直接実行される（preload bridgeなし）

import { WEB_CAPABILITIES } from "../shared/field-api.js"

export type PolyfillBuildOptions = {
  wsPort: number
  wsToken: string | undefined
  devMode: boolean
}

/** ブラウザ実行用の field-api-polyfill.js ソースを生成する */
export function buildPolyfillSource(opts: PolyfillBuildOptions): string {
  const tokenStr =
    opts.wsToken !== undefined ? JSON.stringify(opts.wsToken) : "undefined"
  const capabilitiesJson = JSON.stringify(WEB_CAPABILITIES)

  // ブラウザで実行されるIIFE本体。内部は文字列リテラルだが外周のオプションは
  // TypeScriptで型検証される。FieldApi interface準拠は build-config で保証
  return `// field-api-polyfill: Web profile用 window.fieldApi 実装
// Electron preloadの代替。FS系はWS RPC経由、Terminal/外部D&D/Integrity/DemoScript は無効
(function() {
  var WS_PORT = ${opts.wsPort};
  var WS_TOKEN = ${tokenStr};
  var DEV_MODE = ${opts.devMode};
  var PROFILE = "web";
  var CAPABILITIES = ${capabilitiesJson};
  var FS_TIMEOUT_MS = 30000;

  // --- FS RPC client (lazy WS) ---
  var fsWs = null;
  var fsConnecting = null;
  var pending = new Map();
  var reqSeq = 0;

  function nextReqId() {
    reqSeq += 1;
    return "fs-" + Date.now() + "-" + reqSeq;
  }

  function rejectAllPending(reason) {
    pending.forEach(function(entry) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    });
    pending.clear();
  }

  function ensureFsWs() {
    if (fsWs && fsWs.readyState === WebSocket.OPEN) return Promise.resolve(fsWs);
    if (fsConnecting) return fsConnecting;

    fsConnecting = new Promise(function(resolve, reject) {
      var protocol = location.protocol === "https:" ? "wss:" : "ws:";
      var host = location.host || ("localhost:" + WS_PORT);
      var url = protocol + "//" + host + "/" + (WS_TOKEN ? "?token=" + encodeURIComponent(WS_TOKEN) : "");
      var ws = new WebSocket(url);
      var opened = false;

      ws.onopen = function() {
        opened = true;
        fsWs = ws;
        fsConnecting = null;
        resolve(ws);
      };
      ws.onerror = function() {
        fsConnecting = null;
        reject(new Error("FS WS接続エラー"));
      };
      ws.onclose = function() {
        fsWs = null;
        fsConnecting = null;
        rejectAllPending("FS WS切断");
        if (!opened) reject(new Error("FS WS切断"));
      };
      ws.onmessage = function(ev) {
        try {
          var data = JSON.parse(ev.data);
          if (data && data.type === "fs.response") {
            var entry = pending.get(data.reqId);
            if (!entry) return;
            clearTimeout(entry.timer);
            pending.delete(data.reqId);
            if (data.ok) entry.resolve(data.result);
            else entry.reject(Object.assign(new Error(data.error.message), { code: data.error.code }));
          }
        } catch (e) { /* ignore parse errors */ }
      };
    });
    return fsConnecting;
  }

  function fsCall(method, args) {
    return ensureFsWs().then(function(ws) {
      return new Promise(function(resolve, reject) {
        var reqId = nextReqId();
        var timer = setTimeout(function() {
          pending.delete(reqId);
          reject(new Error("FS要求タイムアウト: " + method));
        }, FS_TIMEOUT_MS);
        pending.set(reqId, { resolve: resolve, reject: reject, timer: timer });
        try {
          ws.send(JSON.stringify({ type: "fs.request", reqId: reqId, method: method, args: args }));
        } catch (e) {
          clearTimeout(timer);
          pending.delete(reqId);
          reject(e);
        }
      });
    });
  }

  function unsupported(name) {
    return function() {
      return Promise.reject(new Error("ブラウザ版では未対応: " + name));
    };
  }

  window.fieldApi = {
    // 場のライフサイクル: ブラウザ版はattach/detachをno-op化（サーバー側はWS接続で管理）
    attach: function() { return Promise.resolve(); },
    detach: function() {},
    terminate: function() {},

    // WS接続情報 + capabilities宣言（Web profile）
    sessionWsConfig: function() {
      return Promise.resolve({
        port: WS_PORT,
        token: WS_TOKEN,
        devMode: DEV_MODE,
        profile: PROFILE,
        capabilities: CAPABILITIES,
      });
    },

    // ファイル操作: WS RPC経由
    fsRootName: function() { return fsCall("fs.rootName"); },
    fsList: function(args) { return fsCall("fs.list", args); },
    fsRead: function(args) { return fsCall("fs.read", args); },
    fsWrite: function(args) { return fsCall("fs.write", args); },
    fsImportFile: unsupported("fs.importFile（外部ファイルD&D）"),
    fsMutate: function(args) { return fsCall("fs.mutate", args); },

    // Terminal: capabilities.terminal=false のため全てreject
    terminalInput: unsupported("terminal.input"),
    terminalResize: unsupported("terminal.resize"),
    terminalSnapshot: unsupported("terminal.snapshot"),

    // ホスト→Rendererイベント: ブラウザ版ではホスト通知なし（no-op）
    onIntegrityAlert: function() {},
    onTerminalData: function() {},
    onTerminalState: function() {},
    onThemeChange: function() {},
    onLocaleChange: function() {},

    // ユーティリティ
    getFilePath: function() { return ""; },
    loadDemoScript: function() {
      return Promise.resolve({ ok: false, error: "ブラウザ版では未対応: demo.script.load" });
    },
  };
})();
`
}
