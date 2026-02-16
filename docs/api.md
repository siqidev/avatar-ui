# API (v0.2.0)

> 本文書は現行APIの事実を記述する。将来のAPI変更予定はPLAN.mdを参照。

## 共通仕様

- Base URL: `http://127.0.0.1:8000`
- 認証: `x-api-key` ヘッダーに `AVATAR_API_KEY` を設定
- Content-Type: `application/json`

## エンドポイント一覧（24本）

### 思考・実行

| メソッド | パス | 用途 |
|---------|------|------|
| POST | /v1/think | メイン思考エンドポイント（ユーザー入力を処理し応答を生成） |
| POST | /v1/exec | Exec Contract経由で実行要求を処理 |

### 自律ループ制御

| メソッド | パス | 用途 |
|---------|------|------|
| GET | /loop/status | ループの稼働状態を取得 |
| POST | /loop/start | 自律ループを開始 |
| POST | /loop/stop | 自律ループを停止 |

### 状態・イベント

| メソッド | パス | 用途 |
|---------|------|------|
| GET | /state | 現在のstate.jsonを取得 |
| GET | /events/recent | 直近のイベントを取得 |

### ミッション管理

| メソッド | パス | 用途 |
|---------|------|------|
| POST | /admin/purpose | purposeを設定 |
| POST | /admin/goal | goalを追加 |
| POST | /admin/task | taskを追加 |

### タスクライフサイクル

| メソッド | パス | 用途 |
|---------|------|------|
| POST | /admin/approve | タスクを承認し実行 |
| POST | /admin/reject | タスクを拒否 |
| POST | /admin/cancel | タスクをキャンセル |
| POST | /admin/complete | goalを完了 |
| POST | /admin/retry | タスクを再試行 |
| POST | /admin/continue | 処理を続行 |

### フロー制御

| メソッド | パス | 用途 |
|---------|------|------|
| POST | /admin/reset | 全状態（purpose/goals/tasks）をリセット |

### 設定

| メソッド | パス | 用途 |
|---------|------|------|
| GET | /console-config | Console用の設定を取得 |
| GET | /admin/config | 現在の設定を取得 |
| POST | /admin/config | 設定を更新（モデル・温度・言語・テーマ等） |

### ログ・監視

| メソッド | パス | 用途 |
|---------|------|------|
| POST | /admin/observation | 観測データを記録 |
| POST | /admin/console-log | コンソールログを記録 |

### ヘルスチェック

| メソッド | パス | 用途 |
|---------|------|------|
| GET | /health | サーバーの稼働確認 |

## 状態遷移（タスクライフサイクル）

```
pending → (approve) → running → done
                    ↘ fail → (retry) → pending
       → (reject)  → rejected
       → (cancel)  → cancelled
```

## LLM出力形式（内部仕様）

Core内部でGrok APIに要求するJSON形式。エンドポイントのレスポンス形式とは別。

| 用途 | 形式 |
|------|------|
| 対話応答（/v1/think） | 自然言語テキスト（JSON化なし） |
| 意図分類（内部） | `{intent, route, proposal}` |
| タスク実行 | `{command, summary}` |
| 目標提案 | `{goals: [{name}]}` |
| タスク提案 | `{tasks: [{name, trigger, response}]}` |

意図分類の詳細:
- `intent`: "conversation" | "action"
- `route`: "dialogue" | "terminal"
- `proposal`: `{command: "bashコマンド", summary: "概要"}` | null

## 注意事項

- レスポンス形式はエンドポイント間で統一されていない（将来の改善候補）
- /admin/* エンドポイントはConsoleからの内部利用を想定
- /v1/think のレスポンスはGrok APIの応答に依存し、形式が変動しうる

## 参照

- アーキテクチャ: [docs/architecture.md](./architecture.md)
