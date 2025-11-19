# プロジェクト計画：AG-UI CLI + Google ADK 基盤構築

## 背景 / ゴール
- 最終目的は **入力欄＋出力欄＋アバターのみのレトロ端末風チャット UI**。レンダリング層は最終的に HTML/CSS/JS など軽量構成で自由に改造できるようにする。
- CopilotKit 依存と公開ライセンスキー要件を完全に排除し、**AG-UI プロトコル + Google ADK** の公式スタックのみで構築する。
- 最小構成：AG-UI CLI クライアント（将来 GUI 化）、`ag_ui_adk` / `adk-agui-middleware` による FastAPI ブリッジ、Google ADK Agent。段階的に動作確認を積み上げる。

## ステップ0：リポジトリ初期化（完了）
- [x] `/Users/u/Projects/project-m-019` を空にし、`git init` 済み。
- [x] `dev` ブランチ上で作業中。

## ステップ1：情報収集と設計方針（完了）
1. **AG-UI CLI テンプレ調査**
   - [x] `create-ag-ui-app` CLI テンプレの構成（Mastra ベース / Node 18+ / `@ag-ui/client` 依存）を把握。
2. **Google ADK ブリッジ調査**
   - [x] `ag_ui_adk`、`adk-agui-middleware` 等の導入手順・API 仕様を整理。
3. **ドキュメント整備**
   - [x] `docs/agui-adk-cli.md` を作成し、研究結果を体系化。

## ステップ2：Copilot遺産の整理
- [x] `app/`（CopilotKit テンプレ）を削除済み（2025-11-18）。
- [x] `.env` や npm 依存のうち不要なものを再確認 → 現状ルート直下には `.env` や npm プロジェクトが存在しないため整理完了。

## ステップ3：AG-UI CLI クライアント導入
1. **テンプレ生成**
   - [x] `npx create-ag-ui-app@latest` を実行し、Client Type = CLI を選択。`app/` を生成（2025-11-18）。
   - [x] `npm install --no-audit --no-fund` で依存導入。Mastra/OpenAI 依存を削除済み。
2. **初期動作確認**
   - [x] `npm run dev` で CLI が起動することを確認（AG-UI サーバー未起動時は `ECONNREFUSED`）。
   - [x] クライアントコードを `HttpAgent` ベースの薄い層にリファクタし、AG-UI サーバーへの接続のみ担うよう変更。

## ステップ4：Google ADK ミドルウェア構築（公式サンプル）
1. **一次情報の取得**
   - [x] `git clone https://github.com/ag-ui-protocol/ag-ui.git` をローカルに取得し、`integrations/adk-middleware` を参照。
   - [x] サンプル内の `python/` ディレクトリ（`USAGE.md` / `CONFIGURATION.md` 等）を確認し、必要な環境変数・依存を把握。
2. **server ディレクトリ整備**
   - [x] `/server` を作成し、公式サンプルの FastAPI コードをコピー。
   - [x] `python3.12 -m venv .venv` → `pip install .` で公式サンプルの依存を導入。
3. **環境変数 / エージェント設定**
   - [x] `server/.env` に `GOOGLE_API_KEY`（Gemini）や `AG_UI_AGENT_NAME` を設定。
   - [x] `uvicorn main:app --reload --port 8000` でサーバーを起動し、`/agui` が応答することを確認。

## ステップ5：CLI と ADK の接続テスト
1. **エンドポイント設定**
   - [x] CLI 側の `AGUIClient` をミドルウェアのエンドポイント（例：`http://localhost:8000/agui`）へ向ける。
   - [x] `RunAgentInput.agentName` / `threadId` / `tools` をミドルウェア仕様に合わせる。
2. **E2E 検証**
   - [x] CLI でユーザー入力 → ADK 応答まで一連のメッセージ（Text/ActionExecution/Result/AgentState）が流れることを確認。
   - [x] ログを `docs/agui-adk-cli.md` に追記。

## ステップ6：GUI 化の準備（GUI=唯一のフロントエンド）
- [x] CLI の現状を「ユーザー入力／agent 呼び出し／イベント表示」の観点で棚卸しし、docs に図解メモを追加。
- [x] レトロ端末＋アバター UI の必須要素（入力欄・出力欄・アバター枠・通知）を文章とワイヤで定義。
- [x] `app/src/renderer/` をルートにした Vite ベースのディレクトリ構成（`index.html` / `style.css` / `main.ts` / `subscriber.ts` / `assets/`）を決定。
- [x] `AgentSubscriber` を GUI 表示専用に再定義し、共通ロガー subscriber の配置ルールを決める（CLI 用コードは削除前提）。
- [x] `package.json` に `dev:ui` / `build:ui`（Vite）を追加する計画と Electron 取り込み手順をまとめる。
- [x] AG-UI イベント種別ごとの DOM 更新方針（ストリーミング、ツール結果、エラー、アバター制御）を表形式で整理。
- [ ] CLI → GUI の完全移行手順（CLI 削除の段取り、ブランチ戦略、切替チェックリスト）とテスト観点を整理。

## 補足メモ
- AG-UI CLI で得た `messages` フローは最終的に Web UI に移植。まずはプロトコル理解を優先し、Copilot 周りのコードは計画的に撤去する。
- Python 3.12+、Node 18+、Gemini API キーが最低限必要。
