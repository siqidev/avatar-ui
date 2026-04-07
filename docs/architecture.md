# アーキテクチャ（v0.5）

> 現行実装の事実記述。設計意図・決定背景はPROJECT.md Decision Logを参照。

## ファイル構成

```
src/
  config.ts                   環境変数→AppConfig（唯一のprocess.env入口）
  logger.ts                   ロギング（info/error/fatal → data/app.log）
  headless/
    index.ts                  ヘッドレスエントリーポイント（Console UI HTTP配信+WS+Runtime統合起動）
  main/
    index.ts                  Electron Mainエントリーポイント
    ipc-handlers.ts           IPC配線（field-orchestratorへの薄いアダプタ）
    channel-projection.ts     媒体投影（integrityアラートのIPC送信のみ）
    message-recorder.ts       履歴記録（永続化付き）
    menu.ts                   カスタムメニュー（テーマ・モデル・言語radio + 共振checkbox + About）
    fs-ipc-handlers.ts        FS系IPC処理
    terminal-ipc-handlers.ts  Terminal系IPC処理
    tunnel-manager.ts         cloudflaredトンネル管理
    acceptance/               受入テスト（S1-S5）
  preload/
    index.ts                  contextBridge経由のAPI公開
  renderer/
    main.ts                   Rendererエントリーポイント（ペイン初期化+WS接続）
    session-client.ts         セッションWSクライアント（Browser-native WebSocket）
    layout-manager.ts         3列可変長配置+全7ペインD&D入替
    state-normalizer.ts       IPC入力→視覚状態マッピング（優先度ロジック）
    canvas-pane.ts            Canvasペイン
    canvas-focus-stack.ts     Canvas上のフォーカス履歴管理（スタック）
    filesystem-pane.ts        Spaceペイン（ツリーD&D移動+外部インポート）
    filesystem-dnd.ts         D&D純粋関数（パス検証・書換）
    terminal-pane.ts          Terminalペイン（xterm.js）
    style.css                 デザイントークン+レイアウト+テーマ定義
    public/
      theme-init.js           FOUC防止+lang属性（CSS前に同期実行、localStorageからテーマ・ロケール適用）
      idle-00〜03.png          アバター画像（待機フレーム、連番プローブ）
      blink.png               アバター画像（瞬きフレーム、150ms表示）
      talk.png                アバター画像（発話）
  runtime/                    Electron非依存のランタイム基盤
    field-orchestrator.ts     場の起動・FSM遷移・stream処理を統括
    field-runtime.ts          FieldRuntime（場のロジック統合）
    field-fsm.ts              場FSM（純関数transition）
    integrity-manager.ts      健全性管理（warn/report/凍結ラッチ）
    session-event-bus.ts      セッションイベントバス（pub/sub。FieldRuntime→購読者配信）
    console-http-server.ts    Console UI HTTP配信（静的ファイル+ポリフィル注入。ブラウザアクセス用）
    session-ws-server.ts      セッションWebSocketサーバー（event bus→外部クライアント配信）
    approval-hub.ts           承認ハブ（複数承認者 first-response-wins）
    tool-approval-service.ts  承認サービス（auto-approve判定 + hub委譲）
    settings-store.ts         設定ストア（テーマ・モデル・言語・共振モード永続化 → data/settings.json）
    terminal-service.ts       Terminal持続PTY管理（node-pty）
    filesystem-service.ts     Avatar Spaceファイル操作（refs/読み取り専用ガード）
  services/
    chat-session-service.ts   Grok Responses API呼出+ツール実行ループ
    input-gate.ts             InputGate（source+channel+roleベースのツール権限制御）
    input-role-resolver.ts    InputRole解決（各チャネルのオーナー判定）
  roblox/
    projector.ts              Robloxへの意図送信（Open Cloud Messaging）
    intent-log.ts             投影ログ（roblox-intents.jsonl）
    observation-server.ts     観測受信HTTPサーバー
    observation-formatter.ts  観測イベント→表示文字列整形
    observation-forwarding-policy.ts  AI転送ポリシー（shouldForwardToAI判定）
    motion-state.ts           移動中proximity抑制（startSuppression/endSuppression/isProximitySuppressed）
    roblox-messaging.ts       Open Cloud Messaging API呼出
  tools/
    filesystem-tool.ts        LLMツール: fs_list/fs_read/fs_write/fs_mutate
    roblox-action-tool.ts     LLMツール: roblox_action（AIツール定義、8カテゴリ）
    terminal-tool.ts          LLMツール: terminal
    save-memory-tool.ts       LLMツール: save_memory
    x-post-tool.ts            LLMツール: x_post（Xポスト）
    x-reply-tool.ts           LLMツール: x_reply（X返信、Phase 2）
  x/
    x-api-repository.ts       X API v2呼出（OAuth 1.0a署名）
    x-webhook-server.ts       Account Activity API Webhookサーバー
    x-event-formatter.ts      Xイベント→表示文字列+AI入力文整形
    x-forwarding-policy.ts    XイベントのAI転送ポリシー
    x-dedupe-repository.ts    tweet_id重複排除（ファイル永続化）
  discord/
    discord-bridge.ts           Discord窓口ライフサイクル統括
    discord-session-client.ts   Node用WSクライアント（再接続付き）
    discord-message-renderer.ts 表示整形（純粋関数）
  memory/
    memory-log-repository.ts  memory.jsonl読み書き
    memory-record.ts          MemoryRecord型・ID生成
  collections/
    collections-repository.ts xAI Collections API（files→documents）
  shared/
    ipc-schema.ts             IPC型定義（Zod + discriminated union。Console固有）
    session-event-schema.ts   セッションイベント型（トランスポート非依存。stream/approval/monitor/state）
    fs-schema.ts              FS操作型定義（Zod）
    terminal-schema.ts        Terminal操作型定義（Zod）
    participation-context.ts  ParticipationInput型・correlationId生成
    i18n.ts                   i18n辞書+t()関数（ja/en対応、Main/Renderer共用）
  state/
    state-repository.ts       state.json永続化（atomic write+バックアップ）
  types/
    result.ts                 AppResult<T>型（Ok/Fail）
roblox/                       Roblox Studio用Luauスクリプト群（Rojo管理）
```

## プロセス構成

FieldRuntime（場の全ロジック）はElectron非依存の`src/runtime/`層に配置。2つの実行モードで同一のランタイムを使用する。

### ヘッドレスモード（`npm start`）

Node.jsプロセス単体で起動。Console UIをHTTP配信し、ブラウザからアクセスする。VPS/ローカル共通。

- **プロセス**: FieldRuntime（6要素）、Pulse(cron, pulse/ディレクトリ)、観測受信(HTTP)、X Webhook受信(HTTP)、Grok API呼出、永続化、Discord窓口(discord.js)、Console HTTP配信、Session WSサーバー
- **エントリーポイント**: `src/headless/index.ts`

