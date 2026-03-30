// X API Repository: X (Twitter) API v2 の呼び出し
// OAuth 1.0a署名 + ポスト作成/返信

import * as crypto from "node:crypto"
import { getConfig } from "../config.js"
import * as log from "../logger.js"

const X_API_BASE = "https://api.x.com/2"
const API_TIMEOUT_MS = 20_000

type XPostResult = {
  success: boolean
  tweetId?: string
  error?: string
}

// OAuth 1.0aの署名を生成する
function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  // パラメータをソートしてエンコード
  const sorted = Object.keys(params).sort()
  const paramString = sorted
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&")

  // ベース文字列
  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramString),
  ].join("&")

  // 署名キー
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`

  return crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64")
}

// OAuth 1.0a認証ヘッダーを生成する
function buildOAuthHeader(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessTokenSecret: string,
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  }

  const signature = generateOAuthSignature(
    method,
    url,
    oauthParams,
    consumerSecret,
    accessTokenSecret,
  )

  oauthParams.oauth_signature = signature

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(", ")

  return `OAuth ${headerParts}`
}

// ポストを作成する（自発ポスト）
export async function createPost(text: string): Promise<XPostResult> {
  const config = getConfig()
  if (!config.xConsumerKey || !config.xConsumerSecret || !config.xAccessToken || !config.xAccessTokenSecret) {
    return { success: false, error: "X API認証情報が設定されていません" }
  }

  const url = `${X_API_BASE}/tweets`
  const body = JSON.stringify({ text })

  const authHeader = buildOAuthHeader(
    "POST",
    url,
    config.xConsumerKey,
    config.xConsumerSecret,
    config.xAccessToken,
    config.xAccessTokenSecret,
  )

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })

    if (!response.ok) {
      const errorText = await response.text()
      log.error(`[X_API] ポスト作成失敗 (${response.status}): ${errorText}`)
      return { success: false, error: `HTTP ${response.status}: ${errorText}` }
    }

    const data = await response.json() as { data?: { id?: string } }
    const tweetId = data.data?.id
    log.info(`[X_API] ポスト作成成功: ${tweetId}`)
    return { success: true, tweetId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error(`[X_API] ポスト作成エラー: ${msg}`)
    return { success: false, error: msg }
  }
}

// 返信を作成する（Phase 2: X事前承認後に有効化）
export async function createReply(text: string, replyToTweetId: string): Promise<XPostResult> {
  const config = getConfig()
  if (!config.xConsumerKey || !config.xConsumerSecret || !config.xAccessToken || !config.xAccessTokenSecret) {
    return { success: false, error: "X API認証情報が設定されていません" }
  }

  const url = `${X_API_BASE}/tweets`
  const body = JSON.stringify({
    text,
    reply: { in_reply_to_tweet_id: replyToTweetId },
  })

  const authHeader = buildOAuthHeader(
    "POST",
    url,
    config.xConsumerKey,
    config.xConsumerSecret,
    config.xAccessToken,
    config.xAccessTokenSecret,
  )

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })

    if (!response.ok) {
      const errorText = await response.text()
      log.error(`[X_API] 返信作成失敗 (${response.status}): ${errorText}`)
      return { success: false, error: `HTTP ${response.status}: ${errorText}` }
    }

    const data = await response.json() as { data?: { id?: string } }
    const tweetId = data.data?.id
    log.info(`[X_API] 返信作成成功: ${tweetId} → ${replyToTweetId}`)
    return { success: true, tweetId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error(`[X_API] 返信作成エラー: ${msg}`)
    return { success: false, error: msg }
  }
}
