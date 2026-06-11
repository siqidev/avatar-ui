# 完全リファクタリング計画（フェーズ分割）

> 策定: 2026-06-12。根拠: 8次元マルチエージェント監査（91エージェント、全129ファイル走査 + 所見ごとの懐疑的反証検証 + 完全性監査）で確定した79所見。Codex 設計審査（2026-06-12、条件付き承認 → 全条件反映済み）。
> 本文書はリファクタリング実行の正本。各フェーズの完了時に「完了」マークと実測値を追記し、全フェーズ完了後は到達状態を PLAN.md / CHANGELOG.md に還元して本文書を削除する（恒久文書ではない）。
> γ軸の設計正本は PLAN.md「γ軸リファクタ」節 + siqi 側 Decision Log（2026-04-23）。本文書はそれを複製しない。

## 現状ベースライン（2026-06-12 計測）

- TypeScript 約11,700行（src/、テスト除く実装系）+ テスト約6,100行。129ソースファイル
- テスト: 40ファイル427件。全緑（PTY 6件はサンドボックス環境のみ失敗 → Phase 0 で根治）
- 実効ラインカバレッジ約38%（表示上61.7%は母数がテスト到達ファイル限定のため過大。src の38%・約4,500行がテストから一度もimportされない）
- コピペ重複: jscpd 検出17クローン・196行 + 構造的並行実装（field-runtime観測ハンドラ2系統、WSクライアント3系統 等）
- 品質基準超過: 800行超ファイル2本（renderer/main.ts 1001行、filesystem-pane.ts 982行）、50行超関数27本
- IPC→WS移行（v0.5.0）の残骸が最大の無駄クラスタ: 本番参照ゼロのファイル・スキーマ・IPCチェーン・テストが合計約700行
- **セキュリティ問題1件**: Electron モードで WS 経由入力の channel/inputRole が切り捨てられ外部ユーザーが owner 既定で処理される経路（Phase 0 で修正）

## 計画の原則

1. **挙動不変が既定**。リファクタリング＝外部から見た振る舞いを変えない削除・統合・分割。挙動が変わる項目（セキュリティ修正・表示バグ修正・バックオフ統一）は**必ず独立コミット**とし、本文書で「挙動変更」と明示する
2. **順序の根拠**: 足場 → 事実同期 → 削除 → SSOT統合 → 重複統合 → 安全網 → 構造 → 通信。リスクの低い順・後工程の前提になる順。削除を統合より先に行うのは、死んだコードを統合対象に含めないため
3. **各コミットは git-workflow 準拠**: 実装 → テスト全緑 → tsc --noEmit → 動作確認 → 関連ドキュメント同一コミット更新 → コミット
4. **フェーズは直列**。フェーズ完了ごとにユーザー確認を挟む（段階的進行）。フェーズ内は原則1所見グループ＝1コミット
5. **γ軸ゲート**: Phase 9 は α（場の状態正本）・β（副作用冪等性境界）の議論決着まで着手しない。**前倒し条項はない**。例外を作る場合は先に Decision Log と PLAN.md を正式更新する（本計画内の判断では覆せない）。Phase 0〜8 の完了をもって「リファクタ本体完了」とし、Phase 9 は「設計待ち」として独立に扱う
6. ブランチは dev。リリース割当（v0.5.3 / v0.6.0 等）は変更規模で決める（既存規約どおり）
7. 削減行数は**観測値であって目標ではない**。行数達成を理由に設計品質を妥協しない

## フェーズ俯瞰

```
Phase 0 ベースライン確立 + セキュリティ修正（独立コミット）
   ↓
Phase 1 ドキュメント正本の事実同期（コード変更なし）
   ↓
Phase 2 死コード・移行残骸の一掃（挙動不変・約700行削減）
   ↓
Phase 3 型・スキーマの SSOT 統合 + wire union 定義（約400行削減）
   ↓
Phase 4 局所重複の統合（実装系、約300行削減）
   ↓
Phase 5 安全網テストの整備（Phase 6 の前提条件・characterization）
   ↓
Phase 6 構造リファクタ（レジストリ化・依存逆転・パイプライン統合・分割）
   ↓
Phase 7 テスト基盤整理とカバレッジ最終ゲート（全体80%）
   ↓
Phase 8 通信クライアント統合 8A共通化 → 8B multiplex → 8C バックオフ統一
   ═══ ここまでで「リファクタ本体完了」═══
Phase 9 γ軸リファクタ 【ゲート: α/β議論決着。設計待ち】
```

---

## Phase 0 — ベースライン確立 + セキュリティ修正

目的: 以降の全フェーズの検証手段（テスト・カバレッジ・依存）を信頼できる状態にし、監査で発見されたセキュリティ問題を先行修正する。

### 0-1. セキュリティ修正（挙動変更・独立コミット・最優先）

**handleStreamPost の引数切り捨てによる権限昇格経路の遮断**。

