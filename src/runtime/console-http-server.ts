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

function generatePolyfill(wsPort: number, wsToken: string | undefined): string {
  const tokenStr = wsToken ? `"${wsToken}"` : "undefined"
  return `// field-api-polyfill: ブラウザ用window.fieldApiスタブ
// Electron preloadの代替。FS/Terminal系はブラウザでは未対応
window.fieldApi = {
  attach: function() { return Promise.resolve(); },
  detach: function() {},
  terminate: function() {},
  sessionWsConfig: function() {
    return Promise.resolve({ port: ${wsPort}, token: ${tokenStr} });
  },
  fsRootName: function() { return Promise.reject(new Error("ブラウザモードでは未対応")); },
  fsList: function() { return Promise.reject(new Error("ブラウザモードでは未対応")); },
  fsRead: function() { return Promise.reject(new Error("ブラウザモードでは未対応")); },
  fsWrite: function() { return Promise.reject(new Error("ブラウザモードでは未対応")); },
  fsImportFile: function() { return Promise.reject(new Error("ブラウザモードでは未対応")); },
  fsMutate: function() { return Promise.reject(new Error("ブラウザモードでは未対応")); },
  terminalInput: function() { return Promise.reject(new Error("ブラウザモードでは未対応")); },
  terminalResize: function() { return Promise.reject(new Error("ブラウザモードでは未対応")); },
  terminalSnapshot: function() { return Promise.reject(new Error("ブラウザモードでは未対応")); },
  onIntegrityAlert: function() {},
  onTerminalData: function() {},
  onTerminalState: function() {},
  onThemeChange: function() {},
  onLocaleChange: function() {},
  getFilePath: function() { return ""; },
  loadDemoScript: function() { return Promise.resolve({ ok: false, error: "ブラウザモードでは未対応" }); },
};
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
  const { port, token, rendererDir } = options

  // ポリフィルJSを事前生成
  const polyfillJs = generatePolyfill(port, token)

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
    html = html.replace(
      '<script src="/theme-init.js"></script>',
      '<script src="/theme-init.js"></script>\n  <script src="/field-api-polyfill.js"></script>',
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

    // ポリフィルJS
    if (pathname === "/field-api-polyfill.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" })
      res.end(polyfillJs)
      return
    }

    // index.html（ルート or /index.html）
    if (pathname === "/" || pathname === "/index.html") {
      try {
        const html = getIndexHtml()
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
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
