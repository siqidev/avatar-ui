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
- [ ] **UIレイアウト詳細調整**: アバターエリア、全体のパディング、フォントサイズなどの微調整（要件定義中）。

## ステップ9：MCP (Model Context Protocol) 連携
**目標**: ローカルファイル操作能力を実装する。
- [ ] **MCP Client 実装 (Server)**: Python MCP SDK を導入し、MCPサーバーへの接続機能を実装。
- [ ] **Filesystem MCP 導入**: `@modelcontextprotocol/server-filesystem` を導入し、プロジェクトディレクトリへのアクセスを許可。
- [ ] **ADK ツール連携**: MCP ツールを `LlmAgent` に登録し、チャットからファイル操作ができることを確認。

## ステップ10：機能拡張（Future）
- [ ] **コマンド実行 MCP**: シェルコマンド実行能力の追加（セキュリティ考慮）。
- [ ] **マルチメディア対応**: Python コード実行によるグラフ/画像表示のサポート。