- 事実: Electron モードでは ipc-handlers.ts:36-38 の3引数ラッパーが onStreamPost として session-ws-server に渡るため、WS 経由入力（Discord 等）の channel / inputRole が切り捨てられ、field-orchestrator.ts:169 の既定値（channel="console", inputRole="owner"）に強制される。Discord 外部ユーザーが全ツール権限を得る経路が成立している。ヘッドレスモードは orchestrator 版を直接渡すため正常
- 修正: ラッパーを6引数対応にする、または orchestrator 実装を直接渡す（fail-closed 正常化）
- 検証: `stream.post(channel="discord", inputRole="external")` が Electron / headless 双方で同じ引数のまま processStream に渡ることを確認する**モード間パリティ統合テスト**を同一コミットで追加
- 注: 「Electron はローカル前提」という割り切りは Discord 入口の存在と両立しないため不採用（Codex 審査結論）

### 0-2. ベースライン整備

- **node-pty spawn-helper の実行ビット保証**: postinstall を **Node スクリプト**（scripts/postinstall.cjs 等）で実装。`process.platform !== "win32"` の場合のみ `node_modules/node-pty/prebuilds/*/spawn-helper` を列挙して `chmod(0o755)`。ファイル不存在は黙ってスキップ（prebuild 構成変更に耐える）。シェル式ワンライナーは Windows を壊すため不可。テスト自体は改変しない（実 PTY 依存はネイティブモジュール破損の回帰検知として価値があるため維持）
- **カバレッジ計測の正常化**: vitest.config.ts に `coverage.include: ["src/**/*.ts"]` を設定し全 src を母数化。`"test:coverage": "vitest run --coverage"` script を追加（@vitest/coverage-v8 の削除は不可: /test-coverage・/verify ワークフローが依存）
- **overrides の整理**: picomatch override は削除（全要求元が ^4.0.2 以上で自然解決）。undici override は**削除不可**（discord.js が 6.21.3 を exact pin しており、削除すると high 重大度 CVE 再導入）— `">=6.24.1"` → `"^6.24.1"` に変更し 6.x メジャー内でセキュリティ下限を維持
- **依存分類の修正**: tsx を dependencies へ移動（本番ヘッドレスの実行ランタイム）。@types/node-cron を削除（node-cron v4 が型同梱、traceResolution で確認済み）

完了条件（実行コマンドと期待値）:
- `npx vitest run` → 40ファイル全緑（サンドボックス環境でも PTY 6件含め緑）
- `npx tsc --noEmit` → エラー0
- `npm ls undici picomatch` → undici ^6.24.1 解決・picomatch override 非適用
- モード間パリティテストが存在し緑
- `npx vitest run --coverage` → 全 src 母数の実効カバレッジ確定値を本節に追記

## Phase 1 — ドキュメント正本の事実同期

目的: 以降の全コード変更が「architecture.md 同一コミット更新」を要求するため、先に正本を実コードと一致させる。コード変更なし。Phase 0 完了後に着手（壊れたベースラインと文書同期を並行させない）。

- **architecture.md**: ファイル構成リストに実在9ファイル追記 / 「7ツール」→「10ツール」（:360）/ roblox_action のパス（:370 → tools/roblox-action-tool.ts）とカテゴリ数（:497 → display 含む8カテゴリ）を統一 / idle 画像記述を実体（アセット3枚 + main.ts:283-286 の 01〜09 プローブ）に修正 / 版表記を現行に更新
- **環境変数一覧の SSOT 再構成**: architecture.md の env 表を削除し「正本は config.ts、利用者向け一覧は README」と参照1行に置換（4面重複 → 3面）。前提として README 表に欠落2キー（AVATAR_DIR、SELF_ANALYSIS_JOURNAL_FILE）を補完してから行う
- **テスト件数記載の SSOT 化**: 件数の正本を CHANGELOG のリリース時スナップショットのみに統合し、architecture.md / PLAN.md（:18, :41, :55）から重複記載を削除
- **docs/PROJECT.md への参照5箇所**: siqi/knowledge/tech/avatar-ui-project.md への参照に書き換え（歴史的記述 PLAN.md:137,140 は来歴つき表記。OSS 公開上 siqi パスを出せない箇所は「外部管理」と注記）
- **api.md の v0.5.2 追従**: ToolName に x_quote_repost 追加 / fs.request/fs.response エンベロープ節 / GET /observation/display-state / /static/* 表記を実配信規約に修正
- **CLAUDE.md**: 「現在の状況」をバージョン非依存の記述（git tag / CHANGELOG 参照）に変え陳腐化の構造自体を除去 / siqi 側絶対パス4件を相対パス（../../core/ 等）に統一
- **PLAN.md の完了記録整理（約130行）**: v0.5.0/v0.5.2 節と解決済みトラブルシュートを削除。(a) X チャネル統合節の削除根拠は architecture.md のカバー（CHANGELOG に記載なし）であることを確認しながら行う (b) :214-224 の生きたバックログ（bundle分離 / WS multiplex / 再接続共通化 / CP3-3・CP3-4）と γ軸節は残す (c) Webhook 運用知見（Webhook ID・再検証手順）は siqi/knowledge/tech/x-api.md へ移動してから削除 / 到達状態ヘッダを現行リリースに更新
- **.claude/commands の手順矛盾**: release.md の VPS 再起動手順を /deploy 参照に書き換え、デプロイ手順の正本を deploy.md に一意化。spectra 実機 live state（systemd unit は inactive、現行プロセスは手動起動 `npm run headless`）との乖離も突合し、**運用 SSOT（systemd か手動起動か）をここで確定**する（判断事項6の前提）

完了条件: 突合スクリプト（config.ts キー一覧 vs README 表 / architecture.md ファイル構成 vs `git ls-files src/` / ツール数 vs buildTools 登録数）を流し差分0。PROJECT.md 参照 grep 0件。

## Phase 2 — 死コード・移行残骸の一掃

目的: 本番参照ゼロのコード・スキーマ・テストを削除する。全項目が挙動不変（懐疑検証済み）。約700行削減。

参照ゼロの判定手順（全項目共通）: 静的 import に加え、動的 import・文字列参照（IPC チャネル名・イベント名）・preload 公開 API・設定ファイル参照まで grep してから削除する。

各項目に検証で判明した注意点（→印）を付す。これを守らないと壊れる。

- **message-recorder.ts 削除**（本体30行 + 専用テスト67行）: 履歴記録は field-runtime.appendMessage に一本化済み
  → acceptance 4ファイルの `vi.mock("../message-recorder.js")` は一度も適用されない死んだ宣言。単純削除でよい
- **ipc-schema.ts の縮約**（旧メッセージスキーマ群 + テスト10件、約240行）: WS 移行後に送信実体を失ったスキーマを削除し、streamPostSchema（WS 入力契約として現役）は移設
  → channel.attach / channel.detach / field.terminate の IPC チャネル自体（preload / ipc-handlers のハンドラ）は現役。死んでいるのは zod スキーマのみ
  → ToRendererMessage 型は channel-projection.ts:6 で生存。`z.infer<typeof integrityAlertSchema>` ベースの再定義に置換してから旧 union を消す（toolCallIpcSchema 等の連鎖死もまとめて削除リストへ）
  → architecture.md :182 を同時更新。fs.*/terminal.*/demo IPC には Zod 検証が実在するため「IPC 全体が無検証」とは書かない
