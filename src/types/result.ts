// アプリケーション統一戻り値型
export type AppResult<T> =
  | { success: true; data: T; meta?: Record<string, unknown> }
  | {
      success: false
      error: { code: string; message: string }
      meta?: Record<string, unknown>
    }

export function ok<T>(data: T, meta?: Record<string, unknown>): AppResult<T> {
  return { success: true, data, ...(meta ? { meta } : {}) }
}

export function fail<T>(
  code: string,
  message: string,
  meta?: Record<string, unknown>,
): AppResult<T> {
  return { success: false, error: { code, message }, ...(meta ? { meta } : {}) }
}
