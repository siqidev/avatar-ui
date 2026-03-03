# アーキテクチャ（v0.3）

> 現行実装の事実記述。設計意図・決定背景はPROJECT.md Decision Logを参照。

## ファイル構成

```
src/
  config.ts                   環境変数→AppConfig（唯一のprocess.env入口）
  logger.ts                   ロギング（info/error/fatal → data/app.log）
  main/
    index.ts                  Electron Mainエントリーポイント
    field-runtime.ts          FieldRuntime（場のロジック統合）
    ipc-handlers.ts           IPC受信→FieldRuntimeオーケストレーション
    field-fsm.ts              場FSM（純関数transition）
    integrity-manager.ts      健全性管理（warn/report/凍結ラッチ）
    channel-projection.ts     媒体投影（Renderer送信+メッセージ整形）
    message-recorder.ts       履歴記録（永続化付き）
    filesystem-service.ts     Avatar Spaceファイル操作
    fs-ipc-handlers.ts        FS系IPC処理
    terminal-service.ts       Terminal実行・出力管理
    terminal-ipc-handlers.ts  Terminal系IPC処理
    tunnel-manager.ts         cloudflaredトンネル管理
    acceptance/               受入テスト（S1-S5）
  preload/
    index.ts                  contextBridge経由のAPI公開
  renderer/
    main.ts                   Rendererエントリーポイント（ペイン初期化）
    layout-manager.ts         2×3グリッド配置+ペインD&D入替
    state-normalizer.ts       IPC入力→視覚状態マッピング（優先度ロジック）
    canvas-pane.ts            Canvasペイン
    canvas-focus-stack.ts     Canvas上のフォーカス履歴管理（スタック）
    filesystem-pane.ts        Spaceペイン
    terminal-pane.ts          Terminalペイン（xterm.js）
    style.css                 デザイントークン+レイアウト
  services/
    chat-session-service.ts   Grok Responses API呼出+ツール実行ループ
  roblox/
    roblox-action-tool.ts     AIツール定義（7カテゴリ）
    projector.ts              Robloxへの意図送信（Open Cloud Messaging）
    intent-log.ts             投影ログ（roblox-intents.jsonl）
    observation-server.ts     観測受信HTTPサーバー
    observation-formatter.ts  観測イベント→表示文字列整形
    roblox-messaging.ts       Open Cloud Messaging API呼出
  tools/
    filesystem-tool.ts        LLMツール: fs_list/fs_read/fs_write/fs_mutate
    roblox-action-tool.ts     → src/roblox/ に配置
    terminal-tool.ts          LLMツール: terminal
    save-memory-tool.ts       LLMツール: save_memory
  memory/
    memory-log-repository.ts  memory.jsonl読み書き
    memory-record.ts          MemoryRecord型・ID生成
  collections/
    collections-repository.ts xAI Collections API（files→documents）
  shared/
    ipc-schema.ts             IPC型定義（Zod + discriminated union）
    fs-schema.ts              FS操作型定義（Zod）
    terminal-schema.ts        Terminal操作型定義（Zod）
    participation-context.ts  ParticipationInput型・correlationId生成
  state/
    state-repository.ts       state.json永続化（atomic write+バックアップ）
  types/
    result.ts                 AppResult<T>型（Ok/Fail）
roblox/                       Roblox Studio用Luauスクリプト群（Rojo管理）
```

## プロセス構成

### Electron

FieldRuntime（場の全ロジック）をElectron Mainプロセス内に同居＋論理分離。Rendererは薄いIPCクライアント。

- **Main**: FieldRuntime（6要素）、Pulse(cron)、観測受信(HTTP)、Grok API呼出、永続化
- **Renderer**: 6ペインの描画＋ユーザー入力の送信＋イベント購読のみ
- **媒体投影**: channel-projection.ts（ChannelProjection）がRenderer送信＋メッセージ整形を集約。ipc-handlersはオーケストレーションのみ。新チャネル追加時はChannelProjection実装を追加しipc-handlers無変更
- **履歴記録**: message-recorder.ts（recordMessage）が永続化付き履歴記録を提供。ipc-handlersはappendMessageを直接呼ばない
- ウィンドウ閉じ = channel.detach（Mainは生存しタスクトレイ常駐）、再度開き = channel.attach + 状態再同期
- セキュリティ: nodeIntegration:false / contextIsolation:true / sandbox:true

## IPC

### プロトコル

