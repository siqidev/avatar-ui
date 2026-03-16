// X Webhook受信サーバー: Account Activity API
// CRC検証（GET） + HMAC-SHA256署名検証（POST） + イベント解析

import * as http from "node:http"
import * as crypto from "node:crypto"
import { getConfig } from "../config.js"
import { markSeen } from "./x-dedupe-repository.js"
import type { XEvent } from "./x-event-formatter.js"
import * as log from "../logger.js"

export type XWebhookHandler = (event: XEvent) => void

// X Webhookサーバーを起動する
export function startXWebhookServer(
  onEvent: XWebhookHandler,
  port?: number,
): http.Server {
  const config = getConfig()
  const consumerSecret = config.xConsumerSecret
  const selfUserId = config.xUserId

  if (!consumerSecret) {
    throw new Error("X_CONSUMER_SECRETが設定されていません")
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`)

    // CRC検証（GET /x/webhook?crc_token=...）
    if (req.method === "GET" && url.pathname === "/x/webhook") {
      const crcToken = url.searchParams.get("crc_token")
      if (!crcToken) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing crc_token" }))
        return
      }

      const hmac = crypto
        .createHmac("sha256", consumerSecret)
        .update(crcToken)
        .digest("base64")

      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ response_token: `sha256=${hmac}` }))
      log.info("[X_WEBHOOK] CRC検証応答")
      return
    }

    // イベント受信（POST /x/webhook）
    if (req.method === "POST" && url.pathname === "/x/webhook") {
      let body = ""
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString()
      })

      req.on("end", () => {
        // HMAC-SHA256 署名検証
        const signature = req.headers["x-twitter-webhooks-signature"] as string | undefined
        if (!signature) {
          log.error("[X_WEBHOOK] 署名なし")
          res.writeHead(401, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "Missing signature" }))
          return
        }

        const expectedSignature = "sha256=" + crypto
          .createHmac("sha256", consumerSecret)
          .update(body)
          .digest("base64")

        const sigBuf = Buffer.from(signature)
        const expectedBuf = Buffer.from(expectedSignature)
        if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
          log.error("[X_WEBHOOK] 署名不一致")
          res.writeHead(401, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "Invalid signature" }))
          return
        }

        // 即時200応答（X APIの要件: 処理前に応答する）
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "ok" }))

        // イベント解析
        try {
          const data = JSON.parse(body) as Record<string, unknown>
          processWebhookPayload(data, onEvent, selfUserId)
        } catch (err) {
          log.error(`[X_WEBHOOK] ペイロード解析失敗: ${err instanceof Error ? err.message : String(err)}`)
        }
      })
      return
    }

    // その他のリクエスト
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Not Found" }))
  })

  const listenPort = port ?? config.xWebhookPort
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log.error(`[X_WEBHOOK] ポート${listenPort}が使用中`)
    } else {
      throw err
    }
  })
  server.listen(listenPort, () => {
    log.info(`[X_WEBHOOK] サーバー起動: port=${listenPort}`)
  })

  return server
}

// Webhookペイロードからイベントを抽出する
function processWebhookPayload(
  data: Record<string, unknown>,
  onEvent: XWebhookHandler,
  selfUserId?: string,
): void {
  // Account Activity APIのペイロード構造:
  // { for_user_id: "...", tweet_create_events: [...], ... }

  const tweetEvents = data.tweet_create_events as Array<Record<string, unknown>> | undefined
  if (!tweetEvents || !Array.isArray(tweetEvents)) return

  for (const tweet of tweetEvents) {
    const tweetId = tweet.id_str as string | undefined
    const user = tweet.user as Record<string, unknown> | undefined
    const text = tweet.text as string | undefined
    const userId = user?.id_str as string | undefined
    const username = user?.screen_name as string | undefined

    if (!tweetId || !text || !userId || !username) continue

    // 自己投稿はスキップ（フィードバックループ防止）
    if (selfUserId && userId === selfUserId) {
      log.info(`[X_WEBHOOK] 自己投稿スキップ: ${tweetId}`)
      continue
    }

    // 重複排除
    if (!markSeen(tweetId)) {
      log.info(`[X_WEBHOOK] 重複スキップ: ${tweetId}`)
      continue
    }

    // public_metrics（v2 APIの場合は別構造、Account Activity APIはv1.1ベース）
    const metrics = {
      like_count: typeof tweet.favorite_count === "number" ? tweet.favorite_count : 0,
      retweet_count: typeof tweet.retweet_count === "number" ? tweet.retweet_count : 0,
      reply_count: 0, // v1.1には含まれない
    }

    const event: XEvent = {
      type: "x_mention",
      tweetId,
      userId,
      username,
      text,
      metrics,
    }

    log.info(`[X_WEBHOOK] メンション受信: @${username} (${tweetId})`)
    onEvent(event)
  }
}
