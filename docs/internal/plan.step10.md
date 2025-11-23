# ステップ10 リファクタリング方針メモ（2025-11-22 時点）

## ゴール（ステップ10全体）
配布前にコードを「効率化・合理化・最小化」し、**サーバ・クライアント・パッケージングの全レイヤー**で公式仕様やセキュリティ要件に沿った安定基盤を整える。  
一次情報に基づく一致点と認識差分を整理し、Phase1〜4 の計画を俯瞰する。

---

## ステップ10の全体構成（phase1〜4）
- **Phase 1: Server Side (Python/FastAPI/ADK)** — *今回詳細化*  
  - 対象: `server/main.py`, `server/src/config.py`, `server/src/ag_ui_adk/`
  - 観点: 依存最小化、Fail-Fast、モデル×ツール適合法チェック、イベント互換性
- **Phase 2: Client Core (TypeScript/Shared)** — *雛形*  
  - 対象: `app/src/core/`, 共有ロジック
  - 観点: 設定/環境変数の扱い統一、ログ最小化、型安全
- **Phase 3: Client Renderer (UI/Engine)** — *雛形*  
  - 対象: `app/src/renderer/`, `TerminalEngine`
  - 観点: DOM操作最小化、描画ループ最適化、CSS変数整理
- **Phase 4: Electron Main & Packaging** — *雛形*  
  - 対象: `app/src/main/`, ビルド/配布設定
  - 観点: セキュリティ監査、ビルド最小化、不要ファイル除外

---

## Phase 1: 一致点（統合）
- 対象: `server/main.py`, `server/src/config.py`, `server/src/ag_ui_adk/`
- 目的: 依存最小化・Fail-Fast 強化・ADK 連携効率化・イベント互換性維持
- 共通認識:
  - `adk_agent.py` は多責務で分割が必要
  - 設定/環境変数のバリデーション不足 → 起動時チェックを強化
  - ログ/エラーハンドリングのばらつき → 統一が必要
  - EventTranslator のライフサイクル見直し＆16イベント契約テスト追加が必要

## Phase 1: 相違点・再調査結果（統合）
- 分割粒度: 3分割（message_router / tool_handler / execution_runner）案を有力候補として記録
- 設定・Fail-Fast: Pydantic化で起動時バリデーション（両者一致）
- ログ/エラー: 共通ハンドラ化＋リクエストボディ全量ログはデフォルトOFF（開発時のみ opt-in）
- EventTranslator: テスト追加＋ライフサイクル再設計を行う
- 依存肥大: GCP クライアント群の optional 化は Phase1 では見送り（課題として残す）
- HTTP/運用ガード: root_path / X-Forwarded-* 対応、/healthz でキー・モデル可用性チェックを追加
- モデル×ツール適合: 公式仕様は頻繁に変わるためコードで強制せず、README と settings の注記に一次情報URL付きで「推奨ペア＝Gemini 2.x + GoogleSearch」を明記（警告ログも出さない）
- セッション/HITL: InMemory のまま。再起動で pending が消えるリスクはドキュメント警告＋タイムアウト外出し。永続ストアは後続検討。
- 契約テスト: AG-UI 16イベントのスナップショット/契約テストを追加
- ログの PII リスク: デフォルトでボディ全量ログを無効化
- MCP・モデル互換性: 仕様バージョンを固定し、最新版利用は opt-in。モデルID/仕様を起動ログに出力。

## Phase 1: マイクロタスク（チェックボックス）
1. [x] **設定バリデーション強化**  
   - [x] Pydantic BaseSettings で `.env` + `settings.json` を統合ロード  
   - [x] 必須キー・型・未使用キー検出を実装  
2. [x] **モデル×ツール適合の周知（コードで強制しない）**  
   - [x] README と settings 注記に「推奨ペア＝Gemini 2.x + GoogleSearch（仕様変動あり）」と一次情報URLを記載  
   - [x] 警告ログやエラーでの強制は行わない  
