# PLAN

> 本文書はavatar-uiの計画。到達状態はリリースごとに上書き（差分はCHANGELOG.mdが担う）。

## 到達状態（v0.5.1, 2026-03-31）

v0.2（Python/FastAPI）を捨て、TypeScript/Electronでグリーンフィールド新規実装。場モデル6要素を実装:

- Console会話基盤 + 6ペインUI + テーマ/i18n
- Roblox連携（双方向: 投影+観測パイプライン + cloudflaredトンネル）
- セッション永続化 + チェーン断裂自動回復
- 健全性管理（検知+通知+凍結）
- 観測パイプライン（意味論分離 + 転送ポリシー + 自己起因proximity抑制 + 共振モード）
- アバターモーション（待機モーション＋瞬き＋リップシンク）
- Discord双方向チャット（@メンション入力 + Console同期 + typing indicator）
- クロスプラットフォーム対応（Windows PowerShell + path.join + \r?\n + Cmd/Ctrl抽象化）
- OSS汎用化 + README + CHANGELOG
- テスト392件（39ファイル）

詳細はdocs/architecture.mdを参照。

## v0.5.0 — サーバー/クライアント分離（実装済み）

B-lite設計に基づき、Spectra本体をVPS上で常時稼働可能にした。GUIは「窓」としてブラウザからアクセスする。

- FieldRuntime/FSM/サービス起動をElectron非依存化（`field-orchestrator.ts`抽出、`field-runtime.ts`を`src/runtime/`に移動）
- ヘッドレスエントリーポイント（`src/headless/index.ts`）: Runtime + WS + HTTP + Discord + cloudflared を1コマンドで起動
- Console UIブラウザ配信（`console-http-server.ts`）: `out/renderer/`静的ファイルHTTP配信 + `window.fieldApi`ポリフィル注入 + CSP書換
- HTTP + WebSocket同一ポート統合（SESSION_WS_PORT）
- token認証（SESSION_WS_TOKEN）: HTTP（Cookie自動設定）+ WS共通
- WS接続先の動的ホスト解決（`location.hostname`、VPS対応）
- WS ping/pong（30秒間隔）で半開き接続を検出・切断 + クライアント自動再接続（指数バックオフ3s→60s）
- 承認ハブ（`approval-hub.ts`）: Console・Discord両方から承認可能（first-response-wins）
- Discord窓口（`discord-bridge.ts`）: stream購読 + 承認応答
- Pulse/XPulseのhuman側stream.item削除（AI応答のみ表示）
- ソースタグ（[pulse]/[roblox]等）のDEV_MODE限定表示
- spectra>ラベルの色変更（グレー→エメラルドグリーン）
- polyfillのCache-Control: no-cache + キャッシュバスター（Cloudflare CDN対策）
- PULSE_CRONデフォルトを1日1回（`0 6 * * *` = JST 15:00）に変更
- `npm start` = build + headless起動（VPS/ローカル共通）
- テスト390件（39ファイル）

## X チャネル統合（v0.5.0に統合済み）

X（Twitter）をチャネルとして統合。Phase 1（x_post + Webhook受信 + Xペイン表示）実装完了。

- ChannelId SSOT化（`"console" | "roblox" | "x"`、入力パイプライン全層に貫通）
- InputGate二重防御（source+channel+roleベースのツール権限制御）
- x_postツール（280文字制限、OAuth 1.0a HMAC-SHA1署名）
- x_replyツール（X連携有効時に利用可能、TOOL_AUTO_APPROVEで自動実行制御）
- Account Activity API Webhookサーバー（CRC + HMAC-SHA256署名検証 + 自己投稿フィルタ + 重複排除）
- 7ペインUI（全ペインD&D入替対応、Xペイン一級市民化、列構造2/3/2固定）
- Monitor履歴永続化（Roblox/X Monitorの観測ログをstate.jsonに保存、再起動後復元）
- テスト313件（33ファイル）

