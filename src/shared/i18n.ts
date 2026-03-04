// i18n辞書 + t()関数
// Renderer/Main共用（shared/に配置）
// 言語切替: Main → settings.json永続化 + Rendererリロード

export type Locale = "ja" | "en"

let currentLocale: Locale = "ja"

export function setLocale(locale: Locale): void {
  currentLocale = locale
}

export function getLocale(): Locale {
  return currentLocale
}

/** キーに対応するロケール文字列を返す。未登録キーはキーをそのまま返す */
export function t(key: string): string {
  const entry = dictionary[key]
  if (!entry) return key
  return entry[currentLocale]
}

const dictionary: Record<string, Record<Locale, string>> = {
  // --- Renderer: Stream (main.ts) ---
  "approve": { ja: "許可", en: "Approve" },
  "deny": { ja: "拒否", en: "Deny" },
  "approved_result": { ja: "  └ 許可", en: "  └ Approved" },
  "denied_result": { ja: "  └ 拒否", en: "  └ Denied" },
  "connecting": { ja: "接続中...", en: "Connecting..." },
  "inputPlaceholder": { ja: "メッセージを入力", en: "Type a message" },
  "send": { ja: "送信", en: "Send" },

  // --- Renderer: Filesystem (filesystem-pane.ts) ---
  "newFile": { ja: "新規ファイル", en: "New File" },
  "newFolder": { ja: "新規フォルダ", en: "New Folder" },
  "rename": { ja: "リネーム", en: "Rename" },
  "delete": { ja: "削除", en: "Delete" },
  "fileName": { ja: "ファイル名", en: "File name" },
  "folderName": { ja: "フォルダ名", en: "Folder name" },
  "newName": { ja: "新しい名前", en: "New name" },
  "loadError": { ja: "読み込みエラー", en: "Load error" },
  "operationError": { ja: "操作エラー", en: "Operation error" },
  "renameError": { ja: "リネームエラー", en: "Rename error" },
  "deleteError": { ja: "削除エラー", en: "Delete error" },
  "createError": { ja: "作成エラー", en: "Create error" },

  // --- Renderer: Canvas (canvas-pane.ts) ---
  "imageLoadError": { ja: "画像読み込みエラー", en: "Image load error" },

  // --- Renderer: Terminal (terminal-pane.ts) ---
  "rejected": { ja: "実行不可", en: "Rejected" },

  // --- Main: IntegrityManager (integrity-manager.ts) ---
  "alert.FIELD_CONTRACT_VIOLATION": {
    ja: "場の状態遷移に不整合が発生しました。再起動してください。",
    en: "Field state transition inconsistency detected. Please restart.",
  },
  "alert.RECIPROCITY_STREAM_ERROR": {
    ja: "メッセージ送信でエラーが発生しました。次の入力から再試行できます。",
    en: "Message send error. You can retry from the next input.",
  },
  "alert.RECIPROCITY_PULSE_ERROR": {
    ja: "定期応答（Pulse）でエラーが発生しました。次の周期で再試行します。",
    en: "Pulse error. Will retry on next cycle.",
  },
  "alert.RECIPROCITY_OBSERVATION_ERROR": {
    ja: "観測応答でエラーが発生しました。次の観測で再試行します。",
    en: "Observation response error. Will retry on next observation.",
  },
  "alert.COEXISTENCE_STATE_LOAD_CORRUPTED": {
    ja: "セッション状態が破損していました。直前の保存状態から復帰しました。",
    en: "Session state was corrupted. Recovered from previous save.",
  },
  "alert.COEXISTENCE_STATE_SAVE_FAILED": {
    ja: "セッション状態の保存に失敗しました。ディスク容量を確認して再起動してください。",
    en: "Failed to save session state. Check disk space and restart.",
  },

  // --- Main: chat-session-service ---
  "noResponse": { ja: "(応答なし)", en: "(no response)" },
  "memorySaved": { ja: "ローカルに保存しました", en: "Saved locally" },
  "intentProjected": { ja: "記録・投影完了", en: "Recorded and projected" },

  // --- Main: ipc-handlers ---
  "pulseCheck": { ja: "定期確認", en: "Pulse check" },
}
