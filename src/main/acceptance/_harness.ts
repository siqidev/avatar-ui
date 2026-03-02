// 受入テスト共有ハーネス
// S1-S5テストで共通利用するモック・ヘルパー

import { vi } from "vitest"
import type { Mock } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"

// --- BrowserWindow モック ---

export type MockWindow = {
  isDestroyed: Mock
  webContents: { send: Mock }
}

export function createWindowMock(): MockWindow {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  }
}

// --- ipcMain ハンドラ発火ヘルパー ---

// registerIpcHandlers() が ipcMain.on() で登録したハンドラを channel名で発火する
export function createFireHelper(ipcMainOnMock: Mock) {
  return (channel: string, ...args: unknown[]): unknown => {
    const call = ipcMainOnMock.mock.calls.find(
      (c) => c[0] === channel,
    )
    if (!call) throw new Error(`ハンドラ未登録: ${channel}`)
    return call[1]({ sender: {} }, ...args)
  }
}

// --- webContents.send から送信済みメッセージを抽出 ---

export function getSentMessages(win: MockWindow) {
  return win.webContents.send.mock.calls.map(
    (c) => ({ channel: c[0] as string, data: c[1] }),
  )
}

export function getLastSentMessage(win: MockWindow) {
  const msgs = getSentMessages(win)
  return msgs[msgs.length - 1]
}

// --- デフォルトState（field-runtimeモック用） ---

export function mockDefaultState() {
  return {
    schemaVersion: 1 as const,
    field: {
      state: "generated",
      messageHistory: [] as Array<{ actor: string; text: string; source?: string; toolCalls?: Array<{ name: string; result: string }> }>,
    },
    participant: {
      lastResponseId: null as string | null,
      lastResponseAt: null as string | null,
    },
  }
}

// --- tmpディレクトリ管理（S2/S3/S4の永続化テスト用） ---
// mkdtempSyncで一意ディレクトリを生成し、テストファイル間の並列実行干渉を防ぐ

import * as os from "node:os"

let currentTempDir: string | null = null

export function setupTempDataDir(): string {
  currentTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-acceptance-"))
  return currentTempDir
}

export function cleanupTempDataDir(): void {
  if (currentTempDir) {
    fs.rmSync(currentTempDir, { recursive: true, force: true })
    currentTempDir = null
  }
}

export function getTempStateFile(): string {
  if (!currentTempDir) throw new Error("setupTempDataDir()が未呼出")
  return path.join(currentTempDir, "state.json")
}