**Phase 2（x_reply）: API規制により設計前提変更**

2026年2月23-24日、X APIの自動リプライ規制が施行された（LLMスパム対策）。

- **新ルール**: APIリプライは「元投稿者がボットを@メンションした場合」または「元投稿者がボットの投稿をQuoteした場合」のみ許可。それ以外は技術的にブロック
- **対象ティア**: Free / Basic / Pro / Pay-per-Use。Enterpriseプラン（月額$42,000〜）のみ例外で従来通り無制限
- **x_postへの影響**: なし。オリジナル投稿・Quote自体は制限なし
- **ポリシー要件**: AIリプライボットはX Developer Portalで事前書面承認が必要。opt-out機能必須。無差別リプは明確に禁止
- **違反時**: ポスト検索除外、アカウント/アプリ凍結、APIアクセス停止
- **公式ソース**: https://devcommunity.x.com/t/x-api-v2-update-addressing-llm-generated-spam/257909
- **ポリシー**: https://help.x.com/en/rules-and-policies/x-automation

現行実装への影響:
- x_replyはX連携有効時に利用可能。TOOL_AUTO_APPROVEにx_replyを含めると自動実行、含めなければユーザー承認を挟む
- メンション/Quoteトリガーのリプライは規制対象外（召喚応答型）
- 運用方針: オリジナル投稿（x_post）中心 + メンション来訪時のみリプライ

**未解決: Webhookイベント未着**
- 状態: Webhook登録済み（valid:true）、サブスクリプション有効（subscribed:true）、CRC検証成功、エンドポイント到達可能。しかしXからPOSTイベントが一切配信されない
- 検証済み（2026-03-18）:
  - curlでGETリクエスト → `[X_WEBHOOK] リクエスト受信: GET /x/webhook` がログに出る → **インフラ（cloudflared→localhost:3001）は正常**
  - sito(@Sikino_Sito)からSpectra(@SCUN7X)のポストにリプライ → POSTイベント未着
  - sito(@Sikino_Sito)から@SCUN7Xに直接メンション → POSTイベント未着
  - 自己投稿フィルタは無関係（X_USER_ID=SpectraのID、リプライ者=sitoのID → フィルタ対象外）
- **根本原因（2026-03-18解決）: App permissionsにDM権限がなかった**
  - App permissionsが「読み書き」のみ → Webhook登録・CRC・購読は全て成功するが、**イベント配信が行われない**
  - 「読み書きおよびダイレクトメッセージ」に変更 + アクセストークン再生成 + 再購読で解決
  - 教訓: Account Activity APIはDM権限必須。権限変更後は既存トークンに反映されないため再生成が必要
- Webhook ID: 2034089116300939265、URL: https://x.siqi.jp/x/webhook

**技術仕様:** siqi/knowledge/tech/x-api.md

## 実装バックログ

バージョン割り当ては未定。タグで分類し、優先度は実運用で判断する。

### 拡張（到達状態は満たすが品質・体験を向上）

- **自発行動ロジック** — 共振・蓄積情報・文脈からアバターが自発的に行動する仕組み。時計駆動ではなく、蓄積状態が発火トリガーとなる。全チャネル横断の設計変更。定期実行（Pulse）とは独立した機構
- **定期実行の拡張** — 時計駆動に適したタスク（日報、タスク管理、定期メンテナンス等）の実行基盤
  - **Pulse複数化** — 用途別に複数のPulseインスタンスを持つ（例: X投稿用、タスク管理用）
  - **スクリプト実行** — Pulse以外の定期実行手段（外部スクリプト、cron連携等）の検討
