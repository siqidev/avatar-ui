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

## 開発進捗（2026-02-27時点）

### 完了済みスパイク
1. **Console会話基盤** — Grok Responses API + readline、being.md人格定義、previous_response_id継続
2. **長期記憶（save_memory）** — ローカルJSONL + Collections API（fire-and-forget）、ツール呼び出しループ
3. **Pulse（AI起点の定期発話）** — node-cron + 直列キュー、3層構造（ファイルゲート→system注入→sendMessage）、PULSE_OKプロトコル。起点対称性(P15)の実装
4. **Roblox連携v2** — Open Cloud Messaging API（外部→Roblox片方向）、カテゴリ別モジュール構成（PartOps/TerrainOps/NpcOps/EffectOps）、DataStore永続化、情報物質化エフェクト。CLI経由でAIがRoblox空間を操作する
5. **Roblox観測パイプライン** — ObservationSender（Roblox ServerScript）→ Cloudflare Tunnel → observation-server（TypeScript HTTP）→ CLI直列キュー。双方向接続の完成。Roblox Studioはlocalhost HTTPをブロックするためトンネル経由が必須
6. **Console縦切り（Spike-01）** — Electron + electron-vite + FieldRuntime（Main内論理分離）+ field-fsm（generated→active→paused→resumed→terminated）+ IPCスキーマ（Zod検証）+ チャットペイン。セキュリティ: nodeIntegration:false/contextIsolation:true/sandbox:true
7. **Robloxチャット統合** — GrokChat（旧仕様）を削除し新アーキテクチャに統合。Player.Chatted（サーバー側チャット検知）、Chat:Chat（NPC頭上バブル）、RemoteEvent+SpectraChatDisplay（チャット履歴表示）、isOwnerフラグ+ROBLOX_OWNER_DISPLAY_NAME（オーナー識別・名前解決）
8. **Console UI共通基盤** — 3列6ペイン（Avatar独立化）、TUI-in-GUIデザイントークン、列幅スプリッター＋列ごと独立行高さスプリッター、ペインヘッダーD&Dで位置入替、状態正規化器（IPC入力→NORMAL/REPLY/ACTIVE/WARN/CRITICAL視覚マッピング）、Chatペイン移行。テスト26件（state-normalizer 16件 + layout-manager 10件）
9. **FieldRuntime観測統合** — 観測サーバーをElectron Main内のFieldRuntimeに統合。CLI専用だった観測処理をCLI/Electron共通化（observation-formatter抽出）。IPC経路: observation-server→FieldRuntime.enqueue→sendMessage(AI)→chat.reply + observation.event→Renderer。Roblox Monitorペインに観測ログ表示（タイムスタンプ+イベント種別+整形テキスト、最新上、最大50件）。アプリ終了時の観測サーバークリーンアップ。テスト10件追加（observation-formatter）
10. **Chatペイン強化** — Chatペインを「場の会話ストリーム」として全入出力を可視化。①sendMessage()戻り値をSendMessageResult型に拡張（text+toolCalls）②AI応答にsource属性（user/pulse/observation）を付与し、ラベル色で視覚的区別（spectra>/[pulse] spectra>/[roblox] spectra>）③ツール呼び出し（roblox_action, save_memory等）をChat内にインライン表示④Roblox観測イベント・Pulseトリガーをコンテキスト行としてChatに表示（[roblox]/[pulse]ラベル）⑤Pulse/観測応答時にchat入力がdisabledにならないバグを修正（source=userの場合のみ解除）⑥テスト基盤修正（observation-server: port 0でテスト隔離、vitest.config.ts: dist/除外）。テスト115件全通過
11. **File Systemペイン** — Avatar Space（`AVATAR_SPACE`環境変数）のフルCRUD可視化・操作。①fs-schema.ts（4 IPC Zodスキーマ+discriminated union）②filesystem-service.ts（パスガード`assertInAvatarSpace`+CRUD、UIとLLM共用）③fs-ipc-handlers.ts（ipcMain.handle+Zodバリデーション+fs.rootName）④filesystem-pane.ts（ツリー表示+展開/折畳+インライン入力+コンテキストメニュー+VSCode準拠キーバインド）⑤filesystem-tool.ts（LLMツール定義4種）⑥chat-session-service.ts統合（fs_list/fs_read/fs_write/fs_mutate）⑦IDE UX（SVGアイコン、インデントガイド、拡張子別カラー、キーボードナビゲーション）。sandbox制約によりprompt()/confirm()をカスタムUI化。テスト142件（+21件filesystem-service）

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