### Electronモード（`npm run dev`）

Electron Mainプロセス内にFieldRuntimeを同居＋論理分離。Rendererは薄いIPCクライアント。

- **Main**: FieldRuntime（6要素）、Pulse(cron, pulse/ディレクトリ)、観測受信(HTTP)、X Webhook受信(HTTP)、Grok API呼出、永続化、Discord窓口(discord.js)

#### Pulse（汎用タスクシステム）

`pulse/`ディレクトリ内の各`.md`ファイルが1つのcronタスクとして動作する。旧PULSE.md・XPULSE.md・データフィードを統合した汎用的な仕組み。

**ファイル構造**:
```markdown
---
cron: "0 * * * *"           # cron式（UTC、必須）
source: "https://..."       # データ取得URL（省略可）
target: "DeskTop_Kiosk"     # Roblox表示先（省略可）
title: "UFO FEED"           # 表示タイトル（省略可）
template: "{city} — {shape}" # テンプレート（省略可）
channel: roblox             # 配信チャネル（省略可、デフォルト: console）
tools: [roblox_action]      # AIに許可するツール（省略可）
---
AI指示文（省略可。省略時はデータ取得+表示のみ）
```

**実行フロー**（cron発火時）:
1. **データ取得**: `source`設定時、URLからデータをフェッチ。MD5ハッシュで重複検出（変更なしならスキップ）
2. **プログラム表示**: `target` + `template`設定時、テンプレートでデータを整形しRoblox MessagingService経由で直接表示（AI不使用）
3. **AI送信**: マークダウン本文（AI指示）がある場合、取得データを添付してAIに送信

**プロトコル**:
- **{NAME}_OKプロトコル**: パルス名（ファイル名）を大文字化した`{NAME}_OK`で応答すると対応不要と判断しストリーム出力をスキップ
- **busyフラグ**: パルスごとに前回ジョブ未完了なら次の発火をスキップ（承認待ち対策）
- **場状態ゲート**: `isFieldActive()`がfalseならスキップ
- **共振ゲート**: `source`設定時（データフィード系）は共振OFFでスキップ
- **Xチャネル特化**: `channel: x`の場合、直近投稿履歴を自動注入（重複防止）、x_post/x_reply未使用の応答は抑制

#### メッセージキューと直列化（enqueue）

全入力（user/pulse/observation）は`enqueue()`を経由してAI呼び出しを直列化する。Promise chainパターンで実装し、前のジョブ完了後に次のジョブを実行。JSシングルスレッド+イベントループにより、同時発火（Pulse発火中にユーザー入力、観測イベント到着等）でもキュー順に処理される。優先度制御はなくFIFO。凍結時はジョブをスキップ（onSkipコールバックで呼び出し元のPromiseをreject）
- **Renderer**: 7ペインの描画＋WebSocket経由のセッションイベント購読＋ユーザー入力の送信のみ
- **セッションイベントバス**: runtime/session-event-bus.ts — FieldRuntimeが`stream.item`/`monitor.item`/`approval.*`/`session.state`イベントをpublish。session-ws-server.tsがsubscribeしWebSocketクライアントに配信
- **セッションWebSocketサーバー**: runtime/session-ws-server.ts — event busイベントを外部クライアントにリアルタイム配信。接続時にsession.state（場の状態+履歴+pendingApprovals）を初回送信。stream.post受信・ツール承認応答にも対応。30秒間隔のping/pongで半開き接続を検出・切断。`SESSION_WS_TOKEN`設定時はtoken認証を行う（デフォルトport: 3002）
- **セッションクライアント**: renderer/session-client.ts — Browser-native WebSocketクライアント。Renderer起動時に`await attach()` → `sessionWsConfig()` → WS接続の順で初期化。指数バックオフ（3s→60s）による自動再接続。HTTPS経由時はwss://に自動切替。セッション系通信（stream/monitor/approval/state）はすべてWS経由
- **Discord窓口**: discord/discord-bridge.ts — discord.jsでDiscord Botを起動し、session-ws-serverにWSクライアントとして接続。双方向チャット対応: @Spectraメンションで入力受付→WS経由でstream.post→FieldRuntime処理→応答をDiscordに投稿。Console起源のhuman発話もDiscordに転送（双方向同期）。承認ボタンはowner限定。`DISCORD_BOT_TOKEN` + `DISCORD_CHANNEL_ID` 設定時のみ起動。Discord Developer PortalでMessage Content Intentの有効化が必要
- **媒体投影**: channel-projection.ts（ChannelProjection）はintegrityアラートのIPC送信のみ。セッション系（stream/monitor/approval/state）はすべてWebSocket経由に移行済み
- ウィンドウ閉じ = channel.detach（Mainは生存しタスクトレイ常駐）、再度開き = channel.attach + 状態再同期
- セキュリティ: nodeIntegration:false / contextIsolation:true / sandbox:true

## IPC

### プロトコル

メッセージ形式: `{ type, actor?, correlationId?, ...ペイロード }`。typeは `<domain>.<action>` の2語。Zod検証必須（shared/ipc-schema.ts）。トランスポートはElectron標準IPC。

### Preload API（src/preload/index.ts）

contextBridge経由でRendererに公開する最小API。ipcRendererの直接公開は禁止。セッション系通信（stream/monitor/approval/state）はWebSocket経由に移行済み。IPCに残るのは場のライフサイクル制御、FS/Terminal操作、Console固有イベントのみ。

**Renderer → Main（場のライフサイクル）**

| メソッド | IPCチャンネル | 方式 | 概要 |
|---------|-------------|------|------|
| `attach()` | channel.attach | invoke | 場への接続（FSM遷移完了を保証。WS接続前に呼ぶ） |
| `detach()` | channel.detach | send | 場からの切断（ウィンドウ閉じ時） |
| `terminate()` | field.terminate | send | 場の終端要求 |

**Renderer → Main（WS接続情報）**

| メソッド | IPCチャンネル | 概要 |
|---------|-------------|------|
| `sessionWsConfig()` | session.ws.config | WS接続先（port, token）を取得 |

**Renderer → Main（FS/Terminal: invoke）**

| メソッド | IPCチャンネル | 概要 |
|---------|-------------|------|
| `fsRootName()` | fs.rootName | Avatar Spaceルートディレクトリ名 |
| `fsList(args)` | fs.list | ディレクトリ一覧 |
| `fsRead(args)` | fs.read | ファイル読み取り |
| `fsWrite(args)` | fs.write | ファイル書き込み |
| `fsImportFile(args)` | fs.importFile | 外部ファイルインポート（バイナリ対応） |
| `fsMutate(args)` | fs.mutate | 構造変更（delete/rename/mkdir/copy） |
| `terminalInput(args)` | terminal.input | PTYへの生データ入力 |
| `terminalResize(args)` | terminal.resize | PTYリサイズ |
| `terminalSnapshot()` | terminal.snapshot | PTY状態スナップショット |

