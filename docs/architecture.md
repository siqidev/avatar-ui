# アーキテクチャ（v0.3）

> 現行実装の事実記述。設計意図・決定背景はPROJECT.md Decision Logを参照。

## プロセス構成

### Electron

FieldRuntime（場の全ロジック）をElectron Mainプロセス内に同居＋論理分離。Rendererは薄いIPCクライアント。

- **Main**: FieldRuntime（6要素）、Pulse(cron)、観測受信(HTTP)、Grok API呼出、永続化
- **Renderer**: 6ペインの描画＋ユーザー入力の送信＋イベント購読のみ
- ウィンドウ閉じ = channel.detach（Mainは生存しタスクトレイ常駐）、再度開き = channel.attach + 状態再同期
- セキュリティ: nodeIntegration:false / contextIsolation:true / sandbox:true

### CLI

readlineベースの会話インターフェース。Pulse + 観測サーバーの直列キュー。

## IPC

### プロトコル

メッセージ形式: `{ type, actor?, correlationId?, ...ペイロード }`。typeは `<domain>.<action>` の2語。Zod検証必須。トランスポートはElectron標準IPC。

preloadでcontextBridge経由の最小API公開。actor + correlationIdはpreloadで自動付与。

### チャンネル一覧

| ドメイン | チャンネル | パターン | 概要 |
|---------|----------|---------|------|
| chat | chat.post | invoke | メッセージ送信 |
| chat | chat.reply | send | AI応答（source属性付き: user/pulse/observation） |
| field | field.state | send | 場の状態更新（avatarName/userName含む） |
| fs | fs.rootName | invoke | Avatar Spaceルートディレクトリ名取得 |
| fs | fs.list | invoke | ディレクトリ一覧 |
| fs | fs.read | invoke | ファイル読み取り |
| fs | fs.write | invoke | ファイル書き込み（親ディレクトリ自動作成） |
| fs | fs.mutate | invoke | 構造変更（delete/rename/mkdir、discriminated union） |
| terminal | terminal.execute | invoke | コマンド実行 |
| terminal | terminal.output | send | コマンド出力ストリーム |
| observation | observation.event | send | Roblox観測イベント |

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

### ペイン

| ペイン | slug | 機能 | 読み/書き |
|---|---|---|---|
| Avatar | avatar | 視覚的存在提示（リップシンク・状態表示） | 読み取り専用 |
| Space | space | AIの生命活動空間（Avatar Space）の可視化と操作 | 読み書き |
| Canvas | canvas | 主作業領域。ファイル内容表示+画像昇格表示 | 読み書き |
| Stream | stream | 場の全入出力の統合ストリーム（human↔AI対話 + Pulse + 観測 + ツール可視化） | 読み書き |
| Terminal | terminal | 情報空間への能動的介入経路。シェルエミュレータ | 読み書き |
| Roblox | roblox | 観測イベントログ表示 | 読み取り専用 |

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

### 状態→視覚マッピング

| 入力 | 状態 | 色 | 補助 |
|---|---|---|---|
| なし | NORMAL | モノクロ | なし |
| chat.reply | REPLY | --state-info | 未読ドット |
| field.state(稼働) | ACTIVE | --state-info | [RUN] |
| field.state(警告) | WARN | --state-warn | [WARN] |
| integrity.alert | CRITICAL | --state-critical | アラートバー + [ALERT] |

正常時はモノクロ基調（色が出た瞬間に「何かある」と分かる）。

## Avatar Spaceファイルシステム

### セキュリティ

Avatar Space（`AVATAR_SPACE`環境変数）外へのファイルアクセスは拒否。パスガード`assertInAvatarSpace`がfilesystem-service.ts内に実装。

### 実行方式

ファイル操作はElectron MainのNode.js `fs`モジュールで実行（シェルインジェクション不可）。UIとLLMが同じfilesystem-serviceを共用（SSOT）。

### IPC設計（4チャンネル）

