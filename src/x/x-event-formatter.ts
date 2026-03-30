// X Webhookイベントの表示文字列 + AI入力文の整形

export type XMentionEvent = {
  type: "x_mention"
  tweetId: string
  userId: string
  username: string
  text: string
  metrics?: {
    like_count?: number
    retweet_count?: number
    reply_count?: number
  }
}

export type XEvent = XMentionEvent

// Xペイン表示用の文字列を生成する
export function formatXEvent(event: XEvent): string {
  switch (event.type) {
    case "x_mention": {
      const metrics = event.metrics
        ? ` [♡${event.metrics.like_count ?? 0} ↻${event.metrics.retweet_count ?? 0} 💬${event.metrics.reply_count ?? 0}]`
        : ""
      return `[Mention] @${event.username}: ${event.text}${metrics}`
    }
  }
}

// AI入力用の文字列を生成する（固定プレフィックスでインジェクション対策）
export function formatXEventForAI(event: XEvent): string {
  switch (event.type) {
    case "x_mention":
      return (
        `[X観測: mention] @${event.username} がメンションしました（tweet_id: ${event.tweetId}）: ${event.text}\n` +
        `返信する場合はx_replyツールを使うこと（reply_to_tweet_id: ${event.tweetId}）。テキスト応答だけでは相手に届かない。`
      )
  }
}