**Main → Renderer（IPC残置: Console固有イベント）**

| メソッド | IPCチャンネル | 概要 |
|---------|-------------|------|
| `onIntegrityAlert(cb)` | integrity.alert | 健全性アラート（alertBar表示用） |
| `onTerminalData(cb)` | terminal.data | PTY出力データストリーム |
| `onTerminalState(cb)` | terminal.state | PTY状態変化（ready/exited） |
| `onThemeChange(cb)` | settings.theme | テーマ変更通知（メニュー操作時） |
| `onLocaleChange(cb)` | settings.locale | 言語変更通知（メニュー操作時、Rendererリロード） |

**WebSocket経由に移行済み（旧IPC）**

| 旧メソッド | 移行先 | 概要 |
|-----------|-------|------|
| `postStream()` → | WS `stream.post` | ユーザーメッセージ送信 |
| `onFieldState()` → | WS `session.state` | 場の状態更新 |
| `onStreamReply()` → | WS `stream.item` | AI応答 |
| `onObservation()` → | WS `monitor.item` | Roblox観測イベント |
| `onXEvent()` → | WS `monitor.item` | Xイベント |
| `respondToolApproval()` → | WS `approval.respond` | ツール承認応答 |

### IPCメッセージ型（shared/ipc-schema.ts）

Zod discriminated unionで定義。Console固有のメッセージのみ。

**Renderer → Main（ToMainMessage）**: channel.attach / channel.detach / field.terminate

**Main → Renderer（ToRendererMessage）**: integrity.alert

### セッションイベント型（shared/session-event-schema.ts）

WebSocket経由で配信されるトランスポート非依存のイベント型。Zodで定義。

| kind | 方向 | 概要 |
|------|------|------|
| `stream.item` | Server → Client | ストリームアイテム（human入力/AI応答。source: user/pulse/xpulse/observation） |
| `monitor.item` | Server → Client | モニターアイテム（Roblox観測/Xイベント） |
| `approval.requested` | Server → Client | ツール承認リクエスト |
| `approval.resolved` | Server → Client | ツール承認結果 |
| `session.state` | Server → Client | セッション状態（接続時初回送信。場の状態+履歴+pendingApprovals） |

## Console UI

### 配信モード

| モード | 起動コマンド | Console UIの配信方法 |
|---|---|---|
| Electron | `npm run dev` / `npm run start:electron` | Electronウィンドウ内でローカル表示 |
| ヘッドレス | `npm start` | HTTPサーバーでブラウザに配信（VPS/ローカル両対応） |

ヘッドレスモードでは `console-http-server.ts` が `out/renderer/` の静的ファイルをHTTP配信する。
Electron preloadの `window.fieldApi` は `/field-api-polyfill.js` でスタブ注入される。
HTTPとWebSocketは同一ポート（SESSION_WS_PORT, デフォルト3002）で提供される。
token認証: `SESSION_WS_TOKEN` 設定時、`?token=xxx` でアクセス → Cookie自動設定。
Cache-Control: no-cache + キャッシュバスター（ポリフィルURL）でCloudflare CDNキャッシュを回避。
devMode注入: DEV_MODEの値をポリフィル経由でブラウザ側に伝播。

### レイアウト（3列7ペイン）

```
┌── Left 15% ───┬── Center 42% ──┬── Right 43% ──┐
│ Avatar        │ Canvas         │ Stream        │
│ (存在提示)    │ (ファイル編集  │ (会話・承認   │
│               │  + 画像昇格)   │  + X投稿)     │
├───────────────┼────────────────┼───────────────┤
│ Space         │ X              │ Terminal       │
│ (FS探索)      │ (X Monitor)    │ (シェル)       │
│               ├────────────────┤               │
│               │ Roblox         │               │
│               │ (Roblox監視)   │               │
└───────────────┴────────────────┴───────────────┘
左・右列: 2ペイン（2行）
中央列: 3ペイン（Canvas / X / Roblox）
```

- 列の意味: 左=存在+探索、中央=作業、右=交流+監視
- 列幅: スプリッタードラッグで自由調整（初期比率 15:42:43）
- 列ごとの行高さ: 各列独立にスプリッタードラッグで調整
- ペインD&D入替: 全7ペインのヘッダーをドラッグ→別ペインにドロップで位置交換（Xペイン含む）
- レイアウト管理: layout-manager.ts（3列可変長配置+入替ロジック）。列構造2/3/2は固定、ペインの配置は自由交換可能

### ペイン

| ペイン | slug | 機能 | 読み/書き |
|---|---|---|---|
| Avatar | avatar | 視覚的存在提示（アバターモーション・リップシンク・瞬き） | 読み取り専用 |
| Space | space | AIの生命活動空間（Avatar Space）の可視化と操作 | 読み書き |
| Canvas | canvas | 主作業領域。ファイル内容表示+画像昇格表示 | 読み書き |
| Stream | stream | 場の全入出力の統合ストリーム（human↔AI対話 + Pulse + 観測 + ツール可視化） | 読み書き |
| Terminal | terminal | 情報空間への能動的介入経路。シェルエミュレータ | 読み書き |
| X | x | Xメンション・イベントログ表示 | 読み取り専用 |
| Roblox | roblox | Roblox観測イベントログ表示 | 読み取り専用 |

### 状態→視覚マッピング（state-normalizer.ts）

| 入力 | 状態 | 色 | 補助 |
|---|---|---|---|
| なし | NORMAL | モノクロ | なし |
| stream.reply | REPLY | --state-info | 未読ドット |
| field.state(稼働) | ACTIVE | --state-info | [RUN] |
| field.state(警告) | WARN | --state-warn | [WARN] |
| integrity.alert | CRITICAL | --state-critical | アラートバー + [ALERT] |

正常時はモノクロ基調（色が出た瞬間に「何かある」と分かる）。

### デザイントークン（TUI-in-GUI）+ テーマシステム

2テーマ: Modern（デフォルト、クール青基調）/ Classic（レトロターミナル風、緑基調）

**テーマ切り替えの仕組み**:
- CSS変数が正本。`:root` = Modern、`[data-theme="classic"]` = Classic
- Mainプロセス: settings-store.ts → data/settings.json に永続化
- メニュー: AUIメニュー内Theme radioで切り替え → IPC `settings.theme` → Renderer
- Renderer: `document.documentElement.dataset.theme` + localStorage（FOUC防止キャッシュ）
- FOUC防止: theme-init.js（publicDir、CSS読込前に同期実行）

**テーマカラー変数**（テーマで変わる）:

