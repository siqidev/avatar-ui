# Avatar UI Project

AG-UI プロトコルと Google ADK を用いたレトロターミナル風エージェント UI の設計書。

---

## 1. Overview

### 目的

入力欄・出力欄・アバターのみで構成されるレトロ端末風チャット UI を構築する。CopilotKit 等の外部 UI フレームワークに依存せず、AG-UI プロトコルと Google ADK の公式スタックのみで実装する。

### 技術スタック

| レイヤー | 技術 | 説明 |
|----------|------|------|
| フロント | Electron + Vite + TypeScript | デスクトップアプリとして動作 |
| バックエンド | FastAPI + Google ADK | AG-UI ミドルウェア経由でエージェント実行 |
| プロトコル | AG-UI Protocol | エージェント・UI 間の標準通信規格 |
| LLM | Gemini / OpenAI / Anthropic | LiteLLM 経由で切り替え可能 |

### 設計原則

- **SSOT (Single Source of Truth)**: アプリ設定は `settings.json5`、秘密情報・環境値は `.env` で管理
- **Fail-Fast**: 設定不備は起動時に検出してエラー終了
- **公式準拠**: AG-UI / Google ADK の公式仕様に従う
- **最小構成**: 不要な依存・機能を持たない

---

## 2. Requirements

### 機能要件

| 機能 | 詳細 |
|------|------|
| リアルタイムチャット | SSE によるストリーミング応答 |
| マルチ LLM | Gemini / OpenAI / Anthropic を設定で切り替え |
| 検索サブエージェント | Gemini + Google Search によるウェブ検索（Gemini 2.x 系のみ） |
| テーマ切替 | Classic / Cobalt / Amber の 3 プリセット |
| カスタマイズ | プロンプト、アバター画像、色、各種パラメータを設定ファイルで変更 |

### 非機能要件

| 項目 | 詳細 |
|------|------|
| セキュリティ | `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, CSP 明示 |
| セッション管理 | メモリ上保持、タイムアウトで自動クリーンアップ |
| API キー | ユーザー各自が用意（リポジトリに含めない） |
| ログ管理 | ローテーション対応。開発環境ではボディログ ON（`APP_ENV=dev` または `LOG_BODY=true`）、本番は OFF 推奨 |

---

## 3. Architecture

### システム構成図

```
[Client: Electron]              [Server: FastAPI]                [Cloud]

┌─────────────────┐             ┌──────────────────────┐
│  Renderer       │     SSE     │  main.py             │
│  ├─ main.ts     │◄───────────►│  └─ ADKAgent         │
│  ├─ subscriber  │             │      ├─ LlmAgent     │──────► Gemini API
│  └─ Terminal    │             │      │   (main)      │        OpenAI API
│      Engine     │             │      │               │        Anthropic API
│                 │             │      └─ AgentTool    │
│  Main Process   │             │          └─ search   │──────► Google Search
│  └─ index.ts    │             │              _agent  │
└─────────────────┘             └──────────────────────┘
```

### ディレクトリ構成

```
avatar-ui/
├── app/                          # Electron クライアント
│   ├── build/
│   │   └── icon.png              # アプリアイコン（各 OS 形式に自動変換）
│   ├── src/
│   │   ├── core/                 # 共通ロジック
│   │   │   ├── agent.ts          # AG-UI エージェント初期化
│   │   │   ├── logger.ts         # ロガー
│   │   │   └── loggerSubscriber.ts
│   │   ├── main/
│   │   │   └── index.ts          # Electron メインプロセス
│   │   ├── preload/
│   │   │   └── index.ts          # プリロードスクリプト
│   │   └── renderer/
│   │       ├── assets/           # アバター画像 (idle.png, talk.png)
│   │       ├── engine/
│   │       │   └── TerminalEngine.ts  # タイプライター演出エンジン
│   │       ├── config.ts         # 設定取得
│   │       ├── index.html
│   │       ├── main.ts           # レンダラーエントリ
│   │       ├── style.css
│   │       └── subscriber.ts     # AG-UI イベント購読・DOM 更新
│   ├── electron-builder.yml      # パッケージング設定
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── server/                       # FastAPI サーバー
│   ├── main.py                   # エントリーポイント、エージェント構築
│   ├── pyproject.toml            # 依存定義
│   ├── src/
│   │   ├── config.py             # 設定読み込み・検証 (Pydantic)
│   │   └── ag_ui_adk/            # AG-UI 公式 ADK ミドルウェア（微調整版）
│   │       ├── adk_agent.py      # ADK エージェントラッパー
│   │       ├── endpoint.py       # FastAPI エンドポイント登録
│   │       ├── event_translator.py  # ADK → AG-UI イベント変換
│   │       ├── session_manager.py   # セッション管理
│   │       ├── client_proxy_tool.py    # クライアントサイドツール（単体）
│   │       ├── client_proxy_toolset.py # クライアントサイドツール（セット）
│   │       └── execution_state.py
│   └── tests/                    # テストスイート
│
├── docs/
│   ├── assets/                   # ドキュメント用アセット
│   └── project.md                # 本書
│
├── settings.json5                # ユーザー設定（SSOT）
├── settings.default.json5        # デフォルト設定
├── .env                          # 環境変数（API キー等、git 管理外）
├── LICENSE
└── README.md
```

### AG-UI イベントフロー

クライアントは `@ag-ui/client` を使用してサーバーから SSE でイベントを購読し、DOM を更新する（WebSocket は未実装）。

| イベント | 発生タイミング | UI 処理 |
|----------|----------------|---------|
| `TextMessageStart` | アシスタント発話開始 | 新規行を作成、アバターを talk 状態に |
| `TextMessageContent` | テキスト断片受信 | TerminalEngine で逐次表示（タイプライター演出） |
| `TextMessageEnd` | 発話完了 | アバターを idle 状態に |
| `ToolCallStart` | ツール呼び出し開始 | 折りたたみ要素を作成 |
| `ToolCallArgs` | ツール引数（ストリーミング） | 引数をバッファに蓄積 |
| `ToolCallEnd` | ツール呼び出し完了 | サマリーを更新 |
| `ToolCallResult` | ツール実行結果 | 折りたたみ内に結果を表示 |
| `RunFailed` | 実行エラー | エラーメッセージを表示 |

### 設定管理

設定は 2 種類のファイルから読み込む:

1. **`.env`** - 秘密情報（API キー）と環境依存値
2. **`settings.json5`** - アプリケーション設定（SSOT）

サーバー起動時に Pydantic で検証し、不正値があれば即座にエラー終了する（Fail-Fast）。

クライアントは `/agui/config` エンドポイントから設定を取得し、サーバーを唯一の真実源とする。

---

## 4. Implementation Notes

### サーバー側

**エージェント構築 (`main.py`)**

```python
# メインエージェント: Gemini / OpenAI / Anthropic を LiteLLM 経由で切り替え
main_agent = LlmAgent(
    name="assistant",
    model=resolve_model(provider, model),  # gemini は直接、他は LiteLlm 経由
    instruction=config.SYSTEM_PROMPT,
    tools=[preload_memory, search_tool],
)

