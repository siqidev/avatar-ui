import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const logsDir = resolve(process.cwd(), "logs");
if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

const logFile = resolve(logsDir, "cli.log");
const stream = createWriteStream(logFile, { flags: "a" });

function format(level: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `${timestamp} | ${level.toUpperCase()} | ${message}`;
}

export function logInfo(message: string) {
  stream.write(format("info", message) + "\n");
}

export function logError(message: string) {
  stream.write(format("error", message) + "\n");
}