| 変数 | Modern | Classic | 用途 |
|------|--------|---------|------|
| `--bg-app` | #0a0d12 | #080a0f | アプリ背景 |
| `--bg-pane` | #0c1118 | #0a0e14 | ペイン背景 |
| `--bg-pane-alt` | #0d1420 | #0e1219 | ヘッダー/代替背景 |
| `--fg-main` | #d3dde6 | #b8c4b8 | 主テキスト |
| `--fg-muted` | #93a4b8 | #7a8a7a | 補助テキスト |
| `--fg-dim` | #6b7a8c | #4a5a4a | 薄いテキスト |
| `--line-default` | #1e2a38 | #1a2a1a | 罫線 |
| `--line-focus` | #3dd6f5 | #00ff41 | フォーカス色 |
| `--state-info/ok/warn/critical` | 青系 | 緑系 | 状態色 |

**拡張子カラー変数**（5カテゴリ、テーマ連動）: `--file-ext-script/image/lua/css/html`

**xterm連動変数**: `--term-bg/fg/cursor/selection`（terminal-pane.tsがgetComputedStyleで読み取り、テーマ変更時に再適用）

**レイアウト定数**（テーマ非依存）: `--border-width/radius`, `--font-mono`, `--font-size`(14px), `--line-height`, `--splitter-width`, `--pane-header-height`。フォント2段構成: 本文14px(`--font-size`) / UI部品12px(固定値)

## LLMツール

AIが呼び出し可能な7ツール。chat-session-service.tsがツール定義をGrok Responses APIに渡し、呼び出し結果をループで処理する。

| ツール名 | 定義ファイル | 機能 |
|---------|------------|------|
| `fs_list` | tools/filesystem-tool.ts | Avatar Space内ディレクトリ一覧 |
| `fs_read` | tools/filesystem-tool.ts | Avatar Space内ファイル読み取り |
| `fs_write` | tools/filesystem-tool.ts | Avatar Space内ファイル書き込み |
| `fs_mutate` | tools/filesystem-tool.ts | Avatar Space内構造変更（delete/rename/mkdir） |
| `terminal` | tools/terminal-tool.ts | シェルコマンド実行 / 直近出力取得 |
| `save_memory` | tools/save-memory-tool.ts | 長期記憶保存（memory.jsonl + Collections API） |
| `roblox_action` | roblox/roblox-action-tool.ts | Roblox空間操作（8カテゴリ: part/terrain/npc/npc_motion/effect/build/spatial/display） |
| `x_post` | tools/x-post-tool.ts | Xポスト作成（280文字以内） |
| `x_reply` | tools/x-reply-tool.ts | Xメンション返信（Phase 2: X事前承認後に有効化） |

### ツール承認フロー

`TOOL_AUTO_APPROVE`（デフォルト: `save_memory,fs_list,fs_read`）に含まれないツールは、実行前にRendererへ承認リクエストを送信し、ユーザーの許可/拒否を待つ。

- 承認ハブ: runtime/approval-hub.ts — 複数承認者（Console WS, Discord等）を動的に登録/解除。first-response-winsで最初の応答を採用。承認者0件なら即deny
- 承認サービス: tool-approval-service.ts — auto-approve判定のみ行い、それ以外はhubに委譲
- 配信経路: event bus → WS `approval.requested`。応答はWS `approval.respond` → approval-hub。Console WS承認者はsession-ws-server.tsで初回接続時に登録
- 拒否時: `{ status: "denied" }` をfunction_call_outputとしてGrokに返却（AIが拒否を踏まえて応答続行）
- Console切断時: Console WS承認者のみ解除。他の承認者がいればpending継続

## Avatar Spaceファイルシステム

### セキュリティ

Avatar Space（`AVATAR_SPACE`環境変数）外へのファイルアクセスは拒否。パスガード`assertInAvatarSpace`がfilesystem-service.ts内に実装（パス正規化 + `fs.realpath`によるシンボリックリンク解決。リンク先がAvatar Space外の場合も拒否）。

例外: `refs/`ディレクトリ配下は**読み取り専用の参照領域**。ユーザーがシンボリックリンクを配置し、AIがfs_read/fs_listで参照できる（例: `ln -s /path/to/repo refs/myrepo`）。書き込み操作（fsWrite/fsMutate/fsImportFile）はアプリ層で拒否。refs/ディレクトリ自体はアプリ起動時に自動作成される。

### 実行方式

ファイル操作はElectron MainのNode.js `fs`モジュールで実行（シェルインジェクション不可）。UIとLLMが同じfilesystem-serviceを共用（SSOT）。

### IPC設計（4チャンネル）

| IPC | 引数 | 戻り値 |
|-----|------|--------|
| `fs.list` | `{ path, depth? }` | `{ path, entries: { name, type, size, mtimeMs }[] }` |
| `fs.read` | `{ path, offset?, limit? }` | `{ path, content, mtimeMs }` |
| `fs.write` | `{ path, content }` | `{ path, bytes, mtimeMs }` |
| `fs.mutate` | `{ op: "delete"\|"rename"\|"mkdir", path, newPath? }` | `{ message }` |

## Terminal

### 実行方式

`node-pty`による持続PTY + xterm.jsでターミナル出力をリアルタイム表示。

- AIと人間が1つのPTYを共有。AIが主ユーザー、人間が補助
- PTYは場のライフサイクルに束縛（場の開始で起動、終了で破棄）
- フルTUI対応: vim/top/less、Tab補完、シェルプロンプト表示が可能
- AI実行時はシェル統合マーカー（OSC 7770シーケンス）でコマンド完了を検知
- AIは`AVATAR_SHELL=on`時のみ実行可能（デフォルトoff）

### AI認識設計

オンデマンド取得（terminalツール: cmd有=共有PTYに書き込み＋完了待ち、cmd無=スクロールバック取得）。AIの実行は人間のTerminalペインにリアルタイムで表示される。

## 長期記憶

### ローカル記憶（memory.jsonl）

memory-log-repository.ts: MemoryRecord（id, text, reason, importance, tags, createdAt）をJSONLで追記保存。チェーン断裂時の復旧コンテキスト素材としても使用（直近10件）。

### リモート記憶（xAI Collections API）

collections-repository.ts: save_memoryツール実行時にCollections APIへもアップロード。2段階処理（files API → documents attach）。XAI_MANAGEMENT_API_KEY + XAI_COLLECTION_IDが設定されている場合のみ有効。

## Roblox連携

### 役割

Robloxは「観測窓」。投影（場→Roblox）＋ 観測（Roblox→場）の双方向。正本は場のみ。

### 出力経路（場→Roblox）

往復回路が意図を決定 → IntentLogに記録（場が正本）→ ProjectorがOpen Cloud Messaging APIでRobloxへ送信。

### 入力経路（Roblox→場）

RobloxがHttpServiceで観測イベントをPOST → 媒体投影で正規化 → 参与文脈 → 再解釈。

### 観測AI転送ポリシー（observation-forwarding-policy.ts）