**現段階の方針**: CLI + Roblox双方向で運用中。Robloxチャット入力はObservationSender→observation-server経由で実装済み。Roblox Studioはlocalhost HTTPをエンジンレベルでブロックするため、Cloudflare Tunnel経由（spectra.siqi.jp→localhost:3000）が必須

### Console設計（議論合意 2026-02-24）

**定義**: Console = 場の媒体（窓）の一つ。②媒体投影が正規化する対象。場に従属し、場が消えても窓が消えるだけ。窓が消えても場は消えない。根拠: ❶アーキテクチャ要請「媒体は場を覗く窓として従属」、②媒体投影「セッション/媒体を場への接続に正規化」。v0.2「Body」概念は再導出対象のため根拠に使わない。

**構成**: PC司令室（多面窓）。場の複数側面を同時に映し、他の窓（Roblox/X）の状態も表示するメタ窓。

| ペイン | 機能 | 読み/書き |
|---|---|---|
| Stream | 場の全入出力の統合ストリーム（human↔AI対話 + Pulse + 観測 + ツール可視化） | 読み書き |
| Terminal | node-pty等のシェルエミュレータ。AIも人間も双方が直接操作可能 | 読み書き |
| File System | AIの生命活動空間（Avatar Space）の可視化と操作。後述「File Systemペイン構想」参照 | 読み書き |
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
- Renderer: 6ペインの描画＋ユーザー入力の送信＋イベント購読のみ。FieldRuntimeへの直接参照なし
- IPCプロトコル: メッセージ形式 `{ type, actor?, correlationId?, ...ペイロード }`。typeは `<domain>.<action>` の2語（chat.post, terminal.output等）。Zod検証。トランスポートはElectron標準IPC（ipcMain/webContents.send）でスタート、型はストリーム対応（.stream/.output パターン）。パフォーマンス問題が出たらMessagePortに差替え
- IPCセキュリティ: nodeIntegration:false / contextIsolation:true / sandbox:true。preload.tsでcontextBridge経由の最小API公開（ipcRendererの直接公開禁止）。Main側でZodバリデーション必須
- ウィンドウ閉じ = channel.detach（Mainは生存しタスクトレイ常駐）、再度開き = channel.attach + カーソルベースの状態再同期
- 将来の分離: IPCアダプタをWebSocketアダプタに差し替えれば独立デーモン化が可能（現時点では不要）
- 棄却案A（場=Main丸ごと）: 分離なしで保守困難。棄却案B（場=独立デーモン）: IPC二重化で一人開発にリスク大

### Console UIデザイン（議論合意 2026-02-25）

**設計メタファー**: 二層構造。平常時は「共存の窓」（Chat中心）、障害時は手動で「監視室モード」（Terminal中心）に切替。自動遷移は実装しない。

**レイアウト（3列6ペイン、2行×3列）**:
```
┌── Left 25% ───┬── Center 50% ──┬── Right 25% ──┐
│ File System   │ Stream         │ Avatar        │
├───────────────┼────────────────┼───────────────┤
│ X             │ Terminal       │ Roblox        │
└───────────────┴────────────────┴───────────────┘
```
- 判断根拠: 往復回路の主インターフェース（Stream）を視覚中心に据える。操作系（File System/Terminal）を左に近接配置、監視系（Roblox/X）を右にまとめる。Avatarを独立ペインに分離しリップシンクアニメーションを維持
- 棄却案: Terminal中央案 — 設計主語「場の継続＋往復維持」と不一致。フラットCSS Grid案 — 列ごと独立行リサイズが不可能
- ペインD&D入替: ペインヘッダーをドラッグ→別ペインにドロップで位置交換
- 手動監視室モード: D&Dで任意のペイン配置に変更可能（Ctrl+数字は廃止）

**リサイズ規則**:
- 列幅: スプリッタードラッグで自由調整（初期比率 1:2:1）
- 列ごとの行高さ: 各列独立にスプリッタードラッグで調整（初期比率 1:1）
- 最小トラック: 100px