3. [x] **HTTP/運用ガード**  
   - [x] `/healthz` で APIキー存在＋モデル可用性チェック  
   - [x] `root_path` / `X-Forwarded-*` はElectronローカル専用のため不要と判断し削除（CORSはlocalhost開発用のみ維持）  
4. [x] **ログ/エラー統一 & PII対策**  
   - [x] 共通例外ハンドラ・共通ログフォーマット  
   - [x] リクエストボディ全量ログをデフォルトOFF、`APP_ENV=dev` 等のフラグでONを許容  
5. [x] **EventTranslator 強化**  
   - [x] 既存の comprehensive テスト群（test_event_translator_comprehensive.py ほか）で AG-UI 16 イベントの網羅性を確認済み  
   - [x] ライフサイクルは実行ごとに新インスタンスを生成する設計を確認（追加変更なし）  
6. [ ] **`adk_agent.py` 分割**  
   - 分割は見送り（現状維持）。必要になったら再計画する。  
   - 重複処理の外出しも元に戻し、変更なしの状態にする。  
7. [x] **セッション/HITL 設定外出し**  
   - [x] タイムアウト・クリーンアップ間隔を設定値化（SESSION_TIMEOUT_SECONDS, CLEANUP_INTERVAL_SECONDS）  
   - [x] セッションは短期記憶（再起動で消える）旨を README に明記  
8. [x] **依存肥大の課題化（情報のみ）**  
   - [x] GCP heavy 依存は Phase1 では変更しない旨をドキュメントに記載  
9. [x] **server 配下の不要物を削減（計画）**  
   - [x] 実行に不要な公式サンプル由来のドキュメント・examples・生成物の削除対象を確定  
   - [x] `tests/` は回帰検証用としてリポジトリに残しつつ、配布パッケージには含めない（ビルド設定で除外）方針を記載  
   - [x] README に公式ミドルウェア最新ドキュメントのURLを明記（外部参照運用を周知）  
   - [x] 合意後に一括クリーンアップを実施し、`.gitignore` に生成物を追加  
10. [ ] **aiohttp クライアントセッション未クローズ警告の解消**  
    - [ ] 未クローズ警告の発生箇所を特定（ADK Runner か Google GenAI クライアント）  
    - [ ] セッション/コネクタを適切にクローズするパッチを検討・実装  
    - [ ] 警告がログに出ないことを確認  

## 各タスクで回す実行サイクル（再確認）
- [ ] 調査・設計：影響範囲と公式仕様を確認し、設計メモを残す  
- [ ] コメント付与（最小限）：複雑箇所の意図を短文でコード/READMEに反映  
- [ ] 根本リファクタ/実装：設計に基づき重複・冗長を除去  
- [ ] 検証・テスト：追加/既存テストを実行し、挙動が守られていることを確認  

---

## Phase 2: Client Core（雛形）
- 対象: `app/src/core/`
- 目的/観点: 設定の取得・キャッシュ・型安全化、ログ出力量の統一、共通ユーティリティのスリム化
- 既知の一致点/論点: 未整理（後続で記載）
- 相違点/要調査: 未整理（後続で記載）
- micro-task 前提: 未策定（後続で策定）

## Phase 3: Client Renderer（雛形）
- 対象: `app/src/renderer/`, `engine/TerminalEngine`
- 目的/観点: DOM 操作最小化、描画ループ効率化、CSS変数と設定値の紐付け整理
- 既知の一致点/論点: 未整理（後続で記載）
- 相違点/要調査: 未整理（後続で記載）
- micro-task 前提: 未策定（後続で策定）

## Phase 4: Electron Main & Packaging（雛形）
- 対象: `app/src/main/`, ビルド/配布設定
- 目的/観点: セキュリティフラグ（contextIsolation等）の監査、ビルド出力の最小化、配布物への不要同梱削減
- 既知の一致点/論点: 未整理（後続で記載）
- 相違点/要調査: 未整理（後続で記載）
- micro-task 前提: 未策定（後続で策定）
