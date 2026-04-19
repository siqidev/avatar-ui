// Console HTTPサーバー: ブラウザ向けにConsole UIの静的ファイルを配信する
// session-ws-serverとHTTPサーバーを共有し、同一ポートでHTTP+WSを提供する

import { createServer } from "node:http"
import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http"
import * as fs from "node:fs"
import * as path from "node:path"
import * as log from "../logger.js"

// --- 型定義 ---

export type ConsoleHttpOptions = {
  port: number
  token: string | undefined
  rendererDir: string // out/renderer/ のパス
  devMode: boolean
}

export type ConsoleHttpServer = {
  httpServer: HttpServer
  start: () => void
  stop: () => void
}

// --- MIMEタイプ ---

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
}

// --- ポリフィル生成 ---

function generatePolyfill(wsPort: number, wsToken: string | undefined, devMode: boolean): string {
  // tokenを安全にJSリテラル化（"や\が混入しても破綻しないようJSON.stringifyを使う）
  const tokenStr = wsToken !== undefined ? JSON.stringify(wsToken) : "undefined"
  return `// field-api-polyfill: ブラウザ用window.fieldApiスタブ
// Electron preloadの代替。FS系はWS RPC経由、Terminal/外部D&Dは未対応
(function() {
  var WS_PORT = ${wsPort};
  var WS_TOKEN = ${tokenStr};
  var FS_TIMEOUT_MS = 30000;

  // --- FS RPC client (lazy WS) ---
  var fsWs = null;
  var fsConnecting = null;
  var pending = new Map(); // reqId -> { resolve, reject, timer }
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
        // open前のclose（error未発火経路）でも接続Promiseを必ず解決する
        if (!opened) {
          reject(new Error("FS WS切断"));
        }
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
          // 他typeはsession-client用なので無視
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

  window.fieldApi = {
    attach: function() { return Promise.resolve(); },
    detach: function() {},
    terminate: function() {},
    sessionWsConfig: function() {
      return Promise.resolve({ port: WS_PORT, token: WS_TOKEN, devMode: ${devMode} });
    },
    fsRootName: function() { return fsCall("fs.rootName"); },
    fsList: function(args) { return fsCall("fs.list", args); },
    fsRead: function(args) { return fsCall("fs.read", args); },
    fsWrite: function(args) { return fsCall("fs.write", args); },
    fsImportFile: function() { return Promise.reject(new Error("ブラウザ版では外部ファイルのD&Dインポートは未対応です")); },
    fsMutate: function(args) { return fsCall("fs.mutate", args); },
    terminalInput: function() { return Promise.resolve(); },
    terminalResize: function() { return Promise.resolve(); },
    terminalSnapshot: function() { return Promise.resolve(""); },
    onIntegrityAlert: function() {},
    onTerminalData: function() {},
    onTerminalState: function() {},
    onThemeChange: function() {},
    onLocaleChange: function() {},
    getFilePath: function() { return ""; },
    loadDemoScript: function() { return Promise.resolve({ ok: false, error: "ブラウザモードでは未対応" }); },
  };
})();
`
}

// --- CSP書き換え ---

// ブラウザ版CSP: ws:/wss:を全許可（WS認証はtoken認証で保護）
const BROWSER_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self' ws: wss:"

// --- token認証 ---

function extractHttpToken(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  // クエリパラメータ: ?token=xxx
  const queryToken = url.searchParams.get("token")
  if (queryToken) return queryToken
  // Cookie: aui_token=xxx
  const cookies = req.headers.cookie ?? ""
  const match = cookies.match(/aui_token=([^;]+)/)
  if (match) return match[1]
  return null
}

// --- サーバー作成 ---

export function createConsoleHttpServer(options: ConsoleHttpOptions): ConsoleHttpServer {
  const { port, token, rendererDir, devMode } = options

  // ポリフィルJSを事前生成
  const polyfillJs = generatePolyfill(port, token, devMode)

  // index.htmlをポリフィル付きで変換（キャッシュ）
  let cachedIndexHtml: string | null = null

  function getIndexHtml(): string {
    if (cachedIndexHtml) return cachedIndexHtml

    const indexPath = path.join(rendererDir, "index.html")
    if (!fs.existsSync(indexPath)) {
      throw new Error(`index.htmlが見つかりません: ${indexPath}（npm run build を先に実行してください）`)
    }

    let html = fs.readFileSync(indexPath, "utf-8")

    // CSP書き換え（Electron用→ブラウザ用）
    html = html.replace(
      /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")(?=\s|\/>|>)/u,
      `$1${BROWSER_CSP}$3`,
    )

    // ポリフィルスクリプトタグ挿入（theme-init.jsの直後）
    // ビルド出力のパスは "./theme-init.js" または "/theme-init.js" の可能性がある
    // キャッシュバスター: 起動ごとにURLが変わるのでCDNキャッシュを回避
    const cacheBuster = Date.now()
    html = html.replace(
      /(<script\s+src="\.?\/theme-init\.js"><\/script>)/u,
      `$1\n  <script src="./field-api-polyfill.js?v=${cacheBuster}"></script>`,
    )

    cachedIndexHtml = html
    return html
  }

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
    const pathname = url.pathname

    // token認証（設定されている場合のみ）
    if (token) {
      const clientToken = extractHttpToken(req)
      if (clientToken !== token) {
        res.writeHead(401, { "Content-Type": "text/plain" })
        res.end("Unauthorized — ?token=xxx でアクセスしてください")
        return
      }
      // Cookie設定（初回アクセス時のみ、以降はCookieで認証）
      if (url.searchParams.has("token")) {
        res.setHeader("Set-Cookie", `aui_token=${token}; HttpOnly; SameSite=Strict; Path=/`)
      }
    }

    // ポリフィルJS（設定値を含むためキャッシュ禁止）
    if (pathname === "/field-api-polyfill.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" })
      res.end(polyfillJs)
      return
    }

    // index.html（ルート or /index.html）
    if (pathname === "/" || pathname === "/index.html") {
      try {
        const html = getIndexHtml()
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" })
        res.end(html)
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" })
        res.end(err instanceof Error ? err.message : String(err))
      }
      return
    }

    // 静的ファイル
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/u, "")
    const filePath = path.join(rendererDir, safePath)

    // ディレクトリトラバーサル防止
    if (!filePath.startsWith(rendererDir)) {
      res.writeHead(403, { "Content-Type": "text/plain" })
      res.end("Forbidden")
      return
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("Not Found")
      return
    }

    const ext = path.extname(filePath).toLowerCase()
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream"
    res.writeHead(200, { "Content-Type": contentType })
    fs.createReadStream(filePath).pipe(res)
  })

  function start(): void {
    httpServer.listen(port, () => {
      log.info(`[CONSOLE_HTTP] Console UI配信開始 (http://localhost:${port})`)
    })
  }

  function stop(): void {
    httpServer.close()
    log.info("[CONSOLE_HTTP] Console UI配信停止")
  }

  return { httpServer, start, stop }
}