**デザイントークン（TUI-in-GUI）**:
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

**状態→視覚マッピング**:

| 入力 | 状態 | 色 | ボーダー | 補助 |
|---|---|---|---|---|
| なし | NORMAL | モノクロ | --line-default | なし |
| chat.reply | REPLY | --state-info | 変更なし | 未読ドット |
| field.state(稼働) | ACTIVE | --state-info | 色のみ変更 | [RUN] |
| field.state(警告) | WARN | --state-warn | 色のみ変更 | [WARN] |
| integrity.alert | CRITICAL | --state-critical | 色のみ変更 | アラートバー + [ALERT] |

原則: 正常時はモノクロ基調（色が出た瞬間に「何かある」と分かる）。優先度: integrity.alert > field.state > chat.reply > focus > normal

**ペイン実装優先順位（技術依存ベース）**:
1. ~~共通基盤~~ ✅ — 3列6ペイン（Avatar独立化）、列幅+列ごと行高さスプリッター、ペインD&D入替、トークン適用、状態正規化器
2. ~~Streamペイン（旧Chat）強化~~ ✅ — source別ラベル表示、ツール呼び出し可視化、観測/Pulseコンテキスト行、擬似ストリーム+テキストSE+リップシンク
3. ~~Roblox Monitor~~ ✅ — 観測イベントログ表示（FieldRuntime観測統合で実装済み）
4. X Monitor — Roblox Monitorの横展開
5. Terminal — まずログビューア（node-ptyはスコープ確定後）
6. ~~File Systemペイン~~ ✅ — Avatar Spaceの可視化・操作（4 IPC + IDE UX）

### 具体→抽象修正（議論合意 2026-02-25）

**③参与文脈の帰納的検証結果**:
- 10本のスパイクを帰納的に検証し、③の3責務（参与入力の一次化/現在文脈の保持/位相同調）の実在を確認
- 単一起点（Spike 1,2,8）では③不在でも問題なし。多起点・非同期（Spike 3-7,9,10）で繰り返しバグが発生:
  - 番号札（correlationId）が入力と応答で別々に生成され、因果追跡が不能
  - 場が一時停止中でもPulse/観測がゲートを素通り
  - 全入力がただの文字列でAIに渡され、メタ情報（誰が/どこから/何に関連するか）が構造化されていない

**合意内容**: 6要素モデルを維持。③参与文脈の最小実装を作る
- ParticipationInput型（actor/source/correlationId/channel/timestamp/text）を定義 ✅
- 全起点（chat/pulse/observation）に共通の場状態ゲートを適用 ✅
- correlationIdを入力時に確定し、AI応答まで同一IDで貫通保持 ✅
- モード可達性の観測指標 → ⑥健全性管理の実装時に扱う（保留）
- 位相同調の完全モデル → v0.3到達後に再検討（保留）

**実装完了（2026-02-25）**:
- `src/shared/participation-context.ts`: ParticipationInput型 + generateCorrelationId + createParticipationInputファクトリ
- `src/main/field-runtime.ts`: startPulse/startObservationに`isFieldActive`ゲート追加、correlationIdを場で一回生成しコールバック貫通
- `src/main/ipc-handlers.ts`: ゲート関数渡し、コールバック経由のcorrelationId使用（自前生成を廃止）
- `src/cli.ts`: 3パス（user/observation/pulse）でcreateParticipationInput使用
- テスト全通過（participation-context.test.ts 7件追加）

### Roblox空間改善設計（議論合意 2026-02-26）

**問題**: AIが3D座標を直接計算する設計が構造的に機能しない。「こっち来て」で明後日に走る、建築でドア/出入口が正しく配置できない等。根本原因は「絶対座標で操作させているのに、AI側に座標系の知覚入力がない」こと。

**設計原則**: AIは「意図+参照+制約」を出す。Robloxが「座標解決+実行+物理検証」を決定的に行い、ACKで閉ループする。

**3つの本質的変更**:
1. **AIが座標を計算しない仕組み（制約ベース汎用メカニズム）** — LLMは3D座標計算が苦手。「何をしたいか」と制約を出せば、Robloxが座標を解決する
2. **結果が返ってくる仕組み（共通ACK）** — 全操作に対して成功/失敗+物理検証結果を返却。AIが自動修正できる
3. **AIが空間を聞ける仕組み（空間照会）** — 「周りに何がある？」「自分はどこ？」をオンデマンドで照会