AIへの転送は異常対応に必要な信号のみに限定する（フィードバックループ防止）。Roblox Monitorペインは常時全イベント表示（ペインの役割: Roblox世界の全入出力）。

#### 観測の意味論分離（v0.3.1）

観測イベントをAIに転送する際、`[観測: eventType]`プレフィックスを付加してAIが「観測情報であり、ユーザーの命令ではない」と認識できるようにする。APIロール上はrole:"user"のまま（OpenAI APIに"observation"ロールは存在しないため、コンテンツレベルで分離）。`sendMessage()`の`_source`引数で意味論的な識別を保持するが、ツール制限等の行動制御には使用しない（設計判断: AIの行動を入力出自で制限しない）。チェーン断裂からの復旧時（`buildRecoveryContext`）も、observation起源のメッセージには`[観測]`プレフィックスを再付与して意味論を保持する。

| イベント | 条件 | AI転送（共振ON時） | Monitor表示 |
|---------|------|-------------------|------------|
| `player_chat` | 常時 | する | する |
| `player_proximity` | 移動中でない | する | する |
| `player_proximity` | npc_motion実行中 | しない（自己起因抑制） | する |
| `command_ack` | `success===true` | しない | する |
| `command_ack` | 失敗 | する | する |
| `npc_follow_event` | `started` / `stopped` | しない | する |
| `npc_follow_event` | `lost` / `path_failed` | する | する |
| `projection_ack` | 成功 | しない | する |
| `projection_ack` | 失敗 | する | する |
| `roblox_log` | 常時 | しない | する |

共振モードがOFFの場合、AI転送列はすべて「しない」になる（知覚は常時ON、注意+表出のみ停止）。

#### 自己起因proximity抑制（motion-state.ts）

go_to_player/follow_player実行中のplayer_proximityイベントはAI転送をスキップする（自分の移動で発生した接近を「新規プレイヤー接近」と誤認してAIが二重応答するのを防止）。

- **抑制開始**: chat-session-service.tsがnpc_motionカテゴリのintent投影成功時に`startSuppression()`
- **抑制解除**: field-runtime.tsが以下のイベントを検知時に`endSuppression()`
  - `command_ack`（op: go_to_player / follow_player）
  - `npc_follow_event`（state: stopped / lost）
- **スコープ**: player_proximityのみ。player_chat等の他の観測は抑制しない

### 通信契約

- AI→Roblox: `{ schema_version, intent_id, category, reason, ops }`（1KB制限）
- Roblox→AI（ACK）: `{ type:"command_ack", payload: { success, data?, error?, meta: { intent_id, op, validation? } } }`

### TypeScript側

| ファイル | 責務 |
|---------|------|
| roblox-action-tool.ts | 7カテゴリ（part, terrain, npc, npc_motion, effect, build, spatial）のツール定義 |
| projector.ts | schema_version=3, intent_id伝播, pending retry |
| intent-log.ts | 投影ログ（roblox-intents.jsonl）の追記保存 |
| observation-server.ts | 観測受信HTTPサーバー（Express） |
| observation-formatter.ts | ACK+観測イベントの表示文字列整形 |
| observation-forwarding-policy.ts | AI転送ポリシー（shouldForwardToAI判定） |
| motion-state.ts | 移動中proximity抑制（インメモリ状態） |
| roblox-messaging.ts | Open Cloud Messaging API呼出（x-api-key認証、20秒タイムアウト） |

### Luauモジュール構成（16ファイル）

Rojo（`rojo serve`）でVSCode→Studioの自動同期。手動コピペ不要。

**Studio前提設定**: HttpService有効化（Game Settings → Security）、DataStore有効化（同 → Security → Enable Studio Access to API Services）

Studio配置:
```
ServerScriptService/AvatarRuntime/    ← Rojo管理
  CommandReceiver (Script)
  ObservationSender (Script)
  Modules/
    Config, CommandRegistry, WorldStore, ObservationClient,
    NpcOps, NpcMotionOps, PartOps, EffectOps, TerrainOps,
    BuildOps, SpatialService, ConstraintSolver, DisplayOps
StarterGui/
  NpcChatDisplay (LocalScript)
```

| ファイル | 責務 |
|---------|------|
| CommandReceiver.server.luau | intentをレジストリ経由で実行し共通ACKを返すエントリポイント |
| ObservationSender.server.luau | チャット/接近/追従状態の観測イベント送信 |
| NpcChatDisplay.client.luau | NPCチャットをRobloxチャットUIに表示 |
| CommandRegistry.luau | カテゴリ+opを実行関数に解決する登録型ルータ |
| ObservationClient.luau | 観測イベントとACK送信の共通HTTPクライアント |
| SpatialService.luau | pose取得・近傍探索・相対距離/方位計算 |
| ConstraintSolver.luau | attach/offset/non_overlapの制約解決+物理検証 |
| NpcMotionOps.luau | go_to_player/follow_player/stop_followingの移動制御 |
| BuildOps.luau | build.apply_constraintsの実行 |
| NpcOps.luau | say/emoteの窓口、移動はNpcMotionOpsへ委譲 |
| PartOps.luau | create/set/delete+演出+永続化の低レベルPart実行器 |
| TerrainOps.luau | terrain操作+apply_constraints |
| EffectOps.luau | エフェクト操作 |
| DisplayOps.luau | SurfaceGuiテキスト表示（set_text/clear） |
| WorldStore.luau | DataStore永続化ラッパー |
| Config.luau | 通信先・検知間隔・しきい値設定（.gitignore、Config.example.luauからコピー） |

### Rojo設定

- default.project.json: ファイルシステム→Studio Instance Treeのマッピング定義
- rokit.toml: ツールチェーン管理（Rojo 7.6.1）
- `$ignoreUnknownInstances: true`: Rojo管理外のStudioコンテンツを保持

### インフラ

- Roblox Studioはlocalhost HTTPをブロックするため、Cloudflare Tunnel経由が必須
- cloudflaredトンネル自動管理（Electronライフサイクル連動、tunnel-manager.ts）
- `--protocol http2`必須（QUIC/UDP 7844は日本のネットワークでブロックされやすい）

### 制約ベース設計

AIは「意図+参照+制約」を出し、Robloxが「座標解決+実行+物理検証」を決定的に行う。

最小制約タイプ:
| type | 意味 |
|------|------|
| `attach` | 面同士を接着 |
| `offset` | 参照点からの相対移動 |
| `non_overlap` | 重なり防止 |

物理検証結果はACKに含めて返却。

### v0.3スコープ

空間認識（SpatialService）、移動・追従（NpcMotionOps）、対話（NpcOps say/emote）。建築・地形操作は実装済みだが品質検証は将来に延期。

## X連携（v0.4）

### 概要

X（Twitter）をチャネルとして統合。Webhook受信でメンションを検知し、AIが応答判断する。Roblox連携と同じイベント駆動パターン。

### 入力経路（X→場）

