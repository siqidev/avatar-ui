# プロジェクト計画：AG-UI CLI + Google ADK 基盤構築

## 背景 / ゴール
- 最終目的は **入力欄＋出力欄＋アバターのみのレトロ端末風チャット UI**。レンダリング層は最終的に HTML/CSS/JS など軽量構成で自由に改造できるようにする。
- CopilotKit 依存と公開ライセンスキー要件を完全に排除し、**AG-UI プロトコル + Google ADK** の公式スタックのみで構築する。
- 最小構成：AG-UI CLI クライアント（将来 GUI 化）、`ag_ui_adk` / `adk-agui-middleware` による FastAPI ブリッジ、Google ADK Agent。段階的に動作確認を積み上げる。
- **Google ADK + MCP (Model Context Protocol)** を活用し、ローカル開発者向けの強力なアシスタント機能（ファイル操作、Git操作等）を提供する。
- 設定の一元管理（JSON方式）と、拡張性の高い Game Loop 型 UI エンジンを採用し、保守性を高める。

## ステップ0：リポジトリ初期化（完了）
- [x] `/Users/u/Projects/project-m-019` を空にし、`git init` 済み。
- [x] `dev` ブランチ上で作業中。

## ステップ1：情報収集と設計方針（完了）
- [x] AG-UI CLI テンプレ調査、Google ADK ブリッジ調査、ドキュメント整備。
- [x] **MCP (Model Context Protocol)** の調査と、ADKとの連携方針の策定（Server主導型MCP連携）。

## ステップ2：Copilot遺産の整理（完了）
- [x] `app/`（CopilotKit テンプレ）削除、環境整理完了。

## ステップ3：AG-UI CLI クライアント導入（完了）
- [x] CLI テンプレ生成、初期動作確認。

## ステップ4：Google ADK ミドルウェア構築（完了）
- [x] `server` ディレクトリ整備、FastAPIコード実装、環境変数設定、動作確認。

## ステップ5：CLI と ADK の接続テスト（完了）
- [x] エンドポイント設定、E2E 検証。

## ステップ6：GUI 化（Electron移行）（完了）
- [x] `app/src/renderer/` 等のディレクトリ構成決定。
- [x] Vite/Electron 導入、GUI ファイル群実装。
- [x] CLI 痕跡の完全削除。

## ステップ7：設定基盤とUI基盤の整備（完了）
**目標**: 拡張に耐えうるクリーンなコードベース（設定一元化、UI統合）を作る。
- [x] **Phase 1-A: 設定基盤のAPI化**: ServerをSSOT化し、ClientはAPI経由で設定を取得。Fail-Fast実装。
- [x] **Phase 1-B: UIエンジンの統合**: `TerminalEngine.ts` による Game Loop 統合。
- [x] **Phase 1-C: クリーンアップ**: フォールバック排除、不要ファイル削除、パッケージング確認。

## ステップ8：UI改修 (UX Refinement)
**目標**: レトロ端末としての完成度を高め、すべてのテキスト要素を設定可能にする。
- [x] **設定拡張**: `settings.json` に `ui.nameTags` (user/assistant), `ui.systemMessages` (ready/loading) を追加。
- [x] **行間調整**: 出力エリアの行間を調整し、読みやすさと情報量を両立。
- [x] **ネームタグ実装**: 入力時の `USER>`、出力時の `AGENT` などのプレフィックスを実装（設定値使用）。
- [x] **システムメッセージ外部化**: 起動ログメッセージ等をハードコードから設定値参照に変更。
- [x] **UIレイアウト詳細調整**: アバターエリア、全体のパディング、フォントサイズなどの微調整（要件定義中）。

## ステップ9：UI調整（カラー/サイズ/エフェクト）
- [x] 配色・フォントサイズ・余白の微調整を行う（レトロ端末テーマを維持しつつ可読性を最適化）。
- [x] アバター枠に無線画面風ノイズエフェクト（CSS or 軽量Canvas）を追加し、パフォーマンス影響を検証。
- [x] 必要に応じてテーマ変数を `settings.json` または `style.css` のCSS変数に整理（最小限）。

## ステップ10：配布前コード整備（リファクタリング）（完了）
**目標**: 配布パッケージを「効率化・合理化・最小化」し、公式仕様とセキュリティ要件に沿った安定基盤を固める。  
実施結果をフェーズ別に集約。

- [x] **Phase 1: Server Side (Python/FastAPI/ADK)**
  - Pydantic設定バリデーションを導入し、必須キー・型・未使用キーを起動時 Fail-Fast。
  - `/healthz` を追加し、APIキー存在とモデル可用性チェックを実装。
  - ログ/例外ハンドラを統一、PII 保護のためボディ全量ログはデフォルトOFF（`APP_ENV=dev` 等で opt-in）。
  - セッション/HITL設定を外出し（`SESSION_TIMEOUT_SECONDS`, `CLEANUP_INTERVAL_SECONDS`）、短期記憶である旨を明記。
  - 依存肥大（GCP heavy）は課題化のみ、コード変更なし。