メッセージ形式: `{ type, actor?, correlationId?, ...ペイロード }`。typeは `<domain>.<action>` の2語。Zod検証必須（shared/ipc-schema.ts）。トランスポートはElectron標準IPC。

### Preload API（src/preload/index.ts）

contextBridge経由でRendererに公開する最小API。ipcRendererの直接公開は禁止。

**Renderer → Main（送信: fire-and-forget）**

| メソッド | IPCチャンネル | 概要 |
|---------|-------------|------|
| `attach()` | channel.attach | 場への接続（ウィンドウ表示時） |
| `detach()` | channel.detach | 場からの切断（ウィンドウ閉じ時） |
| `postStream(text, correlationId)` | stream.post | ユーザーメッセージ送信 |
| `terminate()` | field.terminate | 場の終端要求 |

**Renderer → Main（request-response: invoke）**

| メソッド | IPCチャンネル | 概要 |
|---------|-------------|------|
| `fsRootName()` | fs.rootName | Avatar Spaceルートディレクトリ名 |
| `fsList(args)` | fs.list | ディレクトリ一覧 |
| `fsRead(args)` | fs.read | ファイル読み取り |
| `fsWrite(args)` | fs.write | ファイル書き込み |
| `fsMutate(args)` | fs.mutate | 構造変更（delete/rename/mkdir） |
| `terminalExec(args)` | terminal.exec | コマンド実行 |
| `terminalStdin(args)` | terminal.stdin | 実行中プロセスへのstdin送信 |
| `terminalStop(args)` | terminal.stop | 実行中プロセスの停止 |
| `terminalResize(args)` | terminal.resize | ターミナルサイズ変更 |
| `terminalSnapshot()` | terminal.snapshot | ターミナル状態スナップショット |

**Main → Renderer（イベント購読: on）**

| メソッド | IPCチャンネル | 概要 |
|---------|-------------|------|
| `onFieldState(cb)` | field.state | 場の状態更新（avatarName/userName含む） |
| `onStreamReply(cb)` | stream.reply | AI応答（source: user/pulse/observation） |
| `onIntegrityAlert(cb)` | integrity.alert | 健全性アラート（alertBar表示用） |
| `onObservation(cb)` | observation.event | Roblox観測イベント |
| `onTerminalOutput(cb)` | terminal.output | コマンド出力ストリーム |
| `onTerminalLifecycle(cb)` | terminal.lifecycle | コマンド開始/終了通知 |
| `onTerminalSnapshot(cb)` | terminal.snapshot | ターミナル状態復元用 |

### IPCメッセージ型（shared/ipc-schema.ts）

Zod discriminated unionで定義。

**Renderer → Main（ToMainMessage）**: channel.attach / channel.detach / stream.post / field.terminate

**Main → Renderer（ToRendererMessage）**: stream.reply / field.state / integrity.alert / observation.event

## Console UI

### レイアウト（3列6ペイン、2行×3列）

```
┌── Left 15% ───┬── Center 42% ──┬── Right 43% ──┐
│ Avatar        │ Canvas         │ Stream        │
│ (存在提示)    │ (ファイル編集  │ (会話・承認   │
│               │  + 画像昇格)   │  + X投稿)     │
├───────────────┼────────────────┼───────────────┤
│ Space         │ Roblox         │ Terminal       │
│ (FS探索)      │ (監視)         │ (シェル)       │
└───────────────┴────────────────┴───────────────┘
行比率: 上65% / 下35%
```

- 列の意味: 左=存在+探索、中央=作業、右=交流+監視
- 列幅: スプリッタードラッグで自由調整（初期比率 15:42:43）
- 列ごとの行高さ: 各列独立にスプリッタードラッグで調整
- ペインD&D入替: ペインヘッダーをドラッグ→別ペインにドロップで位置交換
- レイアウト管理: layout-manager.ts（グリッド配置+入替ロジック）

### ペイン

| ペイン | slug | 機能 | 読み/書き |
|---|---|---|---|
| Avatar | avatar | 視覚的存在提示（リップシンク・状態表示） | 読み取り専用 |
| Space | space | AIの生命活動空間（Avatar Space）の可視化と操作 | 読み書き |
| Canvas | canvas | 主作業領域。ファイル内容表示+画像昇格表示 | 読み書き |
| Stream | stream | 場の全入出力の統合ストリーム（human↔AI対話 + Pulse + 観測 + ツール可視化） | 読み書き |
| Terminal | terminal | 情報空間への能動的介入経路。シェルエミュレータ | 読み書き |
| Roblox | roblox | 観測イベントログ表示 | 読み取り専用 |