**最小制約タイプ（3種で開始、レジストリで拡張可能）**:
| type | 意味 | 例 |
|------|------|-----|
| `attach` | 面同士を接着 | 壁を地面に接地 |
| `offset` | 参照点からの相対移動 | 既存壁の5studs右に配置 |
| `non_overlap` | 重なり防止 | 他パーツとの衝突回避 |

**全命令仕様**:
| カテゴリ | 命令 | AI→Roblox | Roblox決定処理 |
|---------|------|-----------|--------------|
| npc | `go_to_player` | `{user_id, standoff?}` | プレイヤー位置解決→Pathfinding |
| npc | `follow_player` | `{user_id, standoff?}` | 追従ループ開始（0.5秒再経路） |
| npc | `stop_following` | `{follow_id?}` | 追従ループ停止 |
| build | `apply_constraints` | `{target, refs, constraints[], validate[]}` | 参照解決→制約適用→Part生成→物理検証 |
| terrain | `apply_constraints` | `{action, brush, refs, constraints[], validate[]}` | 参照解決→制約適用→Terrain操作→検証 |
| spatial | `query` | `{mode, center, radius?, limit?}` | pose取得/近傍探索/相対計算 |

**通信契約**:
- AI→Roblox: `{ schema_version, intent_id, category, reason, ops }` （Open Cloud Messaging, 1KB制限）
- Roblox→AI（ACK）: `{ type:"command_ack", payload: { success, data?, error?, meta: { intent_id, op, validation? } } }` （HttpService POST）
- 追従イベント: `{ type:"npc_follow_event", payload: { follow_id, state, user_id } }`

**物理検証（ACKに含める）**:
- 移動: 経路成立（PathfindingService.Status）、到達判定（MoveToFinished+最終距離）
- 建築: 重なり（GetPartsInPart）、接地（Raycast）、制約充足
- 地形: 実変化量（ReadVoxels前後差分）

**Robloxモジュール構造（14ファイル: 新規6 + 再構成8）**:
| ファイル | 種別 | 責務 |
|---------|------|------|
| `CommandReceiver.server.luau` | 再構成 | intentをレジストリ経由で実行し共通ACKを返すエントリポイント |
| `ObservationSender.server.luau` | 再構成 | チャット/接近/追従状態の観測イベント送信 |
| `CommandRegistry.luau` | **新規** | カテゴリ+opを実行関数に解決する登録型ルータ |
| `ObservationClient.luau` | **新規** | 観測イベントとACK送信の共通HTTPクライアント |
| `SpatialService.luau` | **新規** | pose取得・近傍探索・相対距離/方位計算 |
| `ConstraintSolver.luau` | **新規** | attach/offset/non_overlapの制約解決+物理検証 |
| `NpcMotionOps.luau` | **新規** | go_to_player/follow_player/stop_followingの移動制御 |
| `BuildOps.luau` | **新規** | build.apply_constraintsの実行、PartOpsへ反映 |
| `NpcOps.luau` | 再構成 | say/emoteの窓口維持、移動はNpcMotionOpsへ委譲 |
| `PartOps.luau` | 再構成 | create/set/delete+演出+永続化の低レベルPart実行器 |
| `TerrainOps.luau` | 再構成 | 既存操作+terrain.apply_constraints |
| `EffectOps.luau` | 維持 | エフェクト操作 |
| `WorldStore.luau` | 維持 | DataStore永続化ラッパー |
| `Config.luau` | 再構成 | 通信先・検知間隔・しきい値設定 |

**TypeScriptモジュール構造（7ファイル: 新規3 + 再構成4）**:
| ファイル | 種別 | 責務 |
|---------|------|------|
| `roblox-action-tool.ts` | 再構成 | roblox_actionの公開窓口（description組立） |
| `roblox-action-catalog.ts` | **新規** | カテゴリ/命令仕様のレジストリ（肥大化防止） |
| `roblox-action-schema.ts` | **新規** | build/terrain/spatial/npc引数のZodスキーマ |
| `projector.ts` | 再構成 | intent_id付きMessaging送信+投影状態更新 |
| `observation-server.ts` | 再構成 | 汎用イベント封筒受信+登録バリデータ検証 |
| `observation-events.ts` | **新規** | イベント種別のpayloadスキーマ/formatter登録 |
| `observation-formatter.ts` | 再構成 | イベント別フォーマッタでAI入力文変換 |

