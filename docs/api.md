# API リファレンス

avatar-uiが公開するHTTP/WebSocketエンドポイントの仕様。

## 概要

| エンドポイント | プロトコル | ポート | 認証 | 用途 |
|---|---|---|---|---|
| `/` | HTTP | SESSION_WS_PORT | token (query/cookie) | Console UI配信 |
| `/field-api-polyfill.js` | HTTP | SESSION_WS_PORT | token (query/cookie) | ブラウザ用ポリフィル |
| `ws://` | WebSocket | SESSION_WS_PORT | token (query/header) | セッションイベント配信+応答 |
| `POST /observation` | HTTP | ROBLOX_OBSERVATION_PORT | Bearer token | Roblox観測受信 |
| `GET /x/webhook` | HTTP | X_WEBHOOK_PORT | CRC token | X Webhook CRC検証 |
| `POST /x/webhook` | HTTP | X_WEBHOOK_PORT | HMAC-SHA256署名 | X Webhookイベント受信 |

## Console HTTP（console-http-server.ts）

### GET /

Console UIのindex.htmlを返却。ポリフィル注入+CSP書き換え済み。

- **認証**: `?token=xxx`（クエリ）または `Cookie: aui_token=xxx`。SESSION_WS_TOKEN未設定時は認証なし
- **成功**: 200 + HTML。Cookie `aui_token` をセット（HttpOnly, SameSite=Strict）
- **失敗**: 401 `Unauthorized — ?token=xxx でアクセスしてください`

### GET /field-api-polyfill.js

ブラウザ向けの `window.fieldApi` スタブを動的生成。WS接続情報（ポート、トークン、devMode）を埋め込む。

- **Cache-Control**: `no-cache`（設定値変更対応）

### GET /static/*

`out/renderer/` 配下の静的ファイル配信。ディレクトリトラバーサル検査あり。

## WebSocket API（session-ws-server.ts）

### 接続

- **URL**: `ws://localhost:{SESSION_WS_PORT}` または `wss://`（トンネル経由）
- **認証**: `?token=xxx`（クエリ）または `Authorization: Bearer xxx`（ヘッダー）。SESSION_WS_TOKEN未設定時は認証なし
- **初回**: 接続確立後、サーバーから `session.state` を送信
- **ping/pong**: 30秒間隔（Cloudflareアイドルタイムアウト対策）

### Server → Client イベント

全イベント共通構造:

```typescript
{
  eventId: string    // UUID
  ts: string         // ISO 8601
  kind: SessionEventKind
  payload: { ... }
}
```

#### stream.item — 発話

```typescript
kind: "stream.item"
payload: {
  actor: "ai" | "human"
  correlationId: string
  text: string
  displayText?: string       // 表示用テキスト（省略時 = text）
  source: "user" | "pulse" | "observation"
  channel: "console" | "roblox" | "x" | "discord"
  toolCalls?: Array<{
    name: ToolName
    args?: Record<string, unknown>
    result: string
  }>
}
```

#### approval.requested — ツール承認リクエスト

```typescript
kind: "approval.requested"
payload: {
  requestId: string          // UUID
  toolName: ToolName
  args: Record<string, unknown>
  requestedAt: string        // ISO 8601
}
```

#### approval.resolved — 承認結果

```typescript
kind: "approval.resolved"
payload: {
  requestId: string
  toolName: ToolName
  args: Record<string, unknown>
  approved: boolean
  reason: "AUTO_APPROVED" | "USER_APPROVED" | "USER_DENIED" | "NO_APPROVER"
}
```

#### monitor.item — Roblox/Xイベント監視

```typescript
kind: "monitor.item"
payload: {
  channel: "roblox" | "x"
  eventType: string
  payload: Record<string, unknown>
  formatted: string          // 表示文字列
  timestamp: string          // ISO 8601
}
```

#### session.state — セッション状態（初回接続時）

```typescript
kind: "session.state"
payload: {
  fieldState: "generated" | "active" | "paused" | "resumed" | "terminated"
  settings: { avatarName: string, userName: string }
  history: Array<StreamHistoryItem | MonitorHistoryItem>
  pendingApprovals: Array<{ requestId, toolName, args, requestedAt }>
}
```

### Client → Server メッセージ

#### stream.post — メッセージ送信

```json
{
  "type": "stream.post",
  "actor": "human",
  "correlationId": "string",
  "text": "メッセージテキスト",
  "channel": "console",
  "inputRole": "owner"
}
```

- `text` は1文字以上が必須
- `channel`（省略可）: `"console"` | `"roblox"` | `"x"` | `"discord"`。省略時 `"console"`
- `inputRole`（省略可）: `"owner"` | `"external"`。省略時 `"owner"`

#### tool.approval.respond — 承認応答

```json
{
  "type": "tool.approval.respond",
  "requestId": "uuid",
  "decision": "approve" | "deny"
}
```

- 成功: `{ type: "tool.approval.result", ok: true }`
- 失敗: `{ ok: false, reason: "REQUEST_NOT_FOUND" | "ALREADY_RESOLVED" }`

### ToolName一覧

```
save_memory | fs_list | fs_read | fs_write | fs_mutate |
terminal | roblox_action | x_post | x_reply
```

## Roblox観測API（observation-server.ts）

### POST /observation

Robloxからの観測イベント受信。

- **認証**: `Authorization: Bearer {ROBLOX_OBSERVATION_SECRET}`（設定時のみ）
- **成功**: `200 { "status": "ok" }`
- **認証失敗**: `401 Unauthorized`
- **バリデーション失敗**: `400 { "error": "Invalid observation event" }`

```json
{
  "type": "player_chat" | "player_proximity" | "projection_ack" | "command_ack" | "npc_follow_event" | "roblox_log",
  "serverId": "string",
  "timestamp": "ISO 8601",
  "payload": { ... }
}
```

`roblox_log` は表示+ログのみ。AIには送らない（再帰防止）。

## X Webhook API（x-webhook-server.ts）

### GET /x/webhook — CRC検証

X Account Activity APIのCRC（Challenge-Response Check）。

- **パラメータ**: `?crc_token=xxx`
- **成功**: `200 { "response_token": "sha256=..." }`
- **失敗**: `400 { "error": "Missing crc_token" }`

### POST /x/webhook — イベント受信

X Account Activity APIからのイベント配信。

- **認証**: `X-Twitter-Webhooks-Signature: sha256=...`（HMAC-SHA256、タイミング安全比較）
- **成功**: `200 { "status": "ok" }`（即座に返却）
- **認証失敗**: `401 { "error": "Missing signature" | "Invalid signature" }`

処理フロー:
1. 署名検証
2. 重複排除（x-dedupe-repository.ts）
3. 自己投稿スキップ（X_USER_ID一致）
4. `x_mention` イベント生成 → FieldRuntimeに配信