### 状態→視覚マッピング（state-normalizer.ts）

| 入力 | 状態 | 色 | 補助 |
|---|---|---|---|
| なし | NORMAL | モノクロ | なし |
| stream.reply | REPLY | --state-info | 未読ドット |
| field.state(稼働) | ACTIVE | --state-info | [RUN] |
| field.state(警告) | WARN | --state-warn | [WARN] |
| integrity.alert | CRITICAL | --state-critical | アラートバー + [ALERT] |

正常時はモノクロ基調（色が出た瞬間に「何かある」と分かる）。

### デザイントークン（TUI-in-GUI）

```css
:root {
  --bg-app: #0a0d12;  --bg-pane: #0c1118;  --bg-pane-alt: #0d1420;
  --fg-main: #d3dde6;  --fg-muted: #93a4b8;  --fg-dim: #6b7a8c;
  --line-default: #1e2a38;  --line-focus: #3dd6f5;
  --state-info: #22d3ee;  --state-ok: #34d399;  --state-warn: #f59e0b;  --state-critical: #f43f5e;
  --border-width: 1px;  --border-radius: 0;
  --font-mono: "Iosevka Term", "JetBrains Mono", "Cascadia Mono", monospace;
  --font-size: 13px;  --line-height: 1.45;
}
```

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
| `roblox_action` | roblox/roblox-action-tool.ts | Roblox空間操作（7カテゴリ: part/terrain/npc/npc_motion/effect/build/spatial） |

## Avatar Spaceファイルシステム

### セキュリティ

Avatar Space（`AVATAR_SPACE`環境変数）外へのファイルアクセスは拒否。パスガード`assertInAvatarSpace`がfilesystem-service.ts内に実装（パス正規化 + `fs.realpath`によるシンボリックリンク解決。リンク先がAvatar Space外の場合も拒否）。

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

`child_process.spawn`（Node.js標準API）+ xterm.jsでコマンド出力をリアルタイム表示。

- ネイティブモジュール不要、ビルド問題ゼロ
- AI/人間ともにコマンド実行→出力表示が可能（AIは`AVATAR_SHELL=on`時のみ。デフォルトoff）
- AI実行時はallowlist方式で環境変数をサニタイズ（PATH/HOME/SHELL等のみ。APIキー露出防止）
- 制約: PTYなし。vim/top/less等のフルスクリーンTUI、Tab補完、シェルプロンプト表示は不可

### AI認識設計

CommandRecord（完了済みサマリ）。自動注入なし、オンデマンド取得（terminalツール: cmd有=実行、cmd無=出力取得）。

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
    BuildOps, SpatialService, ConstraintSolver
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

## 設定管理

### 環境変数一覧

`.env`を唯一の設定入口とし、`config.ts`の`getConfig()`遅延singletonで一元管理。Zodスキーマでバリデーション。空文字→undefined変換（`KEY=`をoptionalとして扱う）。

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
| `AVATAR_NAME` | — | `"Avatar"` | アバター名（UI表示用） |
| `USER_NAME` | — | `"User"` | ユーザー名（UI表示用） |
| `GROK_MODEL` | — | `"grok-4-1-fast-non-reasoning"` | 使用モデル |
| `AVATAR_SPACE` | — | `~/Avatar/space` | Avatar Spaceルートパス |
| `ROBLOX_OBSERVATION_PORT` | — | `"3000"` | 観測サーバーポート |
| `PULSE_CRON` | — | `"*/30 * * * *"` | Pulse発火間隔（cron式） |
| `TERMINAL_SHELL` | — | `"zsh"` | ターミナルのシェル |
| `AVATAR_SHELL` | — | `"off"` | AIのシェル実行権限（on/off） |
| `LOG_VERBOSE` | — | `"false"` | INFOレベルのstderr出力 |

機能有効化の判定:
- `isRobloxEnabled()`: ROBLOX_API_KEY + ROBLOX_UNIVERSE_ID の両方が設定されている場合
- `isCollectionsEnabled()`: XAI_MANAGEMENT_API_KEY + XAI_COLLECTION_ID の両方が設定されている場合

### ensureDirectories()

起動時ディレクトリ保証:
- `data/`: 常に暗黙作成
- `AVATAR_SPACE`: デフォルト値→暗黙作成、明示設定→存在チェック+fail-fast