- **terminal.snapshot の Renderer 向けチェーン削除**: FieldApi.terminalSnapshot / preload / polyfill スタブ / ipcMain.handle。getSnapshot 本体は AI の terminal ツールが使用中のため残す
  → shared/terminal-schema.ts:49 の `TERMINAL_CHANNELS.snapshot` も削除。architecture.md :216 の API 表も同時更新
- **channel-projection.ts の廃止**（84行）: sendIntegrityAlert 1関数に形骸化済み。ipc-handlers の setAlertSink 内へ headless と同型の数行クロージャとしてインライン化
  → `${message}。再起動してください` サフィックスと `!win || win.isDestroyed()` ガードを厳密に保存。msg.type="integrity.alert" 維持。acceptance 5ファイル全部の vi.mock を削除し、s1 の検証は _harness の mockWin.webContents.send スパイに差し替え
- **未配線シンボルの削除**（約170行）: cancelAll / projectPendingIntents / getBeingPrompt / getLastResponseId / isTunnelRunning / getListenerCount / readMemoriesAfter ほか
  → **テスト用シームは削除不可**: ipc-handlers の getFieldState 再export（テスト側を field-orchestrator 直 import に配線替えしてから削除）/ observation-buffer の clearBuffer・bufferSize（_resetForTest 前例に倣い改名保持）
  → RECOVERY_POLICY は削除 + architecture.md :862-867 同時更新（判断事項2: 決定済み・案a）。popFocus/canPopFocus は判断事項3
- **participation-context.ts の縮小**: createParticipationInput / ParticipationInput 型 + 対応テストを削除し generateCorrelationId のみ残す
  → architecture.md 3箇所（:99, :754, :758-764）が型を配線済みであるかのように記述しており同時修正必須
- **_harness.ts の死にヘルパー削除**: getSentMessages / getLastSentMessage + s1 の未使用 import
- **小粒衛生**:
  - ルート直下 BEING.example.md 削除（v0.3.0 残骸。正本は avatar.example/ 側）
  - X_WEBHOOK_SECRET 削除（コードが一度も読まない死にキー。config.ts 3行 + .env.example + architecture.md + README 両言語）
  - .gitignore: AGENT.md（v0.2 残骸）削除、`/BEING.md` `/pulse/` 追加（**必ずルートアンカー**。unanchored `commands/` は .claude/commands/ を silent ignore する実害があるため不可）
  - tsconfig: outDir/rootDir 削除 + `"noEmit": true` 追加 + include に "scripts" 追加
  - scripts/upload-to-collection.ts の process.env 直読みを getConfig() 経由に置換
    → スクリプト側の3変数必須チェックは残す（config 上 optional のため）。dotenv.config() を最初の getConfig() より前に維持
  - **【挙動変更・独立コミット】** Electron About パネル: ハードコード "0.3.0"（4リリース前で凍結）→ `app.getVersion()`。表示バグ修正を兼ねる
  - docs/assets/spectra-transparent.png 削除（判断事項5の決定後）
  - npm script `headless` は判断事項6（Phase 1 の運用 SSOT 確定後に決定）

完了条件: `npx vitest run` 全緑 / `npx tsc --noEmit` エラー0 / 参照ゼロ export 再スキャン（上記判定手順）で0件 / `npx electron-vite build` 成功 + 両モード起動でログにエラー0行（grep -c "ERROR\|FATAL"）。

