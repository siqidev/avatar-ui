// x_post ツール定義: X（Twitter）に自発ポストを作成する
// Phase 1: 事前承認不要で即日運用可

import type { Tool } from "openai/resources/responses/responses"
import { z } from "zod/v4"

export const xPostToolDef: Tool = {
  type: "function",
  name: "x_post",
  description:
    "X（Twitter）にポストを投稿する。280文字以内。" +
    "自発的な発信（考え・感想・情報共有など）に使う。" +
    "返信には使わない（返信はx_replyを使う）。" +
    "ハッシュタグは付けない。宣伝調にしない。" +
    "自分の考えや気づきを、普段の口調でそのまま書く。",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "ポスト本文（280文字以内）",
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
  strict: true,
}

export const xPostArgsSchema = z.object({
  text: z.string().min(1, "テキストは必須です").max(280, "280文字以内にしてください"),
})