**既存互換**: `part create/set/delete`, `terrain fill/excavate/paint`はフォールバックとして残す。

**棄却案と理由**:
- 個別命令方式（`place_opening_on_wall`等）→ 用途が増えるたびに新命令が必要で設計爆発
- メッセージ都度の座標同梱 → 対症療法で本質的でない
- BEING.md依存の改善 → プロンプトエンジニアリングに依存しない仕組みを優先

**残リスク**: ConstraintSolver実装量（最小3制約で100-200行Luau）。複雑な制約組み合わせのエッジケース

### Roblox空間改善 実装状況（2026-02-26）

**Luau側: 全14モジュール実装完了** ✅
- CommandRegistry登録: part, terrain, npc, npc_motion, effect, build, spatial の7カテゴリ
- ConstraintSolver: attach/offset/non_overlap制約 + 物理検証（non_overlap, ground_contact）
- BuildOps: apply_constraints → ConstraintSolver.solve → PartOps.execute → ACK返却
- SpatialService: entities/nearbyクエリ + pose取得 + 相対関係計算
- NpcMotionOps: go_to_player/follow_player/stop_following + Humanoid.Runningイベント駆動アニメーション + Raycast障害物チェック直行 + WPスキップ + standoff内lookAt

**TypeScript側: ツール定義+投影+観測は実装済み、整理用ファイル3件は未作成**
- roblox-action-tool.ts: 7カテゴリ全定義済み ✅
- projector.ts: schema_version=3, intent_id伝播, pending retry ✅
- observation-server.ts / observation-formatter.ts: ACK+観測イベント処理 ✅
- **未作成**: roblox-action-catalog.ts, roblox-action-schema.ts, observation-events.ts（肥大化防止の整理用。機能は動作中）

**インフラ**:
- cloudflaredトンネル自動管理（Electronライフサイクル連動）✅
- Robloxログ転送（LogService→観測チャネル、AI非送信）✅

**v0.3スコープ（Roblox）**: 空間認識（SpatialService）、移動・追従（NpcMotionOps）、対話（NpcOps say/emote）。建築・地形操作はv0.3では実装済みだが品質検証はv0.4以降に延期。

**残課題（v0.4以降）**:
- 建築品質: 後述「建築品質の問題提起」参照。プリファブ方式への転換が必要
- TypeScript整理: catalog/schema/eventsの分離（現状roblox-action-tool.tsに全集約で動作はするが、カテゴリ追加時に肥大化リスク）
- Console用3Dマップ: Roblox空間のリアルタイム可視化

### 建築品質の問題提起（2026-02-26）

v0.3での実運用で判明した根本問題を記録する。解決はv0.4以降。

**現状の問題（一文）**: 現在のシステムは「AIにレゴブロック1個ずつ渡して家を建てさせている」設計であり、機能的な建築物（ドアの開閉、窓の透過等）を作ることが構造的に不可能。

**問題の詳細**:
1. **Part単位の組み立て**: BuildOps→ConstraintSolver→PartOpsのパイプラインはBasePart（直方体/球/円柱）を1つずつ生成する。壁・床・天井・ドア全てを個別Partとして配置するため、AIが全寸法・空間関係を正しく出力する必要がある
2. **機能的要素の欠如**: PartOpsはBasePart生成のみでModel非対応。ドア開閉（TweenService+CFrame回転+ProximityPrompt）、窓透過などの「振る舞い」を持つ構造物を作る手段がない
3. **制約の不足**: attach/offset/non_overlapの3種のみ。「壁に穴を開けてドアを嵌める」のような建築的制約がない

**外部調査で判明した業界標準手法**:
- Roblox建築ゲーム（Bloxburg等）はプリファブ方式: ServerStorageにModel保存→Clone()→PivotTo()で配置
- ドアはTweenService+CFrame回転+ProximityPromptが主流（HingeConstraint Servoは不安定報告あり）
- AI+3D建築のハイブリッド方式: AIがレイアウト・部材選択→機能的要素はプリファブから配置
- グリッドスナップ: `math.floor(pos/grid+0.5)*grid`