## Phase 3 — 型・スキーマの SSOT 統合 + wire union 定義

目的: 同一 enum・スキーマの2〜4重定義を1箇所に収束させ、追加時の修正箇所を各1箇所にする。約400行削減。

- **基礎 enum の一本化**: channel（**4箇所**: channel.ts / ipc-schema / session-event-schema / pulse-loader.ts:88 の手書き VALID_CHANNELS）・actor・source・fieldState（**3箇所**: ipc-schema.ts:132-138 と :72 のインライン + session-event-schema）を統合
  → 統合先は中立な共有ファイル（channel.ts を `CHANNEL_IDS as const` + z.enum + 型導出に拡張、または shared/primitives 新設）。session-event-schema への一本化は不採用（独立性宣言と矛盾）
  → pulse-loader の VALID_CHANNELS が唯一の型リンクなし完全サイレント不整合ポイント。必ずスコープに含める。`as const` タプルへの `.includes(string)` は TS2345 になるため書き方注意
  → zod import は "zod/v4" に統一（terminal-tool.ts:2 の1件逸脱もここで修正）。renderer 側の type-only import を値 import に変えない
- **toolName / approvalReason の統合**: 3箇所ずつ重複。approvalReasonSchema を tool-approval-schema へ移動し session-event-schema が import する方向（逆は循環）。input-gate の手書き再列挙を TOOL_NAMES 参照に置換
- **FS スキーマの統合**: fs-rpc-schema.ts を fs-schema.ts に併合。6値の全メソッド集合を SSOT とし、WS 公開 subset ＝ 全集合 − fs.importFile を**導出**で表現（importFile の WS 除外はセキュリティ仕様。session-ws-server.test.ts:496-510 の保証を維持）
- **session-event-schema 内部の同型統合**: pendingApprovalSchema = approvalRequestedPayloadSchema のエイリアス化（**両 export 名は維持必須**: discord-bridge と z.array() が参照）
- **x 系ツールの共通スキーマ**: 280文字制約 zod 行（3ファイルで文字単位同一）→ `xTextSchema` 抽出。memoryRecordSchema を `saveMemoryArgsSchema.extend({id, at, source})` に書き換え
- **wire message union の定義（定義のみ。受信検証の有効化は Phase 8A）**: セッション WS に実際に流れるメッセージを**方向別に**定義する — `serverToClientWireSchema`（SessionEvent 5種 + 制御メッセージ tool.approval.result / error + fs.response）と `clientToServerWireSchema`（stream.post / tool.approval.respond / fs.request）。現状の「Zod で書くが parse しない」中間状態の解消は、プロトコルが Phase 8 の multiplex で動く前に受信検証を入れると二度変更になるため、**定義を正本化するに留める**
- **polyfill パリティテスト追加**: shared/field-api.ts に `FIELD_API_METHOD_NAMES as const satisfies readonly (keyof FieldApi)[]` + 網羅性アサーション（Exclude → never）を追加し、ポリフィル文字列を eval して `Object.keys(window.fieldApi)` と突合するテスト1本。field-api-polyfill.ts:23 の虚偽コメント（「build-config で保証」→ 保証は実在しない）を修正

アンチスコープ: ツール定義 parameters の z.toJSONSchema 自動導出は**見送り**（JSON Schema と Zod は緩いワイヤスキーマ + 厳格サーバー検証の意図的2層。導出すると API 送信ペイロードが変化し LLM 挙動に影響）。

完了条件: 各 enum・スキーマ定義の grep で定義箇所1 / wire union が存在しテストで全メッセージ種を網羅 / 全テスト緑 / tsc エラー0。

## Phase 4 — 局所重複の統合

目的: コピペ起源の同型ブロックを関数抽出で統合。低リスク・局所的なものに限る。約300行削減。

- **x-api-repository.ts**: createPost/createReply/createQuoteRepost（各約45行、差分は payload 1-2行とログ文言のみ）→ `postTweet(payload, label, logSuffix?)` に統合。228行 → 約140-150行
  → 成功ログ接尾辞（`: ${tweetId} → ${replyToTweetId}` 等）は logSuffix で完全再現するかログ差分許容かを選ぶ。検証は tsc + **stub/sandbox 確認を通常条件**とし、実投稿確認はリリース前に1回（外部副作用を毎フェーズ発生させない）
- **chat-session-service の parse プロローグ統一**: 4-5行 × 10ハンドラ → `parseToolArgs<T>(schema, argsJson, toolName)` で1行化。fs 系4ハンドラは runtime/fs-request-handler.ts の dispatchFsRequest 委譲に置換（fs 引数検証を1箇所に）
  → dispatchFsRequest は生の結果を返すため JSON.stringify ラップを呼出側で維持。services → runtime の import は依存方向を壊さない
- **エラー文字列化の共通化**: `err instanceof Error ? err.message : String(err)` 20ファイル45箇所（scripts 含め48箇所）→ `toErrorMessage(err: unknown): string` を shared/ に定義し置換
  → 置換対象外を明示: i18n フォールバック型（`: t("operationError")` 12箇所）/ field-orchestrator.ts:49 の変種 / ENOENT 判定箇所
