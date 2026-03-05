import { ipcMain } from "electron"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { demoScriptSchema } from "../shared/demo-script-schema.js"
import type { DemoScript } from "../shared/demo-script-schema.js"
import * as log from "../logger.js"

// デモスクリプト読み込みIPC
export function registerDemoIpcHandlers(appRoot: string): void {
  ipcMain.handle("demo.script.load", async (): Promise<{ ok: true; lines: DemoScript } | { ok: false; error: string }> => {
    const scriptPath = join(appRoot, "scripts", "demo-script.json")
    try {
      const raw = await readFile(scriptPath, "utf-8")
      const parsed = JSON.parse(raw) as unknown
      const result = demoScriptSchema.safeParse(parsed)
      if (!result.success) {
        const msg = `デモスクリプト検証失敗: ${result.error.message}`
        log.error(`[DEMO] ${msg}`)
        return { ok: false, error: msg }
      }
      log.info(`[DEMO] スクリプト読込完了: ${result.data.length}行`)
      return { ok: true, lines: result.data }
    } catch (err) {
      const msg = err instanceof Error && "code" in err && err.code === "ENOENT"
        ? "scripts/demo-script.json が見つかりません"
        : `読込エラー: ${err instanceof Error ? err.message : String(err)}`
      log.error(`[DEMO] ${msg}`)
      return { ok: false, error: msg }
    }
  })
}
