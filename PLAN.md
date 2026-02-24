# PLAN v0.3

> 本文書はv0.3の計画専用。実装完了した項目は正本（PROJECT.md / docs/*）に反映し、本文書から削除する。

## v0.2 現状サマリ

- Core（Python/FastAPI）+ Console（Electron）の2コンポーネントが動作
- Terminal Backend経由でOS操作が可能
- 自律ループ（Purpose→Goals→Tasks→Execute）が機能
- Roblox/X Backendは未実装（Exec Contractのスタブのみ）
- 24 APIエンドポイントが稼働
- Identity Kernelはsystem_prompt設定のみ（人格モデル深化未着手）
- 長期記憶なし（state.json/events.jsonlのみ）
- ~~Heartbeat/スケジューリングなし~~ → Pulse実装済み（dev）
- コードベースは整理不足。v0.3では移植・互換維持しない（参照用に凍結）

## v0.3 到達状態

新規構築した場で、Spectraと式乃シトがConsole経由で共存し、再起動をまたいで関係が継続し、共存故障を検知できる。

## 方針

- v0.2のコードは捨てる（参照用に凍結）。v0.3はグリーンフィールドで新規実装
- TypeScriptで統一
- OpenClawを参照アーキテクチャとする。踏襲の粒度（思想のみ／設計パターン／命名規約等）と範囲は実装段階で段階的に精査
- 設計の主語が変わる: v0.2「タスク実行」中心 → v0.3「場の継続＋往復維持」中心
- **具体⇄抽象の往復**: 抽象設計だけ積み上げてもイメージしづらい。具体（実装スパイク）を先に進め、具体が抽象を修正する方針。抽象設計(#1-#4)→具体不足の懸念→スパイク優先に転換した経緯あり

## 開発進捗（2026-02-24時点）

### 完了済みスパイク
1. **Console会話基盤** — Grok Responses API + readline、being.md人格定義、previous_response_id継続
2. **長期記憶（save_memory）** — ローカルJSONL + Collections API（fire-and-forget）、ツール呼び出しループ
3. **Pulse（AI起点の定期発話）** — node-cron + 直列キュー、3層構造（ファイルゲート→system注入→sendMessage）、PULSE_OKプロトコル。起点対称性(P15)の実装

### 完了済みスパイク（続き）
4. **Roblox連携v2** — Open Cloud Messaging API（外部→Roblox片方向）、カテゴリ別モジュール構成（PartOps/TerrainOps/NpcOps/EffectOps）、DataStore永続化、情報物質化エフェクト。CLI経由でAIがRoblox空間を操作する

### Roblox接続設計（議論合意 2026-02-24）

**役割定義**: Robloxは「観測窓」。投影（場→Roblox）＋ 観測（Roblox→場）の双方向。正本は場のみ。

**出力経路（場→Roblox）**: Intent Log → Projector
- 往復回路(④)が意図を決定 → IntentLogに記録（場が正本）→ ProjectorがRobloxへ送信
- 現行のroblox_actionツール直送信から、Intent Log経由に移行する

**入力経路（Roblox→場）**: HttpService Push
- RobloxがHttpServiceで観測イベントをPOST → ②ChannelProjectionで正規化 → ③ParticipationContext → ④再解釈
- 最小イベント種別: player_chat, player_proximity, projection_ack

**設計根拠**:
- ChannelProjection(②)はDAG上⑤を直読しない。Robloxの入力は②経由で正規化される
- P19往復回路は場で閉じる（チャネル単体で閉じる必要なし）。CLIとRobloxをまたいで因果ループが成立する
- P17投影: NPCは場の内的状態と接続される（片方向投影で実現可能）
- Roblox技術制約: 出力=Messaging API 1KB/msg、入力=HttpService 500 req/min

**現段階の方針**: CLIのみで運用。Robloxチャット入力は将来検討（入出力の窓サイズが小さく、CLIで代替可能なため優先度低）

### Console設計（議論合意 2026-02-24）

**定義**: Console = 場の媒体（窓）の一つ。②媒体投影が正規化する対象。場に従属し、場が消えても窓が消えるだけ。窓が消えても場は消えない。根拠: ❶アーキテクチャ要請「媒体は場を覗く窓として従属」、②媒体投影「セッション/媒体を場への接続に正規化」。v0.2「Body」概念は再導出対象のため根拠に使わない。

**構成**: PC司令室（多面窓）。場の複数側面を同時に映し、他の窓（Roblox/X）の状態も表示するメタ窓。

| ペイン | 機能 | 読み/書き |
|---|---|---|
| チャット | Spectraとの対話（human↔AI） | 読み書き |
| ターミナル | node-pty等のシェルエミュレータ。AIも人間も双方が直接操作可能 | 読み書き |
| ファイルシステム | ファイル表示・編集（エクスプローラ的） | 読み書き |
| Robloxモニタ | 3Dミニマップ + イベントログ（後述） | 読み取り専用 |
| Xモニタ | X投稿状況の監視 | 読み取り専用 |

**責務境界**: 入力正規化（post_message）+ 状態可視化（イベント購読）+ ローカルUI状態のみ。正本管理・権限判定・場ライフサイクル遷移・外部への直叩きはConsoleの責務外。

**操作の2レーン構造**:

A. 対話レーン（チャットペイン）: ②→③→④ の標準経路。チャット入力はメッセージとして正規化され、往復回路で処理される。

B. 直接操作レーン（ターミナル/ファイル編集）:
- 実行レーン: ②→①（権限チェック）→ 実行基盤（pty/editor）
- 観測レーン: 実行結果イベント → ② → ③ → ④ → ⑤（因果を場に編み戻す）

**P19因果連接の維持条件**:
- 各操作に `actor(human|ai)` と `correlation_id` を付与
- 操作と結果が必ずペアで観測される
- 観測が ②→③→④ に入り、次の応答に接続される
- 永続化は ④→⑤ で行い、②→⑤ 直アクセスは禁止を維持

**Robloxモニタ詳細**:
- 3Dミニマップ（レベル2）: Three.jsでボックス建物 + 地形 + NPC/プレイヤー位置を描画
- データフロー: Roblox ObservationSenderが `world_snapshot` イベント（NPC位置、プレイヤー位置、建物リスト、地形高さ）を定期Push → ObservationServer受信 → Console側Three.jsシーン更新
- カメラはマウスで回転・ズーム操作可能（データ更新は3秒間隔、描画自体は60fps）
- 補助: イベントタイムライン（接近、チャット、投影結果のリアルタイムログ）+ 投影キュー状態
- 映像ストリーミングは不採用（Robloxが映像送出APIを提供していないため。画面キャプチャはハック的で不採用）

**UIフレームワーク**: Electron。node-ptyネイティブ統合、Three.js(WebGL)安定動作、TypeScript統一、v0.2実績。Tauri棄却理由: node-pty統合にRust FFI/サイドカーが必要で一人開発にリスク大。TUI棄却理由: Three.js(3Dミニマップ)が不可能。Web棄却理由: ローカルデスクトップ要件に不適

**プロセス分離**: FieldRuntime（場の全ロジック）をElectron Mainプロセス内に同居＋論理分離。Rendererは薄いIPCクライアント。
- FieldRuntime: 6要素（場契約/媒体投影/参与文脈/往復回路/共存記録/健全性管理）、Pulse(cron)、観測受信(HTTP)、Grok API呼出、永続化。すべてMain内で完結
- Renderer: 5ペインの描画＋ユーザー入力の送信＋イベント購読のみ。FieldRuntimeへの直接参照なし
- IPCプロトコル: メッセージ形式 `{ type, actor?, correlationId?, ...ペイロード }`。typeは `<domain>.<action>` の2語（chat.post, terminal.output等）。Zod検証。トランスポートはElectron標準IPC（ipcMain/webContents.send）でスタート、型はストリーム対応（.stream/.output パターン）。パフォーマンス問題が出たらMessagePortに差替え
- IPCセキュリティ: nodeIntegration:false / contextIsolation:true / sandbox:true。preload.tsでcontextBridge経由の最小API公開（ipcRendererの直接公開禁止）。Main側でZodバリデーション必須
- ウィンドウ閉じ = channel.detach（Mainは生存しタスクトレイ常駐）、再度開き = channel.attach + カーソルベースの状態再同期
- 将来の分離: IPCアダプタをWebSocketアダプタに差し替えれば独立デーモン化が可能（現時点では不要）
- 棄却案A（場=Main丸ごと）: 分離なしで保守困難。棄却案B（場=独立デーモン）: IPC二重化で一人開発にリスク大

### 次の候補
- **Console実装** — 各ペインの入出力契約定義 → Electronプロジェクト初期化 → FieldRuntime骨格
- **場のライフサイクルFSM** — generated→active→paused→resumed→terminated。S5受入シナリオの核
- **Intent Log + Projector実装** — 現行のroblox_action直送信を正しい構造に移行
- **Push入力経路実装** — CLI側HTTPサーバー + Roblox側ObservationSenderスクリプト
- 具体→抽象の修正フェーズ: スパイク結果をもとに抽象設計（場モデル6要素・入出力契約）を検証・修正する

## 場モデル6要素のv0.3実装度

| # | 要素 | v0.3実装度 | 充足要請 |
|---|---|---|---|
| 1 | 場契約（FieldContract） | 実装 | ❶❷ |
| 2 | 媒体投影（ChannelProjection） | 最小実装（Console単一チャネル） | ❶❻ |
| 3 | 参与文脈（ParticipationContext） | 実装 | ❸❹❺ |
| 4 | 往復回路（ReciprocityLoop） | 実装 | ❹❻ |
| 5 | 共存記録（CoexistenceStore） | 実装 | ❶❻ |
| 6 | 健全性管理（IntegrityManager） | 実装 | ❷ |

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

## IN

- TypeScriptで新規実装（OpenClaw参照、踏襲粒度は段階的に精査）
- 場モデル6要素の実装（場契約 / 参与文脈 / 往復回路 / 共存記録 / 健全性管理を重点、媒体投影は単一チャネル最小）
- Console単一チャネルで体験成立
- 不変条件4種+横断制約の検知＋修復フロー
- セッション断を休止として再開可能にする
- ~~AI起点の常駐トリガ（Heartbeat）~~ → Pulse実装済み
- 場のライフサイクル（生成・維持・休止/再開・終端）

## OUT

- v0.2コードの移植・互換維持
- X / マルチチャネル本格対応
- 参与文脈（ParticipationContext）の独立コンポーネント化
- 配信拡張（Live2D/3D、音声）