- **renderer の小統合**（Phase 6 の分割と同時実施でもよい）: appendObservation/appendXEvent の32行完全重複 → `appendMonitorEntry(bodyEl, maxEntries, eventType, formatted, timestamp)` / tool-call 引数整形 → `formatToolArgs()` / filesystem-pane のメニュー描画2重 → `renderContextMenu(items, x, y)`
- **observation-server の Bearer 認証2重化のみ関数抽出**（8行）。3 HTTP サーバー横断の定型統合は**行わない**（Phase 9 の ingress 統合で一括解消。先に小型ヘルパーを散らすと二度手間）

完了条件: `npx jscpd src --ignore "**/*.test.ts"` のクローン行数が 196行 → 100行以下 / 全テスト緑 / X 投稿系 stub 確認。

## Phase 5 — 安全網テストの整備

目的: Phase 6 の構造変更対象**すべて**に「変更前から存在する緑のテスト」を用意する。現挙動を固定する characterization test が中心。**Phase 6 の前提条件**。

- **ツール実行の characterization**: 10ツールのディスパッチ網羅（各ツール名 → 正しいハンドラ着地）/ InputGate → 承認ゲートの通過順序 / 例外実装3種（save_memory の fire-and-forget Collections、roblox_action の3段処理、terminal の throw しない error JSON 返却）の現挙動固定
- **X Webhook パイプラインの受入テスト**: field-runtime の X ハンドラはどの受入テストからも駆動されていない（s2-s4 は x-webhook-server を vi.mock するだけ）。s2 の observationHandler 抽出パターン（s2:148）に倣い xHandler を抽出・駆動。特に x_mention の共振ゲート免除（field-runtime.ts:459）と publishXToolResults（:478）を固定
- **fieldState ライフサイクルのテスト**: state.json からの復元（"terminated" 含む）/ attach/detach/terminate 遷移 / attach 中の一時状態 "resumed" が永続化されないことの固定
- **bootstrap 順序のテスト**: Electron / headless 両エントリの起動・停止シーケンス（サービス起動順・shutdown 時の解放順）を固定（Phase 6-7 の共通化前提）
- **filesystem-pane のロジックテスト**: 新規作成・削除・undo/redo・キーボードナビの中核ロジックを DOM 単体（jsdom/happy-dom）で検証。純粋ロジックとして切り出せる部分は filesystem-dnd.ts の前例に倣い先に抽出してよい（Phase 6-6 の分割線の先行確認を兼ねる）
- **renderer ストリームUIのテスト**: ストリーム中断（streamingAbort）・承認リクエスト描画・monitor 振り分け（roblox/x）を jsdom で固定
- **discord-bridge の承認ロジックテスト**: approvalMessages Map / sendApprovalToChannel / restorePendingApprovals（discord-session-client.ts 149行も未テストである事実を Phase 7 の優先順位に記録）
- **fsRootName の単体テスト**: filesystem-service.test.ts に1件（Phase 7 の二重検証縮約で WS 側が消える前に SSOT 側へ）
- **GET /observation/display-state の認証テスト**: observation-server.test.ts に0件のため1本追加

完了条件: Phase 6 の作業項目10件それぞれに対応する緑のテストが存在する対照表を本節に追記 / 追加分含め全テスト緑。

## Phase 6 — 構造リファクタ

目的: 責務の混在・境界違反・二重保持を解消する。本計画の中核。挙動不変だが影響範囲が広いため、Phase 5 の安全網を前提とする。

実施順序に意味がある（後の項目が前の項目を前提にする）:

