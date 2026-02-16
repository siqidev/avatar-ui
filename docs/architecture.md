# Architecture (v0.2.0)

> 本文書は現行実装の事実を記述する。将来の変更予定はPLAN.mdを参照。

## 設計思想

| 原則 | 説明 |
|------|------|
| 自律が基本 | Avatarは自律的にサイクルを回す。ユーザーは例外的に介入する |
| 承認必須 | 会話応答以外のアクション（コマンド実行等）は全て承認制 |
| 目的駆動 | ユーザーが設定した目的に応じて、自律的にタスクを生成・実行する |

## システム構成

```
┌─────────────────┐     REST API      ┌──────────────────┐
│   Console        │◄────────────────►│   Core            │
│   (Electron)     │   localhost:8000  │   (FastAPI)       │
│                  │                   │                   │
│  - UI表示        │                   │  - Grok API呼出   │
│  - ターミナル実行 │                   │  - 状態管理       │
│  - バイタル監視   │                   │  - 自律ループ     │
│  - 承認フロー     │                   │  - Exec Contract  │
└─────────────────┘                   └────────┬──────────┘
                                               │
                                               │ xai-sdk
                                               ▼
                                      ┌──────────────────┐
                                      │   Grok API (xAI)  │
                                      │  - チャット        │
                                      │  - Web検索         │
                                      │  - X検索           │
                                      └──────────────────┘
```

## 設計の基本構造

すべての処理は「意図→処理→結果→応答」の単一構造で動作する。自律ループ・承認フロー・スラッシュコマンド等、入出力の形式が異なっても内部的にはこの構造を共有する。

```
Intent（意図）→ Process（処理・思考）→ Result（結果）→ Feedback（応答・提示）
```

この構造はstate.jsonの状態モデルに直接対応する: input → thought → action → result

## コンポーネント責務

| コンポーネント | 責務 | 実装 |
|---------------|------|------|
| Core | 思考・判断・状態管理・API提供 | Python / FastAPI / xai-sdk |
| Console | 表示・入力・ターミナル実行・監視 | Electron / Node.js |

Core とConsole は REST API で通信する。Console は Core のクライアントであり、Core に依存する。

### 機械とLLMの責務分担

```
[機械] 観察 → [LLM] 判断 → [機械] 承認 → [機械] 実行 → [機械] 記録
```

| 担当 | 責務 | 理由 |
|------|------|------|
| 機械制御 | 観察・承認・実行・記録・状態保存 | 確実性が必要 |
| LLM（Grok API） | 判断（何をするか決める） | 柔軟性が必要 |

## 実行モデル（自律ループ）

### Trigger種別

| 種別 | 説明 | 実装状態 |
|------|------|---------|
| 時間駆動 | インターバルタイマーでサイクルを起動 | ✅ |
| 事象駆動 | 実行結果・状態変化でサイクルを起動 | ✅ |
| 干渉駆動 | ユーザー入力でサイクルを起動 | ✅ |
| Cron/スケジュール | 定時実行 | 未実装 |

### 実行フロー

```
Purpose（目的）
  └─► Goals（目標群）
        └─► Tasks（タスク群）
              └─► Execute（実行）
                    └─► Result（結果）→ 次のタスクへ
```

1. ユーザーがpurposeを設定
2. Core（Grok API）がgoalsを提案
3. 各goalに対してtasksを生成
4. タスクごとに承認を要求
5. 承認後、Exec Contractを通じて実行
6. 結果をstate.jsonとevents.jsonlに記録

### 計画モデル詳細

| 要素 | ステータス | 仕様 |
|------|-----------|------|
| purpose | - | ユーザーが設定。なければAvatarが問いかける |
| goal | active / done | LLMが提案、ユーザーが承認。active目標のみstate.jsonに保持 |
| task | pending / active / done / fail | 逐次実行（並列なし）。失敗時はマークして次へ。2件以上を提案 |

## Exec Contract

実行先を抽象化するレイヤー。`ExecRequest` → `BackendRouter` → `ExecResult` の流れで処理する。

| Backend | 状態 | 用途 |
|---------|------|------|
| Terminal | 稼働 | シェルコマンド実行（Console側PTYで実行） |
| Dialogue | 稼働 | 対話応答 |
| Roblox | 未実装 | ゲーム内行動（将来構想） |
| X | 未実装 | SNS操作（将来構想） |

BackendRouter はAvatar Space制約を検証し、アバター権限でのSpace外アクセスを拒否する。

## 状態・永続化モデル

| ファイル | 形式 | 内容 |
|---------|------|------|
| data/state.json | JSON | 現在の状態（input, mission, thought, action, result） |
| data/events.jsonl | JSONL | イベント履歴（追記のみ） |
| data/logs/console.jsonl | JSONL | コンソール出力ログ |

state.jsonの構造:
```json
{
  "input": { "source": "...", "authority": "...", "text": "..." },
  "mission": {
    "purpose": "...",
    "purpose_type": "...",
    "goals": [
      {
        "id": "G1",
        "name": "...",
        "status": "active",
        "tasks": [
          { "id": "G1-T1", "name": "...", "status": "pending" }
        ]
      }
    ]
  },
  "thought": { "judgment": "...", "intent": "..." },
  "action": { "phase": "...", "summary": "...", "command": "..." },
  "result": { "status": "...", "summary": "..." }
}
```

## 設定モデル

| 設定 | 場所 | 用途 |
|------|------|------|
| config.yaml | プロジェクトルート | アバター名・モデル・UI設定の正本 |
| .env | プロジェクトルート | APIキー・環境変数（gitignore対象） |

config.yamlの主要セクション: avatar, user, grok, system_prompt, autonomous_loop, console_ui

## 起動フロー

```
config.yaml読み込み → state.json読み込み → Grok Client初期化 → 自律ループ開始
                         ↓ 欠損時                                    ↓
                    空stateで初期化                         purpose確認 → サイクル
```

| 状態 | 挙動 |
|------|------|
| purposeあり | サイクル開始（計画→思考→行動→結果） |
| purposeなし | Avatarがdialogueで問いかけ → ユーザー入力 → サイクル開始 |

## 承認フロー

| 項目 | 仕様 |
|------|------|
| 対象 | 会話応答以外の全アクション（コマンド実行等） |
| 待機状態 | action.phase = "approving" |
| 承認 | phase → "executing" → Exec Contract経由で実行 |
| 拒否 | タスクをfailにマーク、ループが次の処理へ |
| キャンセル | phase → "awaiting_continue"、ユーザー介入に移行 |

## セキュリティモデル

| 原則 | 実装 |
|------|------|
| ローカル専用 | localhost:8000のみバインド |
| APIキー制御 | AVATAR_API_KEYでCoreへのアクセスを制限 |
| Avatar Space | アバター権限の操作はSpace内に制限（BackendRouterで検証） |

## エラー処理

| 状況 | 挙動 |
|------|------|
| state.json欠損 | 空の状態で初期化して続行 |
| state.json読み込み/書き込み失敗 | 例外送出（fail-fast） |
| config.yaml必須項目欠損 | 起動時にRuntimeErrorで停止 |
| 不正な設定値 | 即座にエラー（温度範囲外、未知のBackend等） |

## 既知制約

- Terminal Backendの実行はConsole側PTYに依存（Core単体では実行不可）
- Roblox/X Backendは未実装（ExecStatusがFAILを返す）
- レスポンス形式はエンドポイント間で統一されていない
- main.pyが大規模（800行超）で、将来的な分割が必要

## 参照

- API仕様: [docs/api.md](./api.md)
- プロジェクト戦略: [PROJECT.md](../PROJECT.md)