Account Activity API（Webhook）でメンションを即時受信 → x-webhook-server.ts → field-runtime.ts → AI/表示

- CRC検証（GET）: HMAC-SHA256でcrc_tokenに応答
- 署名検証（POST）: HMAC-SHA256でペイロード署名を検証
- 自己投稿フィルタ: X_USER_IDと一致するツイートはスキップ（フィードバックループ防止）
- 重複排除: x-dedupe-repository.ts（ファイル永続化、最大10,000件）

### 出力経路（場→X）

- x_post: AIが自発的にポスト（Phase 1、承認不要で即日運用可）
- x_reply: メンションへの返信（X連携有効時に利用可能、TOOL_AUTO_APPROVEで自動実行制御）
- OAuth 1.0a HMAC-SHA1署名でX API v2を呼出

### InputGate（ツール権限制御）

source + channel + roleの組み合わせでAIが使用可能なツールを制限する二重防御。

#### InputRole（オーナー判定）

各入力チャネルで入力者のロールを判定する（input-role-resolver.ts）:

| チャネル | 判定方法 | 未設定時 |
|---------|---------|---------|
| Console | SESSION_WS_TOKEN認証済み → 常にowner | - |
| Pulse | 内部トリガー → 常にowner | - |
| Discord | DISCORD_OWNER_IDとの一致 | 全員external |
| Roblox | ROBLOX_OWNER_USER_IDとの一致 | 全員external |
| X | X_OWNER_USER_IDとの一致 | 全員external |

fail-closed設計: オーナーID環境変数が未設定の場合、そのチャネルからの入力は全てexternal扱い。

#### ツール許可マトリクス

| role | source | 許可ツール |
|------|--------|-----------|
| owner | 任意 | 全ツール |
| - | user/pulse/xpulse | 全ツール（roleを無視） |
| external | observation/roblox | roblox_actionのみ |
| external | observation/x | x_replyのみ |
| external | observation/console,discord | なし（テキスト応答のみ） |

ホワイトリストはハードコード（.envで緩和不可 = プロンプトインジェクション耐性）。

二重防御: ①ツール一覧から除外（AIが知覚しない）②実行時チェック（万が一の漏れ防止）

### TypeScript側

| ファイル | 責務 |
|---------|------|
| x-api-repository.ts | OAuth 1.0a署名 + X API v2呼出（createPost/createReply） |
| x-webhook-server.ts | Account Activity API Webhookサーバー（CRC + 署名検証 + イベント解析） |
| x-event-formatter.ts | XMentionEvent型 + 表示/AI入力文整形 |
| x-forwarding-policy.ts | XイベントのAI転送ポリシー |
| x-dedupe-repository.ts | tweet_id重複排除（ファイル永続化） |
| x-post-tool.ts | x_postツール定義（280文字制限） |
| x-reply-tool.ts | x_replyツール定義（Phase 2） |
| input-gate.ts | source+channel+roleベースのツール権限制御 |
| input-role-resolver.ts | InputRole解決（各チャネルのオーナー判定） |

## 設定管理

### 設定の2層分離

| 層 | 正本 | 性質 | 例 |
|---|---|---|---|
| **デプロイ設定** | .env → config.ts | インスタンス固有（シークレット・インフラ・ID） | APIキー、ポート、アバター名 |
| **ユーザー嗜好** | settings.json → settings-store.ts | ランタイム変更可能（メニューから切替） | テーマ、モデル、言語、共振 |

ユーザー嗜好のデフォルト値はsettings-store.tsにハードコード。.envには持たない（SSOT違反防止）。

### 環境変数一覧

`.env`をデプロイ設定の入口とし、`config.ts`の`getConfig()`遅延singletonで一元管理。Zodスキーマでバリデーション。空文字→undefined変換（`KEY=`をoptionalとして扱う）。

| 環境変数 | 必須 | デフォルト | 概要 |
|---------|------|----------|------|
| `XAI_API_KEY` | 必須 | — | Grok API認証キー |
| `XAI_MANAGEMENT_API_KEY` | — | — | xAI Collections API管理キー |
| `XAI_COLLECTION_ID` | — | — | xAI Collection ID |
| `ROBLOX_API_KEY` | — | — | Roblox Open Cloud APIキー |
| `ROBLOX_UNIVERSE_ID` | — | — | Roblox Universe ID |
| `ROBLOX_OBSERVATION_SECRET` | — | — | 観測送信の認証シークレット |
| `ROBLOX_OWNER_DISPLAY_NAME` | — | — | Robloxオーナーの表示名 |
| `CLOUDFLARED_TOKEN` | — | — | Cloudflare Tunnelトークン |
| `X_CONSUMER_KEY` | — | — | X OAuth 1.0a Consumer Key |
| `X_CONSUMER_SECRET` | — | — | X OAuth 1.0a Consumer Secret |
| `X_ACCESS_TOKEN` | — | — | X OAuth 1.0a Access Token |
| `X_ACCESS_TOKEN_SECRET` | — | — | X OAuth 1.0a Access Token Secret |
| `X_WEBHOOK_SECRET` | — | — | X Webhook署名検証シークレット |
| `X_USER_ID` | — | — | X自己ユーザーID（自己投稿フィルタ用） |
| `X_WEBHOOK_PORT` | — | `"3001"` | X Webhookサーバーポート |
| `AVATAR_NAME` | — | `"Avatar"` | アバター名（UI表示用） |
| `USER_NAME` | — | `"User"` | ユーザー名（UI表示用） |
| `AVATAR_SPACE` | — | `~/Avatar/space` | Avatar Spaceルートパス |
| `ROBLOX_OBSERVATION_PORT` | — | `"3000"` | 観測サーバーポート |
| `AVATAR_DIR` 配下 | — | `${AVATAR_DIR}/pulse/` | パルスディレクトリ（各.mdファイルがcronタスク。AVATAR_DIRから自動導出） |
| `TERMINAL_SHELL` | — | OS自動検出（`$SHELL`） | ターミナルのシェル |
| `AVATAR_SHELL` | — | `"off"` | AIのシェル実行権限（on/off） |
| `DEV_MODE` | — | `"off"` | 開発者モード（on: 詳細ログ + ソースタグ表示 + Roblox Monitor全表示） |
| `DISCORD_OWNER_ID` | — | — | DiscordオーナーのユーザーID（オーナー判定用。未設定時は全員external） |
| `ROBLOX_OWNER_USER_ID` | — | — | RobloxオーナーのUserID（オーナー判定用。未設定時は全員external） |
| `X_OWNER_USER_ID` | — | — | XオーナーのユーザーID（オーナー判定用。未設定時は全員external） |