1. **ツール実行のレジストリ化**: chat-session-service.ts（620行）に同居する個別ハンドラ10本 + buildTools + if 連鎖を、各 src/tools/*-tool.ts に `{def, schema, execute}` を同居させたレジストリへ。本体は API ループ + チェーン回復専業の約280行に
   → schema の所在は移動しない: fs_* 4つは shared/fs-schema.ts（renderer/preload が共有）、save_memory は memory/memory-record.ts。execute が現在地の schema を import
   → 厳密に同型なのは 7/10。例外3種があるため `execute(args, ctx)` のコンテキスト引数（client/responseId/callId）を先に設計
   → InputGate・承認ゲートの通過順序（:234-250）を厳密に維持（Phase 5 の characterization が固定）
2. **services/runtime の依存逆転**（判断事項9: 決定済み・案b）: chat-session-service が必要とする Terminal / FS / 承認を port（interface）として注入し、依存方向を `runtime/application → ports ← adapters` に一方向化する。**ディレクトリの単純移動はしない**（巨大 runtime 層への同居は境界を隠すだけ）。完了判定はディレクトリ数ではなく**循環依存ゼロ**（dependency-cruiser を devDependency に追加し、設定ファイル固定の npm script `check:deps` として導入。以後の完了条件にも使う）
3. **観測パイプラインの統合**: field-runtime.ts の Roblox 観測ハンドラ（:330-415）と X Webhook ハンドラ（:436-483）の同一骨格（publish → 履歴 append → 転送ポリシー → 共振ゲート → isFieldActive → role 解決 → enqueue → emitStreamItem）を共通関数に抽出し、チャネル差分を引数化
   → **機械的共通化は不可**。保存すべき実差分: x_mention の共振ゲート免除（免除述語を引数化。固定ステップ化すると共振OFFで x_mention が沈黙する回帰）/ publishXToolResults 後フック / Roblox の motion 抑制（endMotionSuppression は shouldForward ゲートより**前**に実行される仕様を維持）/ 履歴 append 先・monitor.item payload 形の差
   → 内部重複（roblox_log 早期 return 用 publish+append :339-344↔:349-354）は無条件 publish を先に1回実行する形で即解消
4. **fieldState 二重保持の解消**: orchestrator のモジュール変数と state.field.state の手動同期をやめ、field-runtime（state.field.state）に一本化。orchestrator は getState().field.state 参照のアクセサ経由に
   → 逆方向（orchestrator 所有）は不可（循環 import）。"resumed" 非永続の現仕様を維持（遷移計算はローカル変数 + updateFieldState 1回書戻）。s1/s5 の field-runtime モックはステートフル化
5. **renderer/main.ts の分割**（1001行 → 約300行 + 3-4モジュール）: avatar-animation.ts（:265-393）/ layout-splitters.ts（:48-263）/ stream-ui.ts（appendMessage/showThinking/承認UI）/ monitor-pane.ts（Phase 4 の appendMonitorEntry と同時）
   → CHAR_DELAY_MS（:266）と streamingAbort（:341）はアニメ領域に混在しているが stream-ui 所属。モジュール横断の可変状態（devMode/sessionClient/currentStreamingPromise 等8変数）は ESM import バインディングが読み取り専用のため setter か状態オブジェクトで渡す
6. **filesystem-pane.ts の分割**（982行）: fs-context-menu.ts / fs-keyboard-nav.ts に分割。新規作成3重実装 → `createEntry(targetDir, kind)`、Backspace/Delete 重複統合
   → 集約すべきモジュールスコープ状態は focusedPath/clipboard/expandedDirs + activeMenu/undoStack/redoStack/dragSourceRow/dragTargetRow/currentPath/paneOptions。エラーメッセージ差（t("createError") vs t("operationError")）と e.metaKey ガードを保存
7. **エントリーポイントの bootstrap 共通化**: Electron / headless の起動・終了シーケンス並行実装を runtime/ の共通 bootstrap/shutdown に抽出
   → 保存すべき差分3点: createSessionWsServer の httpServer 注入有無 / boot 失敗時 process.exit(1)（headless のみ）/ attach タイミング（headless 即時 vs Electron はレンダラ起点）
8. **tunnel-manager.ts の移動**: src/main/ → src/runtime/（headless からの逆流 import 解消）。冒頭コメントの陳腐化も修正
9. **FS 命名の統一**: fs- / filesystem- の2方式分裂（8ファイル）→ fs- へ統一（ワイヤ契約 fs.*/fs_* と一致）。テスト2件も同時リネーム。architecture.md / PLAN.md 該当行を同時更新
10. **ipc-handlers 互換層の縮小**: getFieldState / safeDetach / getStateSnapshot を直接 re-export 化または import 先変更（handleStreamPost は Phase 0-1 で修正済みのため、その修正後の形を維持）

アンチスコープ（このフェーズでやらないこと）:
- Roblox/X の転送ポリシー・フォーマッタの統合（同型は意図的並行。汎用抽象は最小構成原則違反。相互参照コメントで足りる）
- config.ts の分割（342行は構造的に妥当。チャネル増で800行に近づいた時点で再検討）
- 6要素 DAG にコードを合わせる大規模再配置（文書側を Phase 1 で「目標設計（未実装）」と明示する方が正しい。RuntimeCoordinator は未実装のまま）
- 50行超関数の機械的全解消（50行は目安。create 系は内部に名前付き関数で部分分解済み。真にモノリシックな内部ブロックのみ抽出し、シグネチャ膨張を避ける）

完了条件: `wc -l src/**/*.ts` で800行超0件 / `npm run check:deps` で循環依存0 / 全テスト緑（Phase 5 の characterization 含む）/ 両モード起動 / renderer 系手動UI確認チェックリスト消化（D&D・コンテキストメニュー・キーナビ・テーマ切替・ストリーム表示・承認フロー。Playwright E2E への段階移行は Phase 7 で着手）。

## Phase 7 — テスト基盤整理とカバレッジ最終ゲート

目的: テストの実行時間・重複・名前詐称を解消し、カバレッジを品質基準（全体80%）まで引き上げる。

- **session-ws-server.test.ts の固定スリープ排除**: 単独で全実行時間の53%（2333ms/4490ms）。start() を listening で resolve する Promise に変える小改修（プロダクション側数行）+ vi.waitFor + port 0（OS 採番）
- **二重検証の縮約**: WS 経由 fs.request 正常系5件 → 代表 fs.read 1件（fsRootName は Phase 5 で SSOT 側に追加済み）。サンドボックス2件 → 1件。エラー系3件は維持
- **vi.mock コピペの共通化**: acceptance 5ファイルの同一ブロック約150行 → __mocks__ ディレクトリ方式か vi.hoisted + _harness factory 集約
  → logger モックは4種に分裂し、うち2ファイルは実在しない `debug` をモックしている。実エクスポート（info/error/fatal）に揃える
