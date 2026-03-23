// x_reply ツール定義: X（Twitter）のメンションに返信する

import type { Tool } from "openai/resources/responses/responses"
import { z } from "zod/v4"

export const xReplyToolDef: Tool = {
  type: "function",
  name: "x_reply",
  description:
    "X（Twitter）のメンションに返信する。280文字以内。" +
    "Webhook経由で受信したメンションに対してのみ使用する。" +
    "reply_to_tweet_idはメンション受信時のメタデータから取得する。" +
    "ハッシュタグは付けない。宣伝調にしない。" +
    "普段の口調でそのまま返信する。",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "返信本文（280文字以内）",
      },
      reply_to_tweet_id: {
        type: "string",
        description: "返信先のツイートID",
      },
    },
    required: ["text", "reply_to_tweet_id"],
    additionalProperties: false,
  },
  strict: true,
}

export const xReplyArgsSchema = z.object({
  text: z.string().min(1, "テキストは必須です").max(280, "280文字以内にしてください"),
  reply_to_tweet_id: z.string().min(1, "返信先ツイートIDは必須です"),
})