### Renderer側の設定参照

`field.state` IPCメッセージに`avatarName`/`userName`を含め、ラベルを動的表示。Rendererは直接process.envを参照しない。

## ロギング（logger.ts）

| 関数 | 用途 | stderr出力 |
|------|------|-----------|
| `info(msg)` | 通常ログ | LOG_VERBOSE=true時のみ |
| `error(msg)` | エラーログ | 常に出力 |
| `fatal(msg)` | 致命的エラー（process.exit(1)） | 常に出力 |

全レベルが`data/app.log`にファイル追記される。config.tsはloggerより先に初期化されるため、config.ts自身はstderrに直接出力する。

## 共通型（shared/）

| ファイル | 内容 |
|---------|------|
| ipc-schema.ts | IPC全メッセージのZodスキーマ + FieldState/FieldEvent/AlertCode型 |
| fs-schema.ts | FS操作の引数・戻り値のZodスキーマ |
| terminal-schema.ts | Terminal操作の引数・戻り値のZodスキーマ |
| participation-context.ts | ParticipationInput型・correlationId生成（UUID/pulse-*/obs-*） |

AppResult<T>型（types/result.ts）: `{ success: true, data: T }` / `{ success: false, error: { code, message } }`。ok()/fail()ヘルパー付き。

## 参与文脈（③）

### ParticipationInput型

`actor` / `source` / `correlationId` / `channel` / `timestamp` / `text`を構造化。全起点（chat/pulse/observation）に共通の場状態ゲートを適用。correlationIdは入力時に確定し、AI応答まで同一IDで貫通保持。

correlationId形式: user=UUID, pulse=`pulse-*`, observation=`obs-*`

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
    state: string,                // FieldState（generated/active/paused/resumed/terminated）
    messageHistory: PersistedMessage[],  // 直近120件、UI再同期+チェーン断裂復旧素材
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
warn:   検知 → ログ出力 → alertBar表示（userMessage） → 次の入力を受け付ける
report: 検知 → ログ出力 → alertBar表示（userMessage） → 凍結ラッチON → 復帰は再起動
```

### 修復ポリシー（RECOVERY_POLICY）

各AlertCodeに対して修復方針をRECOVERY_POLICY定数で宣言（integrity-manager.ts）:

```ts
RECOVERY_POLICY: Record<AlertCode, { action: "continue" | "freeze", userMessage: string }>
```

- `action: "continue"` → warn（次の入力で自然回復）
- `action: "freeze"` → report（再起動が必要）
- `userMessage` → ユーザー向けの原因+対処メッセージ。sink経由でRendererに表示

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
| Terminal実行 | AI指定（timeoutMs） | なし | terminal-service.ts |

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

`src/main/acceptance/` に5シナリオ34テスト。モジュール間の統合動作を検証する。

| ファイル | シナリオ | 検証対象 | テスト数 |
|---------|---------|---------|---------|
| s1-field-contract | S1: 場契約整合性 | ipc-handlers + field-fsm + integrity-manager | 11 |
| s2-mode-reachability | S2: モード可達性 | 3入力経路の区別と投影 | 7 |
| s3-reciprocity-linkage | S3: 往復連接性 | enqueue直列化 + エラー耐性 | 5 |
| s4-coexistence-continuity | S4: 共存連続性 | state-repository + field-runtime の永続化・復元 | 6 |
| s5-lifecycle | S5: ライフサイクル完走 | 全遷移の統合テスト | 5 |

モック戦略: S1/S5はfield-runtimeをモック（FSM統合を検証）、S2/S3/S4はfield-runtimeを実物で使用し深い依存（OpenAI/cron/sendMessage/観測サーバー）をモック。`_harness.ts`に共有モック・ヘルパーを集約。

## SSOT一覧

| 情報 | 正本の場所 |
|------|-----------|
| 設定値・環境変数 | .env + config.ts（getConfig()） |
| 現在の状態（場+参与者） | data/state.json（場状態・会話履歴・チェーンID） |
| 長期記憶 | data/memory.jsonl + xAI Collections API |
| アプリログ | data/app.log |
| Roblox投影ログ | data/roblox-intents.jsonl |
| プロジェクト戦略 | docs/PROJECT.md |
| 現行アーキテクチャ | docs/architecture.md（本文書） |
| 次版計画 | docs/PLAN.md |
| 人格定義 | BEING.md |
| Pulse定義 | PULSE.md |
| Rojo設定（Studio同期） | default.project.json |
