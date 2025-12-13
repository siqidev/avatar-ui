# Avatar UI

人と AI が共存する次世代インターフェース基盤。  
Gemini・GPT・Claude 対応。デスクトップで動くエージェント UI。

![demo](./docs/assets/avatar-ui_demo_02.gif)

## 特徴

- **マルチLLM対応** – Google ADK 上に構築。Gemini / OpenAI / Anthropic を設定で切り替え
- **ツール拡張対応** – 検索エージェントをプリセット。MCP連携やカスタムツールも追加可能
- **パーソナライズUI** – キャラクター表示、リップシンク、3種のカラーテーマ。アバター変更も自由
- **デスクトップアプリ** – ブラウザを開かずローカルで動作。macOS / Windows / Linux 対応
- **商用利用可** – オープンソース（MIT）。個人・商用問わず自由に利用可能

## 使い方

1. アプリを起動すると、アバターが待機状態で表示されます
2. 入力欄にメッセージを入力して Enter で送信
3. アバターがリアルタイムで応答（タイピングアニメーション付き）
4. Google 検索が必要な質問は自動で検索して回答
5. 終了するときは `Ctrl+C`（Mac は `Cmd+C` でも可）

## クイックスタート

### 必要なもの

- Node.js 20+
- Python 3.12+
- API キー（いずれか1つ以上）
  - [Gemini](https://aistudio.google.com/app/apikey)
  - [OpenAI](https://platform.openai.com/api-keys)
  - [Anthropic](https://console.anthropic.com/settings/keys)

### 1. リポジトリを取得

GitHub からソースコードをダウンロードします（`git clone` コマンド）。

```bash
git clone https://github.com/siqidev/avatar-ui.git
cd avatar-ui
```

### 2. 環境変数を設定

API キーなどの秘密情報を `.env` ファイルに保存します。  
まずテンプレートをコピー:

```bash
cp .env.example .env
```

`.env` を開き、使用する LLM の API キーを設定:

```dotenv
GOOGLE_API_KEY=your-api-key-here
# OpenAI / Anthropic を使う場合は対応するキーも設定
```

### 3. セットアップと起動

#### macOS / Linux

```bash
# サーバー準備（Python 仮想環境を作成し、依存をインストール）
cd server
python3 -m venv .venv   # 初回のみ
source .venv/bin/activate
pip install -e .        # 初回のみ

# 起動（サーバー + クライアント同時）
cd ../app
npm install             # 初回のみ
npm run dev:all
```

#### Windows (PowerShell)

```powershell
# サーバー準備（Python 仮想環境を作成し、依存をインストール）
cd server
py -3 -m venv .venv     # 初回のみ
.\.venv\Scripts\activate
pip install -e .        # 初回のみ

# 起動（サーバー + クライアント同時）
cd ..\app
npm install             # 初回のみ
npm run dev:all
```

起動すると Electron アプリが自動で開きます。開発中はターミナルに表示される URL（例: `http://localhost:5173`）からブラウザでも確認できます。

### 個別起動

2つのターミナルで別々に起動したい場合:

```bash
# ターミナル1: サーバー
cd server
source .venv/bin/activate   # Windows: .\.venv\Scripts\activate
python -m uvicorn main:app --reload

# ターミナル2: クライアント
cd app
npm run dev
```

## 設定

設定ファイルをコピーして編集します:

```bash
cp settings.default.json5 settings.json5
```

`settings.json5` で LLM やテーマなどを変更できます。

### LLM の切り替え

```json5
"server": {
  "llmProvider": "gemini",       // gemini | openai | anthropic
  "llmModel": "gemini-2.5-flash"
}
```

対応する API キーを `.env` に設定し、サーバーを再起動してください。

### 検索サブエージェント

デフォルトで Google 検索サブエージェントが有効です（Gemini モデルで動作）。  
無効化する場合:

```json5
"searchSubAgent": {
  "enabled": false
}
```

検索サブエージェントは Gemini API を使用するため、利用には `GOOGLE_API_KEY` の設定が必要です。

### カスタマイズ一覧

| 項目 | 設定場所 |
|------|----------|
| システムプロンプト | `settings.json5` → `server.systemPrompt` |
| テーマ・色 | `settings.json5` → `ui.theme`, `ui.themes` |
| アバター画像 | `app/src/renderer/assets/` に配置 |
| ツール追加 | `server/main.py` → `tools` リスト |

## ドキュメント

- [設計書](./docs/project.md) – アーキテクチャ、実装詳細、ロードマップ
- [AG-UI Protocol](https://docs.ag-ui.com/) – プロトコル仕様（公式）
- [Google ADK](https://google.github.io/adk-docs/) – エージェント開発キット（公式）

## ライセンス

[MIT License](LICENSE)

© 2025 [SIQI](https://siqi.jp) (Sito Sikino)

> 外部 API（Gemini / OpenAI / Anthropic 等）の利用は各サービスの利用規約に従ってください。