機能有効化の判定:
- `isRobloxEnabled()`: ROBLOX_API_KEY + ROBLOX_UNIVERSE_ID の両方が設定されている場合
- `isXEnabled()`: X_CONSUMER_KEY + X_CONSUMER_SECRET + X_ACCESS_TOKEN + X_ACCESS_TOKEN_SECRET + X_USER_ID の全てが設定されている場合
- `isCollectionsEnabled()`: XAI_MANAGEMENT_API_KEY + XAI_COLLECTION_ID の両方が設定されている場合
- `isDiscordEnabled()`: DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID の両方が設定されている場合

### ensureDirectories()

起動時ディレクトリ保証:
- `data/`: 常に暗黙作成
- `AVATAR_SPACE`: デフォルト値→暗黙作成、明示設定→存在チェック+fail-fast

### ランタイム設定（settings-store.ts）

テーマ・モデル・言語・共振モードの4設定はメニューからランタイムで変更可能。`data/settings.json`に永続化。

| 設定 | デフォルト | 変更手段 | 反映先 |
|------|----------|---------|--------|
| theme | `"modern"` | AUIメニュー > Theme radio | Renderer（CSS変数 + xterm） |
| model | `"grok-4-1-fast-non-reasoning"` | AUIメニュー > Model radio | chat-session-service.ts（次のAPI呼出から反映） |
| locale | `"ja"` | AUIメニュー > Language radio | 全テキスト（i18n辞書。変更時Rendererリロード） |
| resonance | `false` | AUIメニュー > Resonance checkbox | field-runtime.ts（観測→AI転送ゲート。即時反映） |

起動時: `loadSettings(dataDir)` でsettings.jsonを読み込み。ファイルが存在しない場合はハードコードのデフォルト値を使用。デフォルト値はsettings-store.tsのDEFAULTS定数が正本（.envからは取らない）。

### Electronメニュー（menu.ts）

`productName: "AUI"`（package.json）でmacOSアプリメニュー名を"AUI"に変更。

```
AUI
├── About Avatar UI
├── Theme ▸ Modern / Classic (radio)
├── Model ▸ grok-4-1-fast-reasoning / grok-4-1-fast-non-reasoning (radio)
├── Language ▸ 日本語 / English (radio)
├── ───
├── Resonance (checkbox)
├── ───
├── Hide / Hide Others / Quit
Edit（標準）
View（標準 + DevTools）
Window（標準）
```

### Renderer側の設定参照

`field.state` IPCメッセージに`avatarName`/`userName`を含め、ラベルを動的表示。Rendererは直接process.envを参照しない。

## ロギング（logger.ts）

| 関数 | 用途 | stderr出力 |
|------|------|-----------|
| `info(msg)` | 通常ログ | DEV_MODE=on時のみ |
| `error(msg)` | エラーログ | 常に出力 |
| `fatal(msg)` | 致命的エラー（process.exit(1)） | 常に出力 |

全レベルが`data/app.log`にファイル追記される。config.tsはloggerより先に初期化されるため、config.ts自身はstderrに直接出力する。

## 共通型（shared/）

| ファイル | 内容 |
|---------|------|
| channel.ts | ChannelId型（"console" / "roblox" / "x" / "discord"）のSSOT |
| ipc-schema.ts | IPC全メッセージのZodスキーマ + FieldState/FieldEvent/AlertCode型 |
| fs-schema.ts | FS操作の引数・戻り値のZodスキーマ |
| terminal-schema.ts | Terminal操作の引数・戻り値のZodスキーマ |
| participation-context.ts | ParticipationInput型・correlationId生成（UUID/pulse-*/xpulse-*/obs-*） |
| i18n.ts | i18n辞書+t()関数。Locale型（"ja"/"en"）、setLocale/getLocale。Main/Renderer共用 |

AppResult<T>型（types/result.ts）: `{ success: true, data: T }` / `{ success: false, error: { code, message } }`。ok()/fail()ヘルパー付き。

## 参与文脈（③）

### ParticipationInput型

`actor` / `source` / `correlationId` / `channel` / `timestamp` / `text`を構造化。全起点（chat/pulse/observation）に共通の場状態ゲートを適用。correlationIdは入力時に確定し、AI応答まで同一IDで貫通保持。

correlationId形式: user=UUID, pulse=`pulse-*`, xpulse=`xpulse-*`, observation=`obs-*`

## 場FSM

`generated → active → paused → resumed → active / → terminated`

field-fsm.tsで純関数transitionとして実装。

## セッション永続化

### State型（場/参与者分離）

state-repository.tsのState型は場側（field）と参与者側（participant）を概念分離:

```ts
State = {
  schemaVersion: 1,
  field: {
    state: string,                          // FieldState（generated/active/paused/resumed/terminated）
    messageHistory: PersistedMessage[],     // 直近120件、UI再同期+チェーン断裂復旧素材
    observationHistory: PersistedMonitorEvent[], // Roblox Monitor履歴（直近50件、UI再描画用）
    xEventHistory: PersistedMonitorEvent[],      // X Monitor履歴（直近50件、UI再描画用）
  },
  participant: {
    lastResponseId: string | null,   // Grok Responses APIチェーンID
    lastResponseAt: string | null,   // ISO8601（チェーンTTL判定用）
  },
}
```

旧形式 `{ lastResponseId }` からの自動マイグレーション対応。atomic write（tmp→rename）+ 1世代バックアップ（.prev）。

### 永続化の耐障害性

**1世代バックアップ**: saveState()は毎回、現行state.jsonを.prevにrenameしてから新版を書く。ファイルシステムのrename操作のみでI/Oコスト実質ゼロ。

**破損フォールバック**: loadState()は3段階で復帰を試みる:
1. state.json → 正常なら使用
2. state.jsonがJSON破損 → .corruptedにリネーム → state.json.prevを試行
3. .prevも読めない → defaultState()（新規状態）

戻り値は`LoadStateResult = { state, recoveredFromPrev }`。.prevフォールバック時はrecoveredFromPrev=trueとなり、field-runtime.tsがwarn通知（凍結なし、次の入力は受け付ける）。

### 起動時補正（field-runtime.ts correctStateOnStartup()）

- active/resumed → paused（Main終了 = 暗黙のdetach、異常終了検知）
- terminated → 維持（attach時にresetToNewField()で新規場）
- チェーンTTL超過（30日） → lastResponseIdをnull化

### safeDetach（ipc-handlers.ts）

冪等なdetach処理。active/resumed以外はno-op（ガード）。以下の全箇所から安全に呼び出し可能:
- `channel.detach` IPC（Renderer起点）
- `mainWindow.on("close")`（ウィンドウ閉じ）
- `app.on("before-quit")`（アプリ終了）
- `render-process-gone`（レンダラクラッシュ）

### attach時の状態復元

`channel.attach`ハンドラ:
1. terminated → resetToNewField()（新規場、参与者チェーンもリセット）
2. transition(fieldState, "attach") → generated→active / paused→resumed
3. resumed → active自動遷移
4. 永続化されたmessageHistoryをRendererに送信（UI再同期）