- ~~**Canvas双方向編集**~~ — 実装済み（CodeMirror 6エディタ、Cmd+S保存、ファイル切り替え状態保持、未保存マーカー）
- ~~**SpaceペインD&D**~~ — 実装済み（ツリー内移動+Finder外部インポート、VSCode準拠のドロップ先解決・ハイライト、webUtils.getPathForFile経由）
- ~~**Terminal PTY昇格**~~ — 実装済み（node-pty持続PTY、AIと人間が共有、OSCマーカーによるAIコマンド完了検知）
- **Console用3Dマップ** — Roblox空間のリアルタイム可視化（Three.js）
- **Roblox TypeScript整理** — catalog/schema/eventsの分離（肥大化防止）
- **参与文脈の完全独立コンポーネント化** — 最小実装から完全版へ
- **建築品質の根本改善** — プリファブ方式導入（Part単位→機能付きModel）、BuildOps内でPart/Prefab振り分け
- **場モデル要素の網羅的検証** — ギャップセクションの項目を含む、帰納的検証の完全版
- **初期セットアップ簡易化** — 誰でも簡単に導入・使用できるオンボーディング。初回起動ウィザード、.env自動生成、必須/オプション設定のガイド付きフロー等
- **Classic テーマ: 罫線タイトル埋め込み** — ヘッダーのタイトルをペインの上辺罫線に埋め込む表示（fieldset/legend風）。レイアウトをModernと同一に保つ制約あり（`overflow: hidden` 等）
- **Classic テーマ: 色の意味限定使用** — 装飾的な色分けを排除し、色は「データの意味」にだけ使う設計原則をClassicで徹底。有効であればModernにも拡張
- ~~**サーバー/クライアント分離（常時起動）**~~ — 実装済み（v0.5.0）。B-lite設計: ヘッドレスサーバー + Console UIブラウザ配信 + Discord窓口 + 承認ハブ
  - ~~**設計方針（B-lite）**~~ — 全イベント再設計はせず、最小共通データ形式だけ定義。共通化は「Console・Discordが共有するStream+承認」に絞った
  - ~~**構造変更**~~: `src/runtime/`新設、`src/discord/`新設、`field-runtime.ts`移動済み
  - ~~**Step 1: 承認の独立化**~~ — 実装済み（`approval-hub.ts`、first-response-wins）
  - ~~**Step 3: ヘッドレスサーバー**~~ — 実装済み（`headless/index.ts` + `field-orchestrator.ts` + `session-ws-server.ts`）。当初計画の`session-registry.ts`/`ws-gateway.ts`/`src/server/`は不要と判断し、既存モジュールの組み合わせで実現
  - ~~**Step 4: Console（GUI）のクライアント化**~~ — 実装済み（`console-http-server.ts`でブラウザ配信。ポリフィルでElectron preload代替）。Space/Canvas/TerminalのVPS対応は後回し
  - ~~**Step 5: Discord窓口**~~ — 実装済み（`discord-bridge.ts`）
  - **Roblox接続** — Roblox Studio/Clientはローカル（Mac）でのみ動作。VPS上のSpectra本体とはcloudflaredトンネル経由で接続。通信方式は現行HTTP POSTを維持
