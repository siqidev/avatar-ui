import { z } from "zod/v4"

// デモスクリプトのセリフ定義
export const demoLineSchema = z.object({
  msg: z.string().min(1),
  postDelay: z.number().min(0).default(3),
})

export const demoScriptSchema = z.array(demoLineSchema).min(1)

export type DemoLine = z.infer<typeof demoLineSchema>
export type DemoScript = z.infer<typeof demoScriptSchema>