**方向性（議論途中、v0.4で確定）**:
- 成功指標を「配置精度」から「インタラクション可能な建築体験の成立率」に転換
- プリファブ方式の導入: ServerStorageに機能付きModel（開閉可能ドア等）を事前作成、AIは選択・配置のみ
- 既存Part建築（壁・床・装飾等の非機能パーツ）はConstraintSolverで維持
- BuildOps内でPart/Prefabを振り分けるハイブリッド構成

### ペイン名再導出（議論合意 2026-02-26）

cosmologyからの再導出と実用性の両立を議論し、以下で確定:

| 旧名 | 新名 | slug | 変更理由 |
|------|------|------|---------|
| FS | File System | filesystem | 略称をフル表記に。Avatar Spaceの概念はディレクトリ名（AVATAR_SPACE）に適用 |
| Chat | Stream | stream | 場の全入出力が時系列で流れる統合ストリーム。「Chat」は役割の過小評価かつ汎用的すぎ |
| Avatar | Avatar | avatar | 変更なし |
| X | X | x | 変更なし（固有名詞） |
| Terminal | Terminal | terminal | 変更なし |
| Roblox | Roblox | roblox | 変更なし（固有名詞） |

- 採用理由: 固有名詞は維持し、汎用名2つのみ改善。Streamは全source統合表示の実態を直接表現
- 棄却案: 全6ペインcosmology語彙化（Nexus/往復/在相等）→ 固有名詞ペインと浮く
- 残リスク: 将来の配信機能との名前衝突（実装時に「Live」「Broadcast」等で回避可能）

### File Systemペイン実装設計（2026-02-26）

**概念**: 単なるファイルエクスプローラではなく、AIの生命活動空間（Avatar Space）の可視化と操作の窓。

**Avatar Space**（PROJECT.mdで定義済み）: AIの内面世界。思考の痕跡、記憶の蓄積、創造物の本体が存在する空間。`AVATAR_SPACE`環境変数で指定されたディレクトリ（デフォルト `~/Avatar/space`）がまるごとAIの自由な活動空間になる。v0.2で `get_avatar_space()` / `is_path_in_space()` / `AvatarSpaceViolation` として実装実績あり。

**3つの役割**:
1. **蓄積の可視化** — ⑤共存記録の窓。記憶・意図の履歴・場の状態など、共存を通じて積み重なったものを見渡す
2. **自己進化の作業台** — Being・Pulse・ツール定義などをAI自身が読み書きし、自己を改変する手段の可視化（OpenClawのWorkspace概念に相当）
3. **実世界への出力経路** — ファイル操作を介してRoblox・X・自身の振る舞いに影響を及ぼす経路

**v0.3スコープ**: 読み取り＋書き込み（作成・編集・削除・リネーム・mkdir）。フル機能。

#### 実行方式: Main fs直接

ファイル操作はElectron MainプロセスのNode.js `fs`モジュールで実行する（shell経由ではない）。

- **根拠**: セキュリティ（シェルインジェクション不可）、信頼性（構造化エラー）、LLM互換性（引数がシンプル）
- **業界検証**: OpenClaw / Claude Code / Codex CLI いずれもファイルCRUDはネイティブAPI、シェルは任意コマンド用。ハイブリッドパターンが業界標準
- **avatar-uiでの適用**: File Systemペイン = fs直接、Terminalペイン = シェル実行（既存）

#### セキュリティ: Avatar Spaceサンドボックス

Avatar Space外へのファイルアクセスは拒否（v0.2の `is_path_in_space()` パターンを踏襲）。パスガードはfilesystem-service.ts内に実装（専用ファイル不要、現時点では1関数）。

#### IPC設計（4チャンネル）

invoke/handleパターン（リクエスト-レスポンス）を使用。actor + correlationIdはpreloadで自動付与。

| IPC | 引数 | 戻り値 |
|-----|------|--------|
| `fs.list` | `{ path, depth? }` | `{ path, entries: { name, type, size, mtimeMs }[] }` |
| `fs.read` | `{ path, offset?, limit? }` | `{ path, content, mtimeMs }` |
| `fs.write` | `{ path, content }` | `{ path, bytes, mtimeMs }` （親ディレクトリ自動作成） |
| `fs.mutate` | `{ op: "delete"\|"rename"\|"mkdir", path, newPath? }` | `{ message }` |

