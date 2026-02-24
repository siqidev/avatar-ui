import * as http from "node:http"
import { z } from "zod/v4"
import { APP_CONFIG } from "../config.js"
import * as log from "../logger.js"

// 観測イベントスキーマ（Roblox→場の入力）
export const observationEventSchema = z.object({
  type: z.enum(["player_chat", "player_proximity", "projection_ack"]),
  serverId: z.string().optional(),
  timestamp: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
})

export type ObservationEvent = z.infer<typeof observationEventSchema>

// 観測イベント受信時のコールバック型
export type ObservationHandler = (event: ObservationEvent) => void

// 観測受信HTTPサーバーを起動する
export function startObservationServer(
  onObservation: ObservationHandler,
): http.Server {
  const server = http.createServer((req, res) => {
    // POST /observation のみ受け付ける
    if (req.method !== "POST" || req.url !== "/observation") {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Not Found" }))
      return
    }

    let body = ""
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString()
    })

    req.on("end", () => {
      try {
        const parsed = JSON.parse(body)
        const validation = observationEventSchema.safeParse(parsed)

        if (!validation.success) {
          log.error(
            `[OBSERVATION] バリデーション失敗: ${JSON.stringify(validation.error.issues)}`,
          )
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "Invalid observation event" }))
          return
        }

        const event = validation.data
        log.info(
          `[OBSERVATION] 受信: type=${event.type} payload=${JSON.stringify(event.payload)}`,
        )

        onObservation(event)

        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "ok" }))
      } catch {
        log.error(`[OBSERVATION] JSONパース失敗: ${body.slice(0, 200)}`)
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Invalid JSON" }))
      }
    })
  })

  server.listen(APP_CONFIG.observationPort, () => {
    log.info(
      `[OBSERVATION] サーバー起動: port=${APP_CONFIG.observationPort}`,
    )
  })

  return server
}
