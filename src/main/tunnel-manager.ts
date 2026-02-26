import { spawn, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import { APP_CONFIG } from "../config.js"
import * as log from "../logger.js"

// cloudflaredトンネルをElectronから管理する
// CLOUDFLARED_TOKEN設定時のみ起動。ログはdata/cloudflared.logに保存

const TUNNEL_LOG_FILE = `${APP_CONFIG.dataDir}/cloudflared.log`

let tunnelProcess: ChildProcess | null = null
let logStream: fs.WriteStream | null = null
let stopping = false

export function startTunnel(token: string): void {
  if (tunnelProcess) {
    log.info("[TUNNEL] 既に起動中")
    return
  }

  // ログファイルを追記モードで開く
  logStream = fs.createWriteStream(TUNNEL_LOG_FILE, { flags: "a" })

  // --protocol http2: QUICのUDP 7844がブロックされる環境でも即座に接続できる
  // QUICはUDP 7844必須だが、公共WiFi等でブロックされフォールバックに数分かかる
  tunnelProcess = spawn("cloudflared", ["tunnel", "--protocol", "http2", "run", "--token", token], {
    stdio: ["ignore", "pipe", "pipe"],
  })

  const pid = tunnelProcess.pid
  log.info(`[TUNNEL] cloudflared起動 (PID: ${pid})`)
  logStream.write(`--- cloudflared起動 ${new Date().toISOString()} PID=${pid} ---\n`)

  // cloudflaredはログをstderrに出力する
  tunnelProcess.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trimEnd().split("\n")
    for (const line of lines) {
      logStream?.write(line + "\n")
      // 重要なメッセージのみapp.logにも転送
      if (line.includes("ERR") || line.includes("error") || line.includes("Registered")) {
        log.info(`[TUNNEL] ${line}`)
      }
    }
  })

  tunnelProcess.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().trimEnd().split("\n")
    for (const line of lines) {
      logStream?.write(line + "\n")
    }
  })

  tunnelProcess.on("exit", (code, signal) => {
    if (!stopping) {
      log.error(`[TUNNEL] cloudflared予期しない終了: code=${code} signal=${signal}`)
    }
    logStream?.write(`--- cloudflared終了 code=${code} signal=${signal} ---\n`)
    tunnelProcess = null
    logStream?.end()
    logStream = null
  })

  tunnelProcess.on("error", (err) => {
    log.error(`[TUNNEL] cloudflared起動エラー: ${err.message}`)
    tunnelProcess = null
    logStream?.end()
    logStream = null
  })
}

export function stopTunnel(): void {
  if (!tunnelProcess) return
  stopping = true
  tunnelProcess.kill("SIGTERM")
}

export function isTunnelRunning(): boolean {
  return tunnelProcess !== null
}
