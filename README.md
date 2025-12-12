# Avatar UI

人と AI が共存する次世代インターフェース基盤。  
AG-UI プロトコル準拠 / マルチ LLM 対応 / デスクトップ & 拡張可能。

![demo](./docs/assets/avatar-ui_demo_02.gif)

## 特徴

- **AG-UI 準拠** – 標準プロトコルでエージェントと UI を接続
- **マルチ LLM** – Gemini / OpenAI / Anthropic を設定で切り替え
- **拡張設計** – ツール追加・サブエージェント追加が容易
- **デスクトップ動作** – Electron によるローカル実行
- **フルカスタマイズ** – テーマ、アバター、プロンプトを自由に変更

## 使い方

1. アプリを起動すると、アバターが待機状態で表示されます
2. 入力欄にメッセージを入力して Enter で送信
3. アバターがリアルタイムで応答（タイピングアニメーション付き）
4. Google 検索が必要な質問は自動で検索して回答

## クイックスタート

**必要なもの**: Node.js 20+, Python 3.12+

### 1. 環境変数を設定

```bash
cp .env.example .env
```

`.env` を開き、API キーを設定:

```dotenv
# ══════════════════════════════════════════════════
# ↓ ここを編集: あなたの API キーに置き換え
# ══════════════════════════════════════════════════
GOOGLE_API_KEY=ここにAPIキーを貼り付け
```

> API キー取得先: [Gemini](https://aistudio.google.com/app/apikey) / [OpenAI](https://platform.openai.com/api-keys) / [Anthropic](https://console.anthropic.com/settings/keys)

### 2. サーバー起動（初回セットアップ）

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install .
```

### 3. 開発をワンコマンドで起動（サーバー＋クライアント同時・1ターミナル）

```bash
cd server
source .venv/bin/activate   # Windows: .venv\Scripts\activate
cd ../app
npm install   # 初回のみ
npm run dev:all
```

1ターミナルで両方走ります。終了は Ctrl+C で OK。

#### 代替: 2ターミナルで個別に起動したい場合
- サーバーだけ: `cd server && source .venv/bin/activate && ./.venv/bin/python -m uvicorn main:app --reload`
- クライアントだけ: `cd app && npm run dev`

## 設定

### LLM の切り替え

`settings.json5` を編集（なければ `settings.default.json5` をコピー）:

```json5
"server": {
  "llmProvider": "gemini",       // gemini | openai | anthropic
  "llmModel": "gemini-2.5-flash"
}
```

対応する API キーを `.env` に設定し、サーバーを再起動。

### Google 検索機能

Gemini 使用時のみ有効。無効化する場合:

```json5
"searchSubAgent": {
  "enabled": false
}
```

### カスタマイズ

| 項目 | 場所 |
|------|------|
| システムプロンプト | `settings.json5` → `server.systemPrompt` |
| テーマ・色 | `settings.json5` → `ui.theme`, `ui.themes` |
| アバター画像 | `app/src/renderer/assets/` |
| ツール追加 | `server/main.py` → `tools` リスト |

## ビルド

配布用パッケージを作成:

```bash
cd app
npm run build     # レンダラービルド
npm run package   # Electron パッケージ生成
```

成果物: `app/dist/`

## 参考情報

### 公式ドキュメント

- [AG-UI Protocol](https://docs.ag-ui.com/)
- [Google ADK](https://google.github.io/adk-docs/)
- [ADK Built-in Tools](https://google.github.io/adk-docs/tools/built-in-tools/)

### 技術的な注意

- **セッション**: メモリ上で保持。サーバー再起動で会話履歴は消失
- **Google 検索**: Gemini 2.x/3.x 系モデルのみ対応（詳細は公式ドキュメント参照）

## ライセンス

[MIT License](LICENSE)

© 2025 [SIQI](https://siqi.jp) (Sito Sikino)

> ⚠️ 外部 API（Gemini / OpenAI / Anthropic 等）の利用は各サービスの利用規約に従ってください。API キーは本リポジトリに含まれていません。
