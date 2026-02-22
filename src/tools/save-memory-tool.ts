import type { Tool } from "openai/resources/responses/responses"

// save_memoryツールのResponses API定義
// Grokがこのスキーマを見て、記憶すべき内容がある時に自動で呼び出す
export const saveMemoryToolDef: Tool = {
  type: "function",
  name: "save_memory",
  description:
    "会話で得た重要な情報を長期記憶に保存する。ユーザーの好み、経験、関係性、" +
    "学んだこと、約束など、将来の会話で役立つ情報を保存する。" +
    "些末な情報や一時的な文脈は保存しない。",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["text", "reason", "importance"],
    properties: {
      text: {
        type: "string",
        description: "記憶する内容。将来読み返して理解できる自己完結的な文",
      },
      reason: {
        type: "string",
        description: "この情報を記憶する理由（短文）",
      },
      importance: {
        type: "number",
        description: "重要度（0.0=低 〜 1.0=高）。日常的な好み=0.3、重要な出来事=0.7、核心的な関係性=0.9",
      },
      tags: {
        type: "array",
        description: "分類タグ（任意）",
        items: { type: "string" },
      },
      meta: {
        type: "object",
        description: "追加メタデータ（任意、自由形式）",
        additionalProperties: true,
      },
    },
  },
  strict: true,
}