- [x] **Phase 2: Client Core (TypeScript/Shared)**
  - クライアント設定の取得経路を `/agui/config` に一本化。`__AGUI_BASE__` をビルド時に注入し、prod（file://）でも `127.0.0.1:8000` へ到達可能に。
  - Vite 固有の `VITE_...` 環境変数依存を排除、`.env` は開発時のみ読み込む方針に整理。
  - 不要ログは `clientLogVerbose` で制御済み。

- [x] **Phase 3: Client Renderer (UI/Engine)**
  - テーマを Classic / Cobalt / Amber の3色に統合。`settings.json` をSSOT化し、CSS変数・グロー・明るさ・アバターオーバーレイ/明度を設定駆動化。
  - アバターはモノクロ素材＋色オーバーレイに変更し、テーマ切替対応。画像パスを相対化し、prodパッケージでの 404 を解消。
  - DOM/描画ループ最適化は現行実装が十分効率的と判断しスキップ（YAGNI）。

- [x] **Phase 4: Electron Main & Packaging**
  - セキュリティ強化: `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, CSP明示（img/media/data/blob/https、connectは localhost/127.0.0.1/https/ws/wss）。
  - DevTools/警告の制御: 開発時のみ dotenv 読み込み、`APP_ENV` デフォルト prod、`ELECTRON_WARNINGS` 三段ロジック、`webPreferences.devTools` は dev のみ有効。
  - パッケージ最小化: `electron-builder.yml` を新規作成し、`dist-electron/**`・`dist/renderer/**`・`package.json` のみ同梱、mac 言語を ja/en に絞り asar 有効。
  - ビルド結果（arm64）：DMG 112MB / ZIP 113MB を確認。

## ステップ11：マルチ LLM 対応（3ベンダー + 検索サブエージェント）
**目標**: メインエージェントを GPT / Claude / Gemini で切替可能にしつつ、検索は Gemini + Google Search のサブエージェントに任せる。公式の AgentTool を用い、A2A は使わない。

### 事前調査（一次情報源確認済み）
- ADK 1.14.x に `sub_agents` / `AgentTool` が存在する（公式実装）。
- `google_search` builtin は Gemini 2 系専用（モデル: gemini-2.5-flash）。
- `PreloadMemoryTool` は LLM 非依存で自動実行される（ベンダー制限なし）。
- LiteLLM で OpenAI / Anthropic モデルを利用可能。

### マイクロタスク
- [x] 依存追加 / 環境変数拡張  
   - `server/pyproject.toml` に `litellm` を追加。  
   - `.env.example` に `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` を追記。

- [x] 設定スキーマ拡張（settings.json5）  
   - `server.model` : ベンダー込みモデルID（例: "gemini-2.5-flash" / "openai/gpt-4o" / "anthropic/claude-3-5-sonnet"）。  
   - `server.searchSubAgent.enabled` : デフォルト true。  
   - `server.searchSubAgent.model` : 固定 "gemini-2.5-flash"（検索用）。

- [x] エージェント構築ロジック実装  
   - `get_model()` で provider/model を解決（LiteLlm を使用）。  
   - `search_agent = LlmAgent(..., model=searchSubAgent.model, tools=[google_search])`。  
   - `search_tool = AgentTool(agent=search_agent)` を生成。  
   - メインエージェント: tools を `[preload_memory, search_tool]` にする（google_search を直接付けない）。

- [x] Fail-Fast / フォールバック  
   - 未設定・不正モデル時は起動時に例外を出す（安全側）。  
   - `searchSubAgent.enabled=false` の場合は `AgentTool` を付けない（検索なしで起動）。

- [x] テスト (Gemini / OpenAI / Anthropic で動作確認)  
   - Gemini: 従来通り動作し、検索が機能すること。  
   - OpenAI: `LLM_MODEL=openai/...` + OPENAI_API_KEY で会話・検索が動くこと。  
   - Anthropic: 同上。  
   - キー欠如やモデル不正時に Fail-Fast すること。

- [x] ドキュメント更新
    - メモ: Gemini / OpenAI / Anthropic + 検索サブエージェントで実働確認済み
    - 本書（plan.md）および README に 3ベンダー対応と設定手順を追記。

## ステップ12：配布パッケージ最終化（ローカル同梱型）
- [ ] Pythonサーバを各OS向けにバイナリ化（PyInstaller 等）する。
- [ ] electron-builder でサーババイナリを `extraResources` 同梱し、Electron起動時に子プロセス自動起動・終了時にkillするフローを組み込む（初回APIキー入力の導線も含める）。

## ステップ13：開発者体験の簡略化
- [ ] OS非依存で「サーバ + フロント」を一発起動できる開発スクリプトを用意する（例: Node製ラッパで venv/Scripts/bin を自動検出し、uvicorn + npm run dev を spawn）。
- [ ] Windows/Mac/Linux を平等に扱う起動手順をドキュメント化し、必要ならOS判定で実行パスを分岐。
- [ ] venv 未作成時の初回セットアップ（venv作成・依存インストール）を自動化するかどうか方針を決め、実装する場合はワンコマンド化する。