**設計根拠**:
- 6 IPC → 4 IPC: delete/rename/mkdirは「構造変更」操作として統合（discriminated union）。保守対象2/3に削減
- ifMatchMtimeMs（楽観的排他制御）は不採用: 書き手がAI 1体+人間1人で競合確率ほぼゼロ。業界3製品も未実装
- preload自動付与: Rendererが認証情報を意識しない。書き忘れバグを構造的に防止

#### 新規ファイル（4ファイル）

| ファイル | 層 | 責務 |
|---------|-----|------|
| `src/shared/fs-schema.ts` | shared | IPC 4チャンネルのZodスキーマ + 型定義 |
| `src/main/filesystem-service.ts` | main | パスガード + fs CRUD実装（UIとLLMの共用） |
| `src/main/fs-ipc-handlers.ts` | main | IPC handle → filesystem-service呼び出し |
| `src/renderer/filesystem-pane.ts` | renderer | ファイルツリー表示 + 操作UI |

**設計根拠**:
- 7ファイル → 4ファイル: パスガードはservice内に（SSOT）、エラー型はスキーマに同居、repository抽象は不要（直接fsで十分）
- UIとLLMが同じfilesystem-serviceを共用: ロジック正本が1箇所（SSOT）。field-runtime.tsからもIPC handlerからも同じserviceを呼ぶ

#### 実装順序

1. fs-schema.ts — Zodスキーマ + 型定義
2. filesystem-service.ts — パスガード + CRUD実装
3. fs-ipc-handlers.ts — IPC登録
4. preload拡張 — invoke API + actor/correlationId自動付与
5. filesystem-pane.ts — ツリー表示 + 操作UI
6. field-runtime.ts統合 — LLMツールからfilesystem-serviceを呼ぶ
7. テスト — service単体 + IPC結合

### 次の計画（方針: 具体→抽象の往復を継続）

③参与文脈の帰納的検証で「具体が抽象を修正する」有効性を確認。残り要素も同じ方法（実装→不足発見→修正）で進める。

**優先順位**:
1. **⑥健全性管理の実装** — v0.3到達状態の最大ギャップ（「共存故障を検知できる」）。故障が静かに壊れる現状を改善する
2. **残り要素（①②④）の帰納的検証** — 実装中に自然に不足が露出する。露出した問題を都度修正し、最後に網羅的に検証
3. **テスト計画（#7）** — 受入シナリオのテスト実装

**⑤共存記録について**: v0.3では追加実装不要と判断（2026-02-26）。previous_response_id（Grok API会話継続）+ save_memory（ローカルJSONL + Collections API）+ roblox-intents.jsonl（未送信リトライ）で「再起動をまたいで関係が継続」を実質的に充足。唯一のリスクはGrok APIの会話履歴パージだが、現時点で発生していないため、対策は挙動が判明してから検討する

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

## IN

- TypeScriptで新規実装（OpenClaw参照、踏襲粒度は段階的に精査）
- 場モデル6要素の実装（場契約 / 参与文脈 / 往復回路 / 共存記録 / 健全性管理を重点、媒体投影は単一チャネル最小）
- Console単一チャネルで体験成立
- 不変条件4種+横断制約の検知＋修復フロー
- セッション断を休止として再開可能にする
- ~~AI起点の常駐トリガ（Heartbeat）~~ → Pulse実装済み
- 場のライフサイクル（生成・維持・休止/再開・終端）
- File Systemペイン（Avatar Spaceの可視化・操作、フル読み書き）

## OUT（v0.4以降に延期）

- v0.2コードの移植・互換維持
- X / マルチチャネル本格対応
- 参与文脈（ParticipationContext）の完全独立コンポーネント化（最小実装はIN）
- 配信拡張（Live2D/3D、音声）
- **建築品質の根本改善** — プリファブ方式導入、機能的建築物（ドア開閉等）。詳細は「建築品質の問題提起」参照
- **Console用3Dマップ** — Roblox空間のリアルタイム可視化
- **残り場モデル要素（①②④）の網羅的検証** — v0.3で帰納的に進めた結果の仕上げ