| IPC | 引数 | 戻り値 |
|-----|------|--------|
| `fs.list` | `{ path, depth? }` | `{ path, entries: { name, type, size, mtimeMs }[] }` |
| `fs.read` | `{ path, offset?, limit? }` | `{ path, content, mtimeMs }` |
| `fs.write` | `{ path, content }` | `{ path, bytes, mtimeMs }` |
| `fs.mutate` | `{ op: "delete"\|"rename"\|"mkdir", path, newPath? }` | `{ message }` |

### LLMツール

filesystem-tool.ts: fs_list / fs_read / fs_write / fs_mutate の4ツール。chat-session-serviceから呼び出し。

## Terminal

### 実行方式

`child_process.spawn`（Node.js標準API）+ xterm.jsでコマンド出力をリアルタイム表示。

- ネイティブモジュール不要、ビルド問題ゼロ
- AI/人間ともにコマンド実行→出力表示が可能
- 制約: PTYなし。vim/top/less等のフルスクリーンTUI、Tab補完、シェルプロンプト表示は不可

### AI認識設計

CommandRecord（完了済みサマリ）。自動注入なし、オンデマンド取得（terminalツール: cmd有=実行、cmd無=出力取得）。

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

### Luauモジュール構成（14ファイル）

| ファイル | 責務 |
|---------|------|
| CommandReceiver.server.luau | intentをレジストリ経由で実行し共通ACKを返すエントリポイント |
| ObservationSender.server.luau | チャット/接近/追従状態の観測イベント送信 |
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
| Config.luau | 通信先・検知間隔・しきい値設定 |

### TypeScript側

- roblox-action-tool.ts: 7カテゴリ（part, terrain, npc, npc_motion, effect, build, spatial）のツール定義
- projector.ts: schema_version=3, intent_id伝播, pending retry
- observation-server.ts / observation-formatter.ts: ACK+観測イベント処理

### インフラ

- Roblox Studioはlocalhost HTTPをブロックするため、Cloudflare Tunnel経由が必須
- cloudflaredトンネル自動管理（Electronライフサイクル連動）
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

### .env + getConfig()

`.env`を唯一の設定入口とし、`config.ts`の`getConfig()`遅延singletonで一元管理。

- `buildConfig(rawEnv)`: 純粋関数。Zodスキーマでバリデーション
- 空文字→undefined変換: `.env`で`KEY=`と書かれた項目をoptionalとして扱う
- `_resetConfigForTest()`: テスト用リセット

### ensureDirectories()

起動時ディレクトリ保証（CLI/Electron共通）:
- `data/`: 常に暗黙作成
- `AVATAR_SPACE`: デフォルト値→暗黙作成、明示設定→存在チェック+fail-fast

### Renderer側の設定参照

`field.state` IPCメッセージに`avatarName`/`userName`を含め、ラベルを動的表示。Rendererは直接process.envを参照しない。

## 参与文脈（③）

### ParticipationInput型

`actor` / `source` / `correlationId` / `channel` / `timestamp` / `text`を構造化。全起点（chat/pulse/observation）に共通の場状態ゲートを適用。correlationIdは入力時に確定し、AI応答まで同一IDで貫通保持。

## 場FSM

`generated → active → paused → resumed → active / → terminated`

field-fsm.tsで純関数transitionとして実装。

## SSOT一覧

| 情報 | 正本の場所 |
|------|-----------|
| 設定値・環境変数 | .env + config.ts（getConfig()） |
| 現在の状態 | data/state.json |
| 長期記憶 | data/memory.jsonl + xAI Collections API |
| アプリログ | data/app.log |
| Roblox投影ログ | data/roblox-intents.jsonl |
| プロジェクト戦略 | PROJECT.md |
| 現行アーキテクチャ | docs/architecture.md（本文書） |
| 次版計画 | PLAN.md |
| 人格定義 | BEING.md |
| Pulse定義 | PULSE.md |
