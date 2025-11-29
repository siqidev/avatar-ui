# Avatar UI (with Google ADK)

レトロフューチャーなデザインのチャットボットUIアプリケーションです。
Google Gemini (Google ADK) をバックエンドに使用し、Electron で動作するデスクトップアプリとして設計されています。

![screenshot](./app/src/renderer/assets/idle.png)

## ✨ 特徴

*   **レトロ端末風 UI**: 懐かしくも新しい、コンソール風のインターフェース。
*   **Google Gemini 連携**: Google の最新 AI モデルによる高度な会話機能。
*   **Google 検索対応**: 最新の情報を検索して回答する機能を標準搭載。
*   **Electron アプリ**: Windows, Mac, Linux で動作するデスクトップアプリケーション。
*   **開発者フレンドリー**: AG-UI プロトコル準拠。Python (FastAPI) と TypeScript (Electron) の分離構成で拡張が容易。

## 🚀 クイックスタート（開発者向け：最新手順）

### 1. 前提条件
- Node.js 20+
- Python 3.12+
- Google Gemini API Key（[取得](https://aistudio.google.com/app/apikey)）

### 2. 環境変数をリポジトリルートに `.env` として用意
```bash
GOOGLE_API_KEY=...
OPENAI_API_KEY=...      # https://platform.openai.com/api-keys
ANTHROPIC_API_KEY=...   # https://console.anthropic.com/settings/keys
SERVER_HOST=localhost
SERVER_PORT=8000
CLIENT_PORT=5173
# 環境モード（dev|prod）。devでは詳細ログやボディログを許可しやすくする想定
APP_ENV=dev
# ボディ全量ログを開発時だけ有効にしたい場合（任意）
# LOG_BODY=true
```
※ `vite.config.ts` は親ディレクトリの `.env` を読むため、`app/.env` は不要です。

#### LLM の切り替え（settings.json5）
```json5
"server": {
  "llmProvider": "gemini",                // gemini | openai | anthropic
  "llmModel": "gemini-2.5-flash",         // gemini-2.5-flash | gpt-5 | claude-sonnet-4-5
  "searchSubAgent": {
    "enabled": true,
    "model": "gemini-2.5-flash"           // Google Search 用（Gemini 固定）
  }
}
```
プロバイダを変えるときは、対応する API キーを `.env` に入れて再起動してください。

### 3. サーバーセットアップ & 起動
```bash
cd server
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install .
# いずれかでポートを渡す（.env はシェルに自動では読み込まれない）
# A) .env を読み込んでから環境変数で渡す
. ../.env  # または export $(cat ../.env | xargs)
uvicorn main:app --reload --host 0.0.0.0 --port "$SERVER_PORT"
# B) 単純にポート番号を直指定
# uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
設定値は `settings.json`（なければ `settings.default.json`）から読み込みます。LLM モデルやプロンプトを変更したい場合は `settings.json` を編集してください。

### 4. クライアントセットアップ & 起動
```bash
cd app
npm install
npm run dev   # Vite + Electron が同時起動し、/agui をサーバーにプロキシ
```

### 5. 配布用ビルド
```bash
cd app
npm run build     # renderer ビルド
npm run package   # electron-builder でパッケージ生成
```
成果物は `app/dist/` 配下に出力されます。

## モデルとツールの互換性について
- 推奨ペア: **Gemini 2.x/3.x 系 + Google Search ツール**（仕様は頻繁に更新されるため要確認）
- Google Search ツールがサポートするモデルの例（2025-11-23 時点）  
  - gemini-3-pro-preview, gemini-3-pro-image-preview  
  - gemini-2.5-pro / gemini-2.5-flash / gemini-2.5-flash-lite  
  - gemini-2.0-flash-001 など  
  ※最新の対応モデルは公式ドキュメントを参照してください。citeturn0search1
- 公式一次情報: Google ADK Built-in Tools（Google Search ツールの対応モデルと制約を確認）  
  https://google.github.io/adk-docs/tools/built-in-tools/


## 公式ドキュメントへのリンク
- AG-UI Protocol / SDK: https://docs.ag-ui.com/
- ADK Middleware (upstream サンプル): https://github.com/ag-ui-protocol/ag-ui/tree/main/typescript-sdk/integrations/adk-middleware
※ 本リポジトリの server/ 配下ドキュメントは削除し、最新情報は上記公式ソースを参照してください。

## セッション保持について（短期記憶）
- サーバのセッションはメモリ上で保持しており、**サーバ再起動で会話履歴・ツール結果の待ち状態は消えます**（短期記憶のみ）。  
- 長期記憶（永続化）を行いたい場合は、別途ストレージ連携やセッション永続化を検討してください。

## 🛠️ カスタマイズ

*   **エージェントの性格**: `server/main.py` の `instruction` を変更してください。
*   **ツールの追加**: `server/main.py` の `tools` リストに追加します。
*   **UIの変更**: `app/src/renderer/` 内の HTML/CSS を編集してください。

## 📜 ライセンス

[MIT License](LICENSE)