- **名前詐称の解消**: main.test.ts → config.test.ts（result/save-memory 分は各所へ分割。相対 import 修正、BASE_ENV は config 側に残す）/ discord-bridge.test.ts → discord-message-renderer.test.ts
- **Playwright E2E の導入**: Phase 6 の手動UI確認チェックリストを E2E 化（起動 → ストリーム送受信 → 承認 → ペイン操作の最小シナリオ）。以後のリリース検証の手動コストを削減
- **カバレッジ底上げ**（優先順位）: chat-session-service（レジストリ化後は API ループ専業でテスト容易）→ pulse-runner → discord-bridge + discord-session-client → x-api-repository → renderer 分割後モジュール（純粋ロジック抽出 → 単体テスト方式。filesystem-dnd / state-normalizer / layout-manager で実績あり）
- **最終ゲート**: 全体ラインカバレッジ80%以上。到達不能・対費用効果が合わないファイル（型定義のみ・エントリポイント等）は**理由付き allowlist** として coverage.exclude に列挙し、本節に理由を記録する

完了条件: `npx vitest run` 3回実行の中央値で総実行時間が現状比50%以下、かつ**待機目的の固定 sleep 0件**（タイムアウト監視・fake timer 利用は除外）/ `npm run test:coverage` で allowlist 控除後の全体80%以上 / `npm run test:e2e`（Playwright）全緑 / テストファイル名と検証対象の一致（全 *.test.ts の対象 grep 突合）。

## Phase 8 — 通信クライアント統合（3段階）

対象: WS クライアント3系統（renderer/session-client・discord/discord-session-client・polyfill 内 FS RPC クライアント）。PLAN.md 持ち越し項目「WebSocket multiplex」「再接続ロジック共通化」と同一スコープ。**挙動不変の共通化と挙動変更を分離して段階実施**する。

### 8A. 再接続コアの共通化（挙動不変）
- handleMessage の switch（22行同一）/ sendApprovalRespond（完全同一）/ close() / 再接続スケジューラを共通モジュールに抽出し、WebSocket 実装（ブラウザ / node ws）を注入。**各系統の現行バックオフ戦略はそのまま維持**
- → 保存すべき差分: エラー経路（renderer は callbacks.onError、discord は log.error。logger.ts は node:fs 依存でブラウザ bundle 不可 → ロギング注入点が必要）/ connect() の意味論（renderer は Promise + 初回失敗 UI 表示、discord は fire-and-forget + リトライ継続。「reject しつつ再試行継続」を壊さない）
- Phase 3 で定義した wire union による受信検証をここで有効化（malformed event / error / tool.approval.result / fs.response / 切断中 pending request の自動テストを追加）

### 8B. WS multiplex（プロトコル変更・独立コミット）
- session WS と FS RPC WS の1本化。polyfill 側クライアントを 8A の共通コアに合流

### 8C. バックオフ統一（**挙動変更**・独立コミット）
- jitter 付きステップ表への片寄せ。再接続タイミングという外形挙動が変わることを明示して実施

完了条件: 3系統が1共通コア + 薄いアダプタ（差分は接続先と purpose のみ）/ wire union 検証が本番経路で有効 / 再接続の自動テスト（サーバー再起動 → 復帰）+ 手動確認 / 全テスト緑。

═══ Phase 8 完了 = リファクタ本体完了。CHANGELOG に総括を記載し、本文書の実測値を確定 ═══

## Phase 9 — γ軸リファクタ 【ゲート: α/β議論決着。設計待ち】

設計正本は PLAN.md「γ軸リファクタ」節 + Decision Log 2026-04-23。ここには監査で確定した実装可能性の検証結果と完了条件のみ記す。

- **着手ゲート**: α（場の状態正本）・β（副作用冪等性境界）の議論決着。「決着」の判定基準: siqi 側 Decision Log に承認日・決定事項・導出された不変条件が記載されていること。**本計画内の判断で前倒しはできない**（例外を作る場合は先に Decision Log と PLAN.md を正式更新する）
- 監査で確認済みの事実（着手時に再利用する）:
  - ROBLOX_OBSERVATION_PORT / X_WEBHOOK_PORT は各1箇所消費のみ。単一 ingress（path-based routing）への統合は経路衝突なしで実装可能
  - 独立 http.Server は実体2本（observation / x-webhook）。console-http-server は session-ws-server と同居体
  - 外部3点協調が必要: Roblox 側 Config.luau の URL 変更 / X Webhook 再登録 / トンネル経路変更。利用者向け移行手順を README/CHANGELOG に記載
  - SESSION_WS_ALLOWED_ORIGINS の same-origin 置換は**ヘッドレスモード限定で成立**。Electron モードでは破綻するため「外部 httpServer 注入時のみ same-origin 強制、Electron は現行維持」の形で設計に含める。`Origin: null` 例外は sandboxed iframe による CSWSH 再開放リスクがあり不可
