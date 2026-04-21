// FieldApi: Electron preloadとブラウザpolyfillが実装する共通インターフェース
// Web/Desktopで接触面の能力が違うため、capabilitiesで実能力を明示する
// 不変条件: 偽装禁止（no-opをtrue相当として返してはならない）

import type {
  FsImportFileArgs,
  FsImportFileResult,
  FsListArgs,
  FsListResult,
  FsMutateArgs,
  FsMutateResult,
  FsReadArgs,
  FsReadResult,
  FsWriteArgs,
  FsWriteResult,
} from "./fs-schema.js"
import type {
  TerminalInputArgs,
  TerminalResizeArgs,
  TerminalSnapshot,
} from "./terminal-schema.js"
import type { DemoScript } from "./demo-script-schema.js"

// --- 接触面（runtime profile） ---

/** ユーザー接触面の種別。器の形の差を型で表現する */
export type RuntimeProfile = "desktop" | "web" | "mobile"

/**
 * 実能力一覧。FieldContractの不変条件「能力を偽らない」をコード化したもの。
 * false のメソッドは呼んではならない（呼ぶと reject される）。
 */
export type Capabilities = {
  /** node-pty経由の共有Terminal操作（入出力・リサイズ・スナップショット） */
  terminal: boolean
  /** 任意絶対パスからAvatar Spaceへのファイルインポート（D&Dインポート） */
  externalFileImport: boolean
  /** Avatar Space内のファイル書き込み・構造変更 */
  filesystemWrite: boolean
  /** 健全性アラートのリアルタイム受信（現状はIPC残置のためDesktopのみ） */
  integrityAlerts: boolean
  /** デモスクリプト読み込み（ローカル専用機能） */
  demoScript: boolean
  /** テーマ・言語変更のランタイム通知（メニュー起源、Desktopのみ） */
  settingsNotifications: boolean
}

export const DESKTOP_CAPABILITIES: Capabilities = {
  terminal: true,
  externalFileImport: true,
  filesystemWrite: true,
  integrityAlerts: true,
  demoScript: true,
  settingsNotifications: true,
}

export const WEB_CAPABILITIES: Capabilities = {
  terminal: false,
  externalFileImport: false,
  filesystemWrite: true,
  integrityAlerts: false,
  demoScript: false,
  settingsNotifications: false,
}

// --- Session WS接続情報 ---

export type SessionWsConfig = {
  port: number
  token: string | undefined
  devMode: boolean
  profile: RuntimeProfile
  capabilities: Capabilities
}

// --- FieldApi本体 ---

/**
 * Rendererが使用する唯一のホスト境界API。
 * Electron preload (desktop) と browser polyfill (web) が同じシェイプを満たす。
 *
 * 不変条件:
 * - capabilities.X が false のメソッドは Promise.reject するか no-op（void戻り）
 * - capabilitiesと実装は一致させる（偽装禁止）
 */
export interface FieldApi {
  // 場のライフサイクル
  attach(): Promise<void>
  detach(): void
  terminate(): void

  // WS接続情報 + capabilities
  sessionWsConfig(): Promise<SessionWsConfig>

  // ファイル操作
  fsRootName(): Promise<string>
  fsList(args: FsListArgs): Promise<FsListResult>
  fsRead(args: FsReadArgs): Promise<FsReadResult>
  fsWrite(args: FsWriteArgs): Promise<FsWriteResult>
  fsImportFile(args: FsImportFileArgs): Promise<FsImportFileResult>
  fsMutate(args: FsMutateArgs): Promise<FsMutateResult>

  // Terminal操作
  terminalInput(args: TerminalInputArgs): Promise<{ ok: boolean }>
  terminalResize(args: TerminalResizeArgs): Promise<{ ok: boolean }>
  terminalSnapshot(): Promise<TerminalSnapshot>

  // ホスト→Rendererイベント購読
  onIntegrityAlert(cb: (data: unknown) => void): void
  onTerminalData(cb: (data: unknown) => void): void
  onTerminalState(cb: (data: unknown) => void): void
  onThemeChange(cb: (theme: string) => void): void
  onLocaleChange(cb: (locale: string) => void): void

  // ユーティリティ
  getFilePath(file: File): string
  loadDemoScript(): Promise<
    { ok: true; lines: DemoScript } | { ok: false; error: string }
  >
}
