// Console HTTPサーバー: ブラウザ向けにConsole UIの静的ファイルを配信する
// session-ws-serverとHTTPサーバーを共有し、同一ポートでHTTP+WSを提供する

import { createServer } from "node:http"
import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http"
import * as fs from "node:fs"
import * as path from "node:path"
import * as zlib from "node:zlib"
import * as log from "../logger.js"
import { buildPolyfillSource } from "./field-api-polyfill.js"

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

// --- 静的ファイル圧縮キャッシュ ---

type CompressedEntry = { encoding: "br" | "gzip"; buffer: Buffer; mtimeMs: number }
const COMPRESSIBLE_EXT = new Set([".js", ".css", ".html", ".json", ".svg"])
const COMPRESSION_MIN_BYTES = 1024
// プロセス内メモリキャッシュ（assetは数個のみ。再ビルドでmtime変化したら再圧縮）
const compressedCache = new Map<string, CompressedEntry>()

function pickEncoding(acceptEncoding: string | undefined): "br" | "gzip" | null {
  if (!acceptEncoding) return null
  // brotli優先（より高圧縮率）
  if (/\bbr\b/u.test(acceptEncoding)) return "br"
  if (/\bgzip\b/u.test(acceptEncoding)) return "gzip"
  return null
}

function compressFile(filePath: string, encoding: "br" | "gzip", source: Buffer): Buffer {
  return encoding === "br" ? zlib.brotliCompressSync(source) : zlib.gzipSync(source)
}

// --- サーバー作成 ---

export function createConsoleHttpServer(options: ConsoleHttpOptions): ConsoleHttpServer {
  const { port, token, rendererDir, devMode } = options

  // ポリフィルJSを事前生成（独立TSモジュール `field-api-polyfill.ts` に切り出し済み）
  const polyfillJs = buildPolyfillSource({ wsPort: port, wsToken: token, devMode })

  // index.htmlをポリフィル付きで変換（キャッシュ）
  let cachedIndexHtml: string | null = null

  function getIndexHtml(): string {
    if (cachedIndexHtml) return cachedIndexHtml

    const indexPath = path.join(rendererDir, "index.html")
    if (!fs.existsSync(indexPath)) {
      throw new Error(`index.htmlが見つかりません: ${indexPath}（npm run build を先に実行してください）`)
    }

    let html = fs.readFileSync(indexPath, "utf-8")

    // CSP書き換え（Electron用→ブラウザ用）: 置換失敗をfail-fast
    // ビルド出力のCSPメタタグがRollupの変更等で構造が変わるとブラウザが
    // Electron用CSP（connect-src制限）のまま起動してWebSocket接続が全滅するため、
    // ヒット件数を検証して一致しないときは即throwして起動を止める
    const cspPattern =
      /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")(?=\s|\/>|>)/gu
    const cspMatches = html.match(cspPattern)
    if (!cspMatches || cspMatches.length !== 1) {
      throw new Error(
        `CSPメタタグの書き換えに失敗しました（期待: 1件、実測: ${cspMatches?.length ?? 0}件）。` +
          `out/renderer/index.htmlのCSP定義を確認してください`,
      )
    }
    html = html.replace(cspPattern, `$1${BROWSER_CSP}$3`)

    // ポリフィルスクリプトタグ挿入（theme-init.jsの直後）
    // ビルド出力のパスは "./theme-init.js" または "/theme-init.js" の可能性がある
    // キャッシュバスター: 起動ごとにURLが変わるのでCDNキャッシュを回避
    const cacheBuster = Date.now()
    const themeScriptPattern = /(<script\s+src="\.?\/theme-init\.js"><\/script>)/u
    if (!themeScriptPattern.test(html)) {
      throw new Error(
        "theme-init.jsのscriptタグが見つからず、ポリフィル挿入に失敗しました。" +
          "out/renderer/index.htmlの出力を確認してください",
      )
    }
    html = html.replace(
      themeScriptPattern,
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

    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("Not Found")
      return
    }
    if (stat.isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("Not Found")
      return
    }

    const ext = path.extname(filePath).toLowerCase()
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream"

    // ETag / Last-Modified: mtimeベースのweak ETagで非hashed assetのフル転送を回避
    // If-None-Match / If-Modified-Since が一致すれば304を返す
    const lastModified = new Date(stat.mtimeMs).toUTCString()
    const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`
    const ifNoneMatch = req.headers["if-none-match"]
    const ifModifiedSince = req.headers["if-modified-since"]
    const notModified =
      (typeof ifNoneMatch === "string" && ifNoneMatch === etag) ||
      (typeof ifModifiedSince === "string" &&
        Date.parse(ifModifiedSince) >= Math.floor(stat.mtimeMs / 1000) * 1000)
    if (notModified) {
      res.writeHead(304, {
        "ETag": etag,
        "Last-Modified": lastModified,
        "Cache-Control": "no-transform",
      })
      res.end()
      return
    }

    // 圧縮配信判定: 1KB以上のテキスト系のみ。cloudflared HTTP/2経路で大きい未圧縮レスポンスが
    // 落ちる事象（ERR_HTTP2_PROTOCOL_ERROR）を回避するため、転送量自体を縮める
    const encoding = stat.size >= COMPRESSION_MIN_BYTES && COMPRESSIBLE_EXT.has(ext)
      ? pickEncoding(req.headers["accept-encoding"] as string | undefined)
      : null

    if (encoding) {
      const cacheKey = `${filePath}:${encoding}`
      let entry = compressedCache.get(cacheKey)
      if (!entry || entry.mtimeMs !== stat.mtimeMs) {
        const source = fs.readFileSync(filePath)
        entry = { encoding, buffer: compressFile(filePath, encoding, source), mtimeMs: stat.mtimeMs }
        compressedCache.set(cacheKey, entry)
      }
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": entry.buffer.length,
        "Content-Encoding": encoding,
        "Vary": "Accept-Encoding",
        "ETag": etag,
        "Last-Modified": lastModified,
        "Cache-Control": "no-transform",
      })
      res.end(entry.buffer)
      return
    }

    // 非圧縮: Content-Length明示（chunked transfer起因の ERR_HTTP2_PROTOCOL_ERROR を回避）
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "ETag": etag,
      "Last-Modified": lastModified,
      "Cache-Control": "no-transform",
    })
    const stream = fs.createReadStream(filePath)
    stream.on("error", (err) => {
      log.error(`[CONSOLE_HTTP] 静的ファイル読み取り失敗: ${filePath} ${err instanceof Error ? err.message : String(err)}`)
      res.destroy(err)
    })
    stream.pipe(res)
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