### チェーン断裂の自動回復（chat-session-service.ts）

Grok Responses APIの`previous_response_id`が無効/期限切れの場合（400/404エラー）:

1. 断裂検知（isChainBreakError: status 400 or 404）
2. lastResponseIdをnull化
3. 復旧コンテキスト構築: being + memory.jsonl直近10件 + messageHistory直近20件 + 今回の入力
4. 新チェーンで再試行（previous_response_idなし）
5. 成功 → 新チェーンで継続。失敗 → throw → 凍結

## 健全性管理（⑥ IntegrityManager）

### 目的

場の連続運転の保全。共存故障を検知し、通知し、壊れた操作を凍結する。

### v0.3の機構

検知+通知+凍結+修復ポリシー宣言。自動復旧の実行体（RuntimeCoordinator）はv0.4以降。

### 通知の2段階: warn（警告）と report（凍結）

| 関数 | 用途 | 凍結 |
|---|---|---|
| `warn(code, message)` | 外部障害（APIタイムアウト、通信エラー、state破損復帰）。次の入力は受け付ける | なし |
| `report(code, message)` | 場の整合性破壊（FSM不正遷移、state保存失敗）。再起動が必要 | あり |

```
warn:   検知 → ログ出力 → alertBar表示（i18n翻訳メッセージ） → 次の入力を受け付ける
report: 検知 → ログ出力 → alertBar表示（i18n翻訳メッセージ） → 凍結ラッチON → 復帰は再起動
```

### 修復ポリシー（RECOVERY_POLICY）

各AlertCodeに対して修復方針をRECOVERY_POLICY定数で宣言（integrity-manager.ts）:

```ts
RECOVERY_POLICY: Record<AlertCode, { action: "continue" | "freeze" }>
```

- `action: "continue"` → warn（次の入力で自然回復）
- `action: "freeze"` → report（再起動が必要）
- ユーザー向けメッセージはi18n辞書（`alert.${code}`キー）から取得。sink経由でRendererに表示

ポリシーはv0.3では宣言のみ。RuntimeCoordinatorがポリシーを参照して自動復旧を発行する機構はv0.4で追加予定。

### AlertCode一覧

| AlertCode | 不変条件 | 検知箇所 | 通知種別 |
|---|---|---|---|
| FIELD_CONTRACT_VIOLATION | 場契約整合性 | ipc-handlers.ts FSM catch | report（凍結） |
| RECIPROCITY_STREAM_ERROR | 往復連接性 | ipc-handlers.ts stream catch | warn（非凍結） |
| RECIPROCITY_PULSE_ERROR | 往復連接性 | field-runtime.ts Pulse catch | warn（非凍結） |
| RECIPROCITY_OBSERVATION_ERROR | 往復連接性 | field-runtime.ts 観測 catch | warn（非凍結） |
| COEXISTENCE_STATE_LOAD_CORRUPTED | 共存連続性 | field-runtime.ts initRuntime | warn（非凍結、.prevから自動復帰済み） |
| COEXISTENCE_STATE_SAVE_FAILED | 共存連続性 | field-runtime.ts persistState | report（凍結） |

### API呼び出しタイムアウト

全ての外部API呼び出しにタイムアウトを設定し、無応答でキューがブロックされることを防止する。

| 呼び出し先 | タイムアウト | リトライ | 設定箇所 |
|---|---|---|---|
| Grok Responses API | 20秒 | なし（maxRetries: 0） | chat-session-service.ts |
| Roblox Open Cloud API | 20秒 | なし | roblox-messaging.ts（AbortSignal.timeout） |
| Terminal AI実行 | AI指定（timeoutMs、デフォルト30秒） | なし | terminal-service.ts |

タイムアウト時はthrowしてそのジョブだけ失敗終了。warn()でUI通知し、次の入力は正常に処理する。

### 凍結ラッチ

`integrity-manager.ts`の`frozen`フラグ。一度`report()`が呼ばれるとtrueになり、以下を遮断:
- `ipc-handlers.ts`: stream.post受信時に`isFrozen()`チェック → 拒否
- `field-runtime.ts`: `enqueue()`実行前に`isFrozen()`チェック → スキップ（onSkipコールバックでprocessStreamのPromiseをreject）
- Renderer: alertBar表示 + 入力disabled

凍結はFSM不正遷移やstate破損など場の整合性破壊に限定。APIタイムアウト等の一時障害では凍結しない。

### 縮退運用

凍結後は入力が無効化され、再起動以外の復帰手段はない。v0.3では選択肢UI（バックアップ復元等）は提供しない。ユーザーはアプリを再起動して復帰する。

## 受入テスト（S1-S5）

`src/main/acceptance/` に5シナリオ37テスト（v0.3）。v0.4でXモジュール群にユニットテスト20件を追加（合計304件/33ファイル）。モジュール間の統合動作を検証する。

| ファイル | シナリオ | 検証対象 | テスト数 |
|---------|---------|---------|---------|
| s1-field-contract | S1: 場契約整合性 | ipc-handlers + field-fsm + integrity-manager | 11 |
| s2-mode-reachability | S2: モード可達性 | 3入力経路の区別と投影 + 移動中proximity抑制 | 10 |
| s3-reciprocity-linkage | S3: 往復連接性 | enqueue直列化 + エラー耐性 | 5 |
| s4-coexistence-continuity | S4: 共存連続性 | state-repository + field-runtime の永続化・復元 | 6 |
| s5-lifecycle | S5: ライフサイクル完走 | 全遷移の統合テスト | 5 |

モック戦略: S1/S5はfield-runtimeをモック（FSM統合を検証）、S2/S3/S4はfield-runtimeを実物で使用し深い依存（OpenAI/cron/sendMessage/観測サーバー）をモック。`_harness.ts`に共有モック・ヘルパーを集約。

## SSOT一覧

| 情報 | 正本の場所 |
|------|-----------|
| 設定値・環境変数 | .env + config.ts（getConfig()） |
| ランタイム設定（テーマ・モデル・言語・共振） | data/settings.json + settings-store.ts |
| 現在の状態（場+参与者） | data/state.json（場状態・会話履歴・チェーンID） |
| 長期記憶 | data/memory.jsonl + xAI Collections API |
| アプリログ | data/app.log |
| Roblox投影ログ | data/roblox-intents.jsonl |
| X重複排除 | data/x-seen-tweets.json |
| プロジェクト戦略 | docs/PROJECT.md |
| 現行アーキテクチャ | docs/architecture.md（本文書） |
| 次版計画 | docs/PLAN.md |
| 人格定義 | BEING.md（AVATAR_DIR設定時は$AVATAR_DIR/BEING.md） |
| Pulse定義 | pulse/ディレクトリ（PULSE_DIR設定時はそのパス、未設定時は$AVATAR_DIR/pulse/）|
| Rojo設定（Studio同期） | default.project.json |