- **ツール呼び出し承認UI拡張** — タスクバー通知・通知音（承認リクエスト時にユーザーが気づけるように）
- **共振機構（場レベル）** — 共振は媒体（Console/Roblox等）ではなく場レベルの機構。構成: 知覚（観測収集）→注意（AI転送）→表出（非命令的応答生成）の3段チェーン。制御: `RESONANCE_MODE=on/off`（.env、デフォルト: off）。offで注意+表出を停止、知覚は常時ON。設計原則: 場が蛇口を設計し、ユーザーが開閉を制御する。各媒体は知覚（観測データ）を場に提供し、場が注意・表出を統合制御する
  - ~~**RESONANCE_MODE実装**~~ — 実装済み（settings-store.tsの共振チェックボックス + field-runtime.tsの共振ゲート）。.env側は設定の2層分離で除去
  - **proximity観測のLLM応答廃止** — player_proximityは「近づいた」事実であり会話の開始ではない。LLM呼び出し不要（応答生成しない）。ただし文脈への記録は維持する（後続のplayer_chatでAIが「さっき近づいてきた人だ」と認識できるように）。現状はproximityでもLLMを呼んで応答を生成しており、「記録するが応答しない」経路が未実装
  - ~~**観測応答のStream/Discord抑制**~~ — 実装済み。source=observationのstream.itemをDiscord bridgeとConsole UI stream paneでフィルタ。monitor pane + Roblox sayのみに表示
  - **Roblox観測要素の拡充** — 上位原理（P9器, P12/P13律動, P17同調関係, P5判断なき観照）から演繹した観測データの充実化。必須要素: ①参与者アンカー（who/when/session）②相対位置関係（距離/方位/視界/遮蔽）③相対変化量（距離変化速度/向き変化/停止↔移動）④身体活動相（Humanoid state: 走行/着座/ジャンプ/落下等）⑤注視の代理証拠（身体向き↔対象方位の差/向き続けた時間）⑥滞在・周期・反復（近距離滞在秒数/出入り回数/往復周期）⑦共有対象アンカー（人間↔AI↔環境の三項関係）⑧AI側の同型観測（上記をAI側にも同じ語彙で保持）。拡張要素: アニメーション状態、カメラ方向（クライアント実装必要）、ヘルス/被弾、経路制約。送り方は3種: 瞬間イベント（閾値越え時）+ 窓サマリ（3-5秒周期）+ 関係スナップショット（変化時）
- ~~**Avatar Space構造設計（refs/方式）**~~ — 実装済み。avatar-space直下はrw（アバターの自由活動領域）、`refs/`ディレクトリ配下はro（参照専用）。アプリ層（filesystem-service.ts）で`refs/`への書き込みを拒否。OS側のbind mount/権限に依存しない
  - **`refs/<name>/`**: ユーザーがシンボリックリンクで配置（`ln -s /path/to/repo refs/name`）。refs/の中身がそのまま参照一覧。アプリはrefs/ディレクトリの作成のみ行い、中身はユーザー管理
  - ~~**XPulse素材宣言方式**~~: 実装済み。XPULSE.mdの「# 素材ファイル」セクションにパスを列挙 → コードが事前読み取りしてプロンプトに注入。AIはx_postのみ使用（1ラウンド）。旧collectXpulseMaterial()ハードコードを解消
  - **自己拡張パス**: 将来AIが自身のコードを拡張する段階では、`refs/self/`のro制約をrwに昇格するだけで移行可能。space全体の構造変更は不要。拡張範囲（rw対象）を段階的に広げられる設計
- **ファイル操作サンドボックス** — Dockerコンテナ隔離によるTOCTOU脆弱性の根本排除
- **デスクトップアプリ パッケージ化** — electron-builder等で.appビルド（macOSメニューバー名「AUI」表示、アプリアイコン設定、productName反映）。dev時はElectronバイナリ直接使用のためメニューバー名変更不可
- ~~**クロスプラットフォーム対応**~~ — 実装済み（v0.5.1）。Windows PowerShellシェル統合、path.join()明示化、\r?\n統一、modKey()でCmd/Ctrl抽象化（VSCode準拠）。残: Electronメニューロール（macOS専用、他OSでは無視されるため実害なし）

### ギャップ（帰納的検証で発見、将来の検討材料）

①②④の帰納的検証（PROJECT.md定義 vs 実装）で発見したギャップ。v0.3到達状態には不要だが、将来の拡張で必要になる可能性がある。

#### ①場契約
- **権限ルールの実装** — PROJECT.mdで定義されたeffect: allow/denyの判定ロジック。現在はFSM遷移のみで権限判定なし。マルチユーザー/マルチチャネル時に必要
- **規約の動的管理** — 場の規約（boundary/rules）の実行時変更・検証。現在は静的

