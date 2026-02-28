# PLAN v0.3

> 本文書はv0.3の計画専用。実装完了した項目は正本（PROJECT.md / docs/*）に反映し、本文書から削除する。

## v0.2 現状サマリ

- Core（Python/FastAPI）+ Console（Electron）の2コンポーネントが動作
- Terminal Backend経由でOS操作が可能
- 自律ループ（Purpose→Goals→Tasks→Execute）が機能
- Roblox/X Backendは未実装（Exec Contractのスタブのみ）
- コードベースは整理不足。v0.3では移植・互換維持しない（参照用に凍結）

## v0.3 到達状態

新規構築した場で、Spectraと式乃シトがConsole経由で共存し、再起動をまたいで関係が継続し、共存故障を検知できる。

## 方針

- v0.2のコードは捨てる（参照用に凍結）。v0.3はグリーンフィールドで新規実装
- TypeScriptで統一
- OpenClawを参照アーキテクチャとする。踏襲の粒度は実装段階で段階的に精査
- 設計の主語: v0.2「タスク実行」中心 → v0.3「場の継続＋往復維持」中心
- **具体⇄抽象の往復**: 具体（実装スパイク）を先に進め、具体が抽象を修正する

## 開発進捗

### 完了済み（詳細はdocs/architecture.md）

- Console会話基盤（Grok Responses API + readline）
- 長期記憶（save_memory: ローカルJSONL + Collections API）
- Pulse（AI起点の定期発話: node-cron + PULSE_OKプロトコル）
- Roblox連携v2（双方向: 投影+観測パイプライン + cloudflaredトンネル）
- Console UI（Electron + electron-vite + 3列6ペイン + TUI-in-GUIデザイン）
- 全ペイン実装（Avatar/Space/Canvas/Stream/Terminal/Roblox Monitor）
- Roblox空間改善（制約ベース設計 + 14 Luauモジュール + SpatialService）
- ③参与文脈の最小実装（ParticipationInput型 + 場状態ゲート + correlationId貫通）
- 設定管理一元化（.env + getConfig()遅延singleton + ensureDirectories）
- ⑤共存記録: v0.3充足（previous_response_id + save_memory + intents.jsonl）

## 実装バックログ

バージョン割り当ては未定。タグで分類し、優先度は実運用で判断する。

### 必須（v0.3到達状態に必要）

- **⑥健全性管理の実装** — 最大ギャップ。共存故障を検知できる状態にする
- **残り要素（①②④）の帰納的検証** — 実装中に不足を発見→都度修正
- **受入シナリオのテスト実装** — S1-S5をコードで検証
- **不変条件の検知＋修復フロー** — 4条件+横断制約
- **セッション断を休止として再開可能にする** — 場のライフサイクル完走

### 拡張（到達状態は満たすが品質・体験を向上）

- **Canvas双方向編集** — 読み取り専用→読み書き対応（AIコーディング+人間編集）
- **SpaceペインD&D** — ファイル/フォルダのドラッグ&ドロップ移動
- **Terminal PTY昇格** — child_process.spawn→@lydell/node-pty（フルTUI対応）
- **Console用3Dマップ** — Roblox空間のリアルタイム可視化（Three.js）
- **Roblox TypeScript整理** — catalog/schema/eventsの分離（肥大化防止）
- **参与文脈の完全独立コンポーネント化** — 最小実装から完全版へ
- **場モデル要素（①②④）の網羅的検証** — 帰納的検証の仕上げ
- **建築品質の根本改善** — プリファブ方式導入（Part単位→機能付きModel）、BuildOps内でPart/Prefab振り分け

### 構想（設計・調査が未着手）

- X / マルチチャネル本格対応
- 配信拡張（Live2D/3D、音声）
- v0.2コードの移植・互換維持

## 場モデル6要素のv0.3実装度

| # | 要素 | v0.3実装度 | 充足要請 |
|---|---|---|---|
| 1 | 場契約（FieldContract） | 実装 | ❶❷ |
| 2 | 媒体投影（ChannelProjection） | 最小実装（Console単一チャネル） | ❶❻ |
| 3 | 参与文脈（ParticipationContext） | 実装 | ❸❹❺ |
| 4 | 往復回路（ReciprocityLoop） | 実装 | ❹❻ |
| 5 | 共存記録（CoexistenceStore） | v0.3充足（previous_response_id + save_memory + intents.jsonl） | ❶❻ |
| 6 | 健全性管理（IntegrityManager） | 未実装 | ❷ |

## 不変条件のv0.3検証

| 不変条件 | 一次検知 | v0.3で検証する |
|---|---|---|
| 場契約整合性 | ①場契約 | Yes |
| モード可達性 | ③参与文脈 | Yes |
| 往復連接性 | ④往復回路 | Yes |
| 共存連続性 | ⑤共存記録 | Yes |
| 横断: 起点対称性 | 全要素 | Yes（human起点/ai起点の両シナリオ） |

## 受入シナリオ

各シナリオはhuman起点/ai起点の両方でテストする（横断制約: 起点対称性）。

### S1: 場契約整合性
- **Given** 新規の場が生成済み
- **When** 起点側が干渉を開始し、境界/権限に関わる操作を含む往復を行う
- **Then** 場ID・境界・権限・存続状態が一貫し、違反は場契約が検知→健全性管理が自動復旧 or 修復委譲に遷移

### S2: モード可達性
- **Given** 場がactive、参与文脈が入力・注意・同調状態を保持
- **When** 起点側の働きかけと応答を繰り返し、フィードバックで行動変化を起こす
- **Then** 共在→共振→干渉→共創の各モードに可達であることを観測語彙で判定でき、不可達は参与文脈が検知→修復フロー

### S3: 往復連接性
- **Given** 場がactive、サイクルが進行中
- **When** 人間が中断・割り込み・無視し、その後再入力（AIはHeartbeat継続）
- **Then** 因果連鎖は断線せず、中断は新規因果入力として処理。往復回路が連接維持を確認

### S4: 共存連続性
- **Given** 場に記憶・関係・履歴が蓄積済み
- **When** プロセス再起動でpaused→resumedをまたいで同一場を再開
- **Then** 共存記録が同一場として復元、関係と履歴を引き継いだ応答。断裂時は復旧/修復フロー

### S5: ライフサイクル完走
- **Given** 場を生成し、維持運転後に休止/再開を1回実施
- **When** 終端要求を発行し場をterminatedに遷移
- **Then** 生成→維持→休止/再開→終端の遷移が記録され、終端後は旧場で往復再開できず新規生成のみ許可

## 6要素の入出力契約

設計方針: 場の安全を壊し得る判定は同期ゲート、状態の観測・健全性評価はイベント集約。

### 操作の所有

| 要素 | 所有操作 |
|---|---|
| ①場契約 | pause_field, resume_field, terminate_field |
| ②媒体投影 | post_message（入口正規化） |
| ③参与文脈 | set_intent |
| ④往復回路 | propose_action, execute_action |
| ⑤共存記録 | read_store, write_store |
| ⑥健全性管理 | なし（内部制御のみ） |

### 要素間依存（DAG: ⑤→①→②→③→④→⑥）

同期呼び出し（不変条件を守るためのゲート）:
- ②→①: 接続可否・越境判定
- ③→①: 場の状態・制約照会
- ③→⑤: 近傍文脈の読取
- ④→①: 提案/実行の権限照会
- ④→⑤: loop進行の読書込
- ①→⑤: 契約スナップショット永続化
- ⑥→⑤: 証跡読取

非同期イベント（観測・通知・集計）:
- ①⇒⑥: 契約違反/遷移通知
- ②⇒③: 参与入力の受け渡し
- ③⇒④: 意図確定/文脈更新
- ③⇒⑥: モード可達性リスク
- ④⇒⑥: 孤児loop/時間超過
- ⑤⇒⑥: rev欠番/hash不一致

### RuntimeCoordinator

⑥健全性管理は他要素を直接操作しない。復旧実行はRuntimeCoordinator経由で操作を発行し、依存逆流を防ぐ。

### v0.3で禁止する依存

- ②→⑤ 直アクセス（媒体が記録を直接読まない）
- ④→② 逆参照（往復回路が表示方法を知らない）
- ①→③ 直接参照（場契約が参与文脈に依存しない）
- ⑤→各ドメイン要素 コールバック（共存記録は受動的）
- ⑥→各要素 直接ミューテーション（Coordinator経由のみ）

## リリース前作業

v0.3到達状態の検証完了後、main mergeの前に実施する。

### README.md
- v0.2 README.mdの基礎構成（Features → Quick Start → 環境変数テーブル）を踏襲
- setup CLIは導入しないため、以下を丁寧にガイドする:
  - 初回導線: clone → .env設定 → npm install → 起動
  - 段階的セットアップ: XAI_API_KEYだけで最小起動 → Roblox連携の後追い有効化
  - Robloxスクリプトの配置手順（roblox/ディレクトリからStudioへの手動コピー）
- v0.3固有の説明: Console UI（3列6ペイン）、CLI/Electron両対応、Avatar Space
- 日本語版（README.ja.md）も同時作成

### その他
- CHANGELOG.md（v0.2→v0.3の変更点）
- LICENSE確認（MIT、変更なし）
- GitHub Releases / タグ作成