- 完了条件（着手時に具体化する骨子）: 単一 PORT で全経路疎通 / 旧 env（ROBLOX_OBSERVATION_PORT / X_WEBHOOK_PORT / SESSION_WS_ALLOWED_ORIGINS）の参照0 / same-origin 判定の自動テスト（許可・拒否・非ブラウザクライアント素通り）/ Electron モード互換テスト / Roblox・X 実機移行確認 / 旧構成へのロールバック手順検証 / `/status` 自己観測エンドポイントの契約テスト

---

## 判断事項

**決定済み（Codex 審査で確定、ユーザー異議があれば差し戻し可）**:

- 判断2 **RECOVERY_POLICY**: 削除 + architecture.md 同時更新（宣言と実装の乖離解消）
- 判断7 **handleStreamPost 引数切り捨て**: 修正必須 → Phase 0-1 に昇格（権限昇格経路のため。「ローカル前提」の割り切りは Discord 入口と両立しない）
- 判断9 **services/runtime**: 依存逆転（port 注入 + 循環依存ゼロの機械検証）。ディレクトリ単純移動はしない

**ユーザー決定待ち**:

1. **field.terminate チェーン**（UI から到達不能）— これは死コード削除ではなく **FieldApi 公開契約と場モデルの判断**
   - 案a: FieldApi 契約から terminate を除去（公開契約変更として CHANGELOG 明記。FSM の terminated 状態と state.json("terminated") 復元経路は本番到達可能なので残す。受入テスト6箇所は orchestrator.terminate() 直呼びへ）
   - 案b: 「場の終了」UI トリガーを復活（場モデルの概念的一部として機能欠落とみなす立場）
3. **popFocus/canPopFocus**（Canvas「戻る」機能の未完成痕跡）
   - 案a: 削除（推奨） / 案b: 機能完成をバックログ化して保留
4. **readMemoriesAfter**（本番呼出ゼロ。将来の同期機構の布石の可能性）
   - 案a: 削除（推奨。必要になれば git 履歴から復元） / 案b: 保留
5. **docs/assets/spectra-transparent.png**（72KB、v0.3.0 から一度も参照なし。外部参照も siqi-site 全履歴・comms アーカイブ・リリースノートで検証済みゼロ）
   - 案a: 削除（推奨） / 案b: 保持
6. **npm script "headless"** — npm script は外部利用され得る公開操作面のため、Phase 1 で確定する運用 SSOT（systemd か手動起動か）に従属させる
   - 案a: 運用 SSOT が手動起動なら、起動コマンドの正本として残し README に明記
   - 案b: 運用 SSOT が systemd なら、ExecStart を `npm run headless` に統一（SSOT 化）するか script を削除するかをその時点で決定
8. **セッションイベントの受信検証**: wire message union（Phase 3 で定義）を正本とし Phase 8A で有効化する方針で計画済み。反対があれば Phase 3 の定義のみで止める

## 統合・変更しないと決めた事項（アンチスコープ全体）

- Roblox/X 転送ポリシー・フォーマッタの統合（意図的並行。実害は field-runtime ハンドラ骨格側にあり Phase 6-3 で解消）
- ツール parameters の z.toJSONSchema 導出（API ペイロード変化 = 挙動変更）
- config.ts の分割 / AppResult の全面 throw 化（projector 等が失敗を回復可能結果として処理する設計。throw 標準は新規コードの規約として architecture.md に明文化し、AppResult はリポジトリ層境界契約として存続）
- SELF_ANALYSIS_JOURNAL_FILE の削除（gitignore 領域の Spectra /log プラグインが消費。「プラグイン専用」明記は既に充足済み）
- undici override の削除（discord.js の exact pin により CVE 再導入。Phase 0 の範囲変更のみ）
- SESSION_WS_ALLOWED_ORIGINS の単独置換（Electron モード破綻。Phase 9 の γ設計と同時のみ）

## 検証プロトコル（全フェーズ共通）

1. `npx vitest run` 全緑
2. `npx tsc --noEmit` エラー0
3. `npx electron-vite build` 成功
4. ヘッドレス起動 + Electron 起動（ログのエラー行 grep 0件）
5. UI 変更を含むフェーズはユーザー手動確認の具体手順を提示（Phase 7 以降は Playwright E2E に移行）
6. ドキュメント（architecture.md / api.md / README）は変更と同一コミットで更新
7. フェーズ完了ごとに: jscpd・カバレッジ・800行超/50行超・循環依存（Phase 6 以降）を再計測し、本文書の該当フェーズに実測値を追記
8. 挙動変更コミット（Phase 0-1 / About 版数 / 8C）は CHANGELOG に個別記載

## 削減見込み（観測値として追跡。目標ではない）

- Phase 2: 約700行削除（本体 + テスト + ドキュメント記述）
- Phase 3: 約400行削減（スキーマ・enum 統合）
- Phase 4: 約300行削減（重複統合）
- Phase 6: 行数は概ね中立（移動・分割が主）。800行超2ファイル解消・循環依存ゼロ・chat-session-service 620 → 約280行
- Phase 7: テスト実行時間50%以下・全体カバレッジ80%（allowlist 控除後）
- 合計: 実装系コードの約12%（約1,400行）を挙動不変で削減し、構造違反（境界逆流・二重保持・責務混在）をゼロにする
