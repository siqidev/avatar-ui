// INFO と ERROR をコンソールに出すロガー
// コンソールに INFO レベルのログを出す
export function logInfo(message: string) {
  console.info(`[INFO] ${message}`);
}

// コンソールに ERROR レベルのログを出す
export function logError(message: string) {
  console.error(`[ERROR] ${message}`);
}
