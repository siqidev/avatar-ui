# AG-UI CLI + Google ADK 移行メモ

更新日: 2025-11-18

## 1. 方針
- フロント側は `@ag-ui/client` ベースの CLI（`/app`）で AG-UI プロトコルのみ扱う。
- バックエンド側は **AG-UI 公式リポジトリ** に含まれる `ag_ui_adk` ミドルウェア（FastAPI + Google ADK Agent）をそのまま利用する。
- サードパーティ実装（Trend Micro 版など）は採用しない。

## 2. CLI 側の現状
- `app/` は `create-ag-ui-app`（Client Type = CLI）で生成済み。Mastra/OpenAI 依存は削除し、`@ag-ui/client` と `@ag-ui/core` だけを残した。
- `npm run dev` で CLI が起動し、`AG_UI_AGENT_URL` で指定されたエンドポイントへ JSON/SSE を投げる薄い層。

## 3. Google ADK ミドルウェア（公式サンプル）
1. **リポジトリ入手**
   ```bash
   git clone https://github.com/ag-ui-protocol/ag-ui.git ag-ui-upstream
   ```
   - `ag-ui-upstream/typescript-sdk/integrations/adk-middleware` に FastAPI サンプルがある。
   - 付属ドキュメント（`USAGE.md`, `CONFIGURATION.md`, `TOOLS.md`, `ARCHITECTURE.md`）が一次情報源。

2. **ローカル展開**
   - プロジェクト内に `server/` を作り、上記ディレクトリから `python/` サンプルコードをコピー。
   - 推奨構成：`server/` に `app/`, `requirements.txt`, `.env.example` を配置（サンプル通り）。

3. **依存導入**
   ```bash
   cd server
   python3.12 -m venv .venv
   source .venv/bin/activate
   pip install .
   ```
   - サンプルは `pip install .`（または `pip install -e .`）でミドルウェア本体と依存を導入。

4. **環境変数**
   - `server/.env` に `GOOGLE_API_KEY=...`（Gemini API Key）を設定。必要に応じて `AG_UI_AGENT_NAME` なども追記。

5. **起動**
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
   - `server/main.py` で `add_adk_fastapi_endpoint(..., path="/agui")` を指定してあるため、`http://localhost:8000/agui` がクライアント用エンドポイントになる。

## 4. 接続検証
1. サーバー起動後、`http://localhost:8000/agui` に `GET` して 200 が返ることを確認。
2. 別ターミナルで `cd app && npm run dev`。
3. CLI からメッセージを送ると、AG-UI SSE を通じて ADK Agent の応答が返る。

## トラブルシュートメモ
- **HTTP 404**: CLI の `AG_UI_AGENT_URL` を FastAPI で公開しているパスに合わせる（例：`/agui`）。末尾スラッシュの有無にも注意。
- **RUN_ERROR → RUN_FINISHED**: ADK 側で `new_message` を生成できずに落ちている可能性。CLI の `agent.messages.push(...)` を使って、`RunAgentInput` にユーザー発話が含まれるようにする。
- **Gemini API 鍵エラー**: FastAPI 側で `GOOGLE_API_KEY` を読み込めているか確認。`dotenv` で `.env` を読み、`LlmAgent` にはキーを直接渡さず環境変数で認証する。
- **ログ確認**: サーバー側は `server/logs/app.log`、CLI 側は `app/logs/cli.log` に出力される。問題が起きたら両ログを確認する。

## エラー修正の履歴（リファクタ対象）
1. **CLI `.env` ローダー追加**
   - `dotenv` を導入し、`app/src/index.ts` の冒頭で `import "dotenv/config";` を読み込む形に統一。余分なローダーファイルは不要になった。
   - 起動時に `[CLI] agent endpoint ...` をログ出力して接続先を確認。

2. **ユーザーメッセージの同期**
   - グローバル配列を廃止し、`agent.messages.push(userMessage)` を直接呼ぶ（公式 CLI と同じ）。
   - `buildSubscriber` ではログ表示のみ行い、メッセージの手動同期は不要。

3. **FastAPI サーバー再構成**
   - 公式サンプルを基に `server/main.py` を作成し、`add_adk_fastapi_endpoint(..., path="/agui")` で `/agui` エンドポイントを公開。
   - `AG_UI_AGENT_URL` を `http://localhost:8000/agui` に設定し、404 を解消。

4. **Gemini API キー読み込み**
   - `python-dotenv` で `GOOGLE_API_KEY` を読み込み、キー未設定時は `RuntimeError` で通知。
   - `LlmAgent` にはキーを直接渡さず、環境変数で認証（Google ADK が自動参照）。

5. **サーバー/CLI ログ整備**
   - `server/logs/app.log`: `logging` + `RotatingFileHandler` で出力し、デバッグ用ミドルウェアを削除。
   - `app/logs/cli.log`: 簡易ロガーを実装し、ユーザー入力やエラーをファイル出力するようにした。

6. **PLAN.md 更新**
   - ステップ4～5の達成状況を反映し、ステップ7（公式最小構成へのリファクタ計画）を追加。
