import * as fs from "node:fs"
import { APP_CONFIG } from "./config.js"

type Level = "INFO" | "ERROR" | "FATAL"

function log(level: Level, message: string): void {
  const timestamp = new Date().toISOString()
  const line = `${timestamp} [${level}] ${message}\n`

  // stderr出力（開発中に即見える）
  process.stderr.write(line)

  // ファイル追記（あとから確認できる）
  fs.mkdirSync(APP_CONFIG.dataDir, { recursive: true })
  fs.appendFileSync(APP_CONFIG.logFile, line)
}

export function info(message: string): void {
  log("INFO", message)
}

export function error(message: string): void {
  log("ERROR", message)
}

export function fatal(message: string): never {
  log("FATAL", message)
  process.exit(1)
}
