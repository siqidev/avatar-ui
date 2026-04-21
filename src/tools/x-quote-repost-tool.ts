// x_quote_repost ツール定義: X（Twitter）で引用リポストを作成する

import type { Tool } from "openai/resources/responses/responses"
import { z } from "zod/v4"

export const xQuoteRepostToolDef: Tool = {
  type: "function",
  name: "x_quote_repost",
  description:
    "X（Twitter）で引用リポストを作成する。280文字以内。" +
    "他者の投稿に自分のコメントを添えて共有する。" +
    "ハッシュタグは付けない。宣伝調にしない。" +
    "自分の視点でコメントする。",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "引用コメント本文（280文字以内）",
      },
      quote_tweet_id: {
        type: "string",
        description: "引用元のツイートID",
      },
    },
    required: ["text", "quote_tweet_id"],
    additionalProperties: false,
  },
  strict: true,
}

export const xQuoteRepostArgsSchema = z.object({
  text: z.string().min(1, "テキストは必須です").max(280, "280文字以内にしてください"),
  quote_tweet_id: z.string().min(1, "引用元ツイートIDは必須です"),
})
