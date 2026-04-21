// IPC配線: Electron IPCとfield-orchestratorを接続する薄いアダプタ
// オーケストレーションロジックはfield-orchestrator.tsに委譲

import { ipcMain } from "electron"
import type { BrowserWindow } from "electron"
import {
  boot,
  attach,
  safeDetach as orchestratorSafeDetach,
  terminate,
  getFieldState as orchestratorGetFieldState,
  getStateSnapshot as orchestratorGetStateSnapshot,
  handleStreamPost as orchestratorHandleStreamPost,
} from "../runtime/field-orchestrator.js"
import { createConsoleProjection } from "./channel-projection.js"
import type { ChannelProjection } from "./channel-projection.js"
import { setAlertSink } from "../runtime/integrity-manager.js"
import { getConfig } from "../config.js"
import { DESKTOP_CAPABILITIES } from "../shared/field-api.js"
import type { SessionWsConfig } from "../shared/field-api.js"

// --- export互換（既存テスト・main/index.tsからの参照を維持） ---

export function getFieldState() {
  return orchestratorGetFieldState()
}

export function safeDetach() {
  orchestratorSafeDetach()
}

export function getStateSnapshot() {
  return orchestratorGetStateSnapshot()
}

export async function handleStreamPost(text: string, correlationId: string, actor: "human" | "ai") {
  return orchestratorHandleStreamPost(text, correlationId, actor)
}

// --- IPC登録 ---

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  // ChannelProjection: integrity.alertのみ使用（session系はWS経由に移行済み）
  const projection: ChannelProjection = createConsoleProjection(getMainWindow)

  // IntegrityManager: alertSink登録（検知→投影経由でRenderer通知）
  setAlertSink((code, message) => {
    projection.sendIntegrityAlert(code, message)
  })

  // FieldRuntime初期化 + サービス起動
  boot()

  // channel.attach: ウィンドウ接続（FSM遷移のみ。セッションデータはWS経由で配信）
  ipcMain.handle("channel.attach", () => {
    attach()
  })

  // channel.detach: ウィンドウ切断
  ipcMain.on("channel.detach", () => {
    orchestratorSafeDetach()
  })

  // session.ws.config: WS接続情報 + runtime profile + capabilitiesを返す
  // Desktop profile（Electron）のためDESKTOP_CAPABILITIESを固定で返す
  ipcMain.handle("session.ws.config", (): SessionWsConfig => {
    const config = getConfig()
    return {
      port: config.sessionWsPort,
      token: config.sessionWsToken,
      devMode: config.devMode,
      profile: "desktop",
      capabilities: DESKTOP_CAPABILITIES,
    }
  })

  // field.terminate: 場の終了
  ipcMain.on("field.terminate", () => {
    terminate()
  })
}
