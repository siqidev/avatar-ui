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
/** {0}, {1}, ... をargsで置換する */
export function t(key: string, ...args: unknown[]): string {
  const entry = dictionary[key]
  let text = entry ? entry[currentLocale] : key
  for (let i = 0; i < args.length; i++) {
    text = text.replace(`{${i}}`, String(args[i]))
  }
  return text
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
  "newFile": { ja: "新しいファイル...", en: "New File..." },
  "newFolder": { ja: "新しいフォルダー...", en: "New Folder..." },
  "rename": { ja: "名前の変更", en: "Rename" },
  "delete": { ja: "削除", en: "Delete" },
  "cut": { ja: "切り取り", en: "Cut" },
  "copy": { ja: "コピー", en: "Copy" },
  "paste": { ja: "貼り付け", en: "Paste" },
  "copyPath": { ja: "パスのコピー", en: "Copy Path" },
  "copyRelativePath": { ja: "相対パスのコピー", en: "Copy Relative Path" },
  "fileName": { ja: "ファイル名", en: "File name" },
  "folderName": { ja: "フォルダ名", en: "Folder name" },
  "newName": { ja: "新しい名前", en: "New name" },
  "loadError": { ja: "読み込みエラー", en: "Load error" },
  "operationError": { ja: "操作エラー", en: "Operation error" },
  "renameError": { ja: "名前の変更エラー", en: "Rename error" },
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

  // --- Main: field-runtime (観測→AIプレフィックス) ---
  "obs.aiPrefix": {
    ja: "[観測: {0}] {1}",
    en: "[Observation: {0}] {1}",
  },
  "obs.recoveryPrefix": {
    ja: "[観測] {0}",
    en: "[Observation] {0}",
  },

  // --- Main: chat-session-service ---
  "noResponse": { ja: "(応答なし)", en: "(no response)" },
  "memorySaved": { ja: "ローカルに保存しました", en: "Saved locally" },
  "intentProjected": { ja: "記録・投影完了", en: "Recorded and projected" },

  // --- Main: observation-formatter ---
  "obs.chat": {
    ja: "[Roblox観測] {0}がRoblox内チャットで話しかけた: 「{1}」\nRoblox内で応答するにはroblox_actionのnpc sayを使うこと。",
    en: "[Roblox] {0} said in Roblox chat: \"{1}\"\nUse roblox_action npc say to respond in Roblox.",
  },
  "obs.proximity.enter": {
    ja: "[Roblox観測] {0}が近づいてきた（距離: {1}スタッド）",
    en: "[Roblox] {0} approached (distance: {1} studs)",
  },
  "obs.proximity.leave": {
    ja: "[Roblox観測] {0}が離れた",
    en: "[Roblox] {0} left",
  },
  "obs.ack.success": {
    ja: "[Roblox ACK] {0} 成功{1}{2}",
    en: "[Roblox ACK] {0} succeeded{1}{2}",
  },
  "obs.ack.fail": {
    ja: "[Roblox ACK] {0} 失敗{1}: {2} - {3}{4}{5}",
    en: "[Roblox ACK] {0} failed{1}: {2} - {3}{4}{5}",
  },
  "obs.ack.retryable": {
    ja: "（再試行可能）",
    en: " (retryable)",
  },
  "obs.ack.validation": {
    ja: "\n検証結果: {0}",
    en: "\nValidation: {0}",
  },
  "obs.follow.started": {
    ja: "[Roblox観測] NPC追従開始{0}",
    en: "[Roblox] NPC follow started{0}",
  },
  "obs.follow.stopped": {
    ja: "[Roblox観測] NPC追従停止{0}",
    en: "[Roblox] NPC follow stopped{0}",
  },
  "obs.follow.lost": {
    ja: "[Roblox観測] NPC追従: プレイヤーを見失った{0}",
    en: "[Roblox] NPC follow: lost player{0}",
  },
  "obs.follow.pathFailed": {
    ja: "[Roblox観測] NPC追従: 経路計算失敗{0}",
    en: "[Roblox] NPC follow: pathfinding failed{0}",
  },
  "obs.follow.default": {
    ja: "[Roblox観測] NPC追従: {0}{1}",
    en: "[Roblox] NPC follow: {0}{1}",
  },
  "obs.projection": {
    ja: "[Roblox観測] 投影結果: {0}",
    en: "[Roblox] Projection result: {0}",
  },
  "obs.default": {
    ja: "[Roblox観測] {0}: {1}",
    en: "[Roblox] {0}: {1}",
  },
}