# 検索サブエージェント: Gemini + Google Search（Gemini 2.x 系専用）
search_agent = LlmAgent(
    name="search_agent",
    model="gemini-2.5-flash",
    tools=[GoogleSearchTool(bypass_multi_tools_limit=True)],
)
search_tool = AgentTool(agent=search_agent)
```

**設定スキーマ (`config.py`)**

- `ServerSettings`: LLM プロバイダ、モデル、システムプロンプト、ログ設定
- `UiSettings`: テーマ、タイピング速度、アバター設定、ラベル類
- `EnvSettings`: API キー、ポート、セッションタイムアウト

**エンドポイント**

| パス | メソッド | 説明 |
|------|----------|------|
| `/agui` | POST | AG-UI プロトコルメインエンドポイント（SSE） |
| `/agui/config` | GET | クライアント向け設定を返す |
| `/healthz` | GET | ヘルスチェック |

### クライアント側

**TerminalEngine (`TerminalEngine.ts`)**

タイプライター演出を担当。`typeSpeed` で指定された間隔で 1 文字ずつ DOM に追加し、ビープ音を再生する。

**イベント購読 (`subscriber.ts`)**

`AgentSubscriber` インターフェースを実装し、AG-UI イベントを受信して DOM を更新する。ツール呼び出しは `<details>` 要素で折りたたみ表示。

**テーマ適用**

`settings.json5` のテーマ色を HEX→RGB 変換して CSS 変数に注入。アバター画像はモノクロ・フルカラーどちらでも可（モノクロの場合は CSS フィルターで着色される）。

### セキュリティ

- Electron: `sandbox`, `contextIsolation`, `nodeIntegration:false`
- CSP: `img-src`, `connect-src` を明示的に制限
- DevTools: 開発時のみ有効化
- API キー: `.env` に格納し、リポジトリに含めない

### 既知の制約

- Google Search は Gemini 2.x/3.x 系モデルのみ対応
- セッションはメモリ上保持のため、サーバー再起動で消失
- `google-adk` は頻繁に API 変更が入るため、定期的にバージョン確認が必要

---

## 5. Roadmap / Future Work

### 未実装（検討中）

| 項目 | 内容 | 優先度 |
|------|------|--------|
| MCP 連携 | ファイル操作、Git 操作等のローカルツール統合 | 中 |
| サーバーバイナリ化 | PyInstaller で Electron に同梱し、単一アプリ化 | 中 |
| ワンコマンド起動 | 開発者向け venv + uvicorn + npm の統合起動スクリプト | 低 |
| テーマ拡張 | 枠形状・フォント・スキャンライン強度の差分化 | 低 |
| リモートモード | 公開サーバーへの接続対応 | 低 |
| 設定 UI | アプリ内設定画面（API キー入力含む） | 低 |
| 長期記憶化 | ベクトルDB/外部ストレージを用いた永続メモリ（再起動越しのコンテキスト維持） | 中 |

### 完了済み

- AG-UI CLI から Electron GUI への移行
- マルチ LLM 対応（Gemini / OpenAI / Anthropic）
- 検索サブエージェント実装（AgentTool 方式）
- 設定一元化（SSOT）と Pydantic バリデーション
- セキュリティ強化（sandbox, CSP）
- パッケージング最適化（asar, 言語絞り込み）

---

## References

### 公式ドキュメント

- [AG-UI Protocol](https://docs.ag-ui.com/) - エージェント・UI 通信プロトコル仕様
- [Google ADK](https://google.github.io/adk-docs/) - Agent Development Kit
- [ADK Built-in Tools](https://google.github.io/adk-docs/tools/built-in-tools/) - google_search 等

### 公式リポジトリ

- [ag-ui-protocol/ag-ui](https://github.com/ag-ui-protocol/ag-ui) - AG-UI プロトコル本体
- [google/adk-python](https://github.com/google/adk-python) - Google ADK Python 版

### 本リポジトリ内の AG-UI ミドルウェア

`server/src/ag_ui_adk/` には、AG-UI 公式の ADK ミドルウェア（adk-middleware テンプレート）を同梱し、プロジェクト向けに設定・挙動を微調整したものを置いている。完全自作ではなく公式テンプレートがベース。