#### ②媒体投影
- ~~**InputGate（ロールベースツール権限制御）**~~ — 実装済み（v0.5.0）。source+channel+roleベースの二重防御。オーナー→全ツール、外部ユーザー→同一媒体応答ツールのみ（ハードコード）
- **入力パイプラインの明示化** — user/pulse/observationの3入力経路が暗黙的。入力の正規化・バリデーション・ルーティングを明示的なパイプラインとして定義
- **チャネル抽象化** — Console以外の媒体（X, Live2D等）追加時に必要なチャネルインターフェース。出力側のChannelProjection interface拡張

#### ④往復回路
- **中断/割り込みの明示的処理** — S3（往復連接性）の「人間が中断・割り込み・無視」ケースの構造的な処理。現在はenqueueの直列化に暗黙依存
- **優先度制御** — 入力の優先度付け（例: ユーザー入力 > 観測 > Pulse）。現在はFIFO
- **再解釈レイヤー** — AI応答のパース・振り分け（テキスト応答 vs ツール呼び出し vs 場制御）。現在はchat-session-serviceに一体化

### セキュリティ（v0.3.0はプライベートサーバー前提、公開サーバー対応は将来）

v0.3.0実装済みの対策はdocs/architecture.mdを参照。公開サーバー対応時に必要な追加対策:

| リスク | 深刻度（公開時） | 対策候補 |
|--------|----------------|---------|
| Roblox観測経由のプロンプトインジェクション | 高 | 観測入力のサニタイズ（ツール承認フローは実装済み） |
| TOCTOU（パス検証→ファイル操作の間隔） | 低〜中 | ファイル操作のコンテナ隔離（Docker） |

### 構想（設計・調査が未着手）

- 配信拡張（Live2D/3D、音声）

## 設計参照

v0.3.0で確立した設計。実装の正本はarchitecture.md、概念の正本はPROJECT.md。

### 場モデル6要素の実装度（v0.5.0時点）

| # | 要素 | 実装度 | 残ギャップ |
|---|---|---|---|
| 1 | 場契約（FieldContract） | 実装（FSM遷移+永続化） | 権限判定・規約動的管理 |
| 2 | 媒体投影（ChannelProjection） | 4チャネル（Console+Roblox+X+Discord）+ InputGate | 入力パイプライン明示化→チャネル抽象化 |
| 3 | 参与文脈（ParticipationContext） | 実装 | — |
| 4 | 往復回路（ReciprocityLoop） | 実装（enqueue直列化+チェーン回復） | 中断処理→優先度→再解釈 |
| 5 | 共存記録（CoexistenceStore） | 実装（会話+Monitor履歴永続化） | — |
| 6 | 健全性管理（IntegrityManager） | 実装（検知+通知+凍結） | — |

### 受入シナリオ（S1-S5）

テスト実装済み（36件）。シナリオ定義とテストコードはsrc/main/acceptance/を参照。

### 6要素の入出力契約

設計方針: 場の安全を壊し得る判定は同期ゲート、状態の観測・健全性評価はイベント集約。

#### 操作の所有

| 要素 | 所有操作 |
|---|---|
| ①場契約 | pause_field, resume_field, terminate_field |
| ②媒体投影 | post_message（入口正規化） |
| ③参与文脈 | set_intent |
| ④往復回路 | propose_action, execute_action |
| ⑤共存記録 | read_store, write_store |
| ⑥健全性管理 | なし（内部制御のみ） |

#### 要素間依存（DAG: ⑤→①→②→③→④→⑥）

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

#### RuntimeCoordinator

⑥健全性管理は他要素を直接操作しない。復旧実行はRuntimeCoordinator経由で操作を発行し、依存逆流を防ぐ。

#### 禁止する依存

- ②→⑤ 直アクセス（媒体が記録を直接読まない）
- ④→② 逆参照（往復回路が表示方法を知らない）
- ①→③ 直接参照（場契約が参与文脈に依存しない）
- ⑤→各ドメイン要素 コールバック（共存記録は受動的）
- ⑥→各要素 直接ミューテーション（Coordinator経由のみ）
