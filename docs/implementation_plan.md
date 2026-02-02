# SPECTRA 実装計画

> 最終更新: 2026-01-29  
> 前提: `GrokスタックAIエージェント設計仕様書.md` Section 1 を参照

---

## 0. 前提（設計仕様書より）

### 目的
1. 一貫したアイデンティティを持つ存在を作る
2. 複数の接点（チャネル）で活動させる
3. 人間（開発者）が最終決定権を持つ
4. AUIの実証体として機能する

### 非目的
1. 模倣ではなく独自の存在
2. 内面シミュレーションはしない
3. 分散より集中（同時に複数チャネルで活動しない）
4. 単一の主人に仕える
5. 固有値は公開しない

### 成功基準（v1.0）
- 対話可能 / 制御可能 / 記憶継続 / 拡張可能

### スコープ
- SPECTRA = 固有値（非公開）
- AUI = 共通基盤（OSS化対象）

---

## 1. 不変条件

絶対に変わらないこと：

| 不変条件 | 説明 |
|----------|------|
| コア一元化 | 脳（LLM + Context）は1つだけ |
| xai-sdk必須 | 推論はGrok APIのみ（Python） |
| 人格維持 | 既存のシステムプロンプトを継承 |
| CLI廃止 | CommandはConsole（Electron）とDiscordに集約 |
| 人間が最終決定権 | 承認なしで外部投稿・危険操作しない |
| 同一プロセス | Core + Channels は分離しない（シンプル優先） |
| Windows統一 | 運用/開発はWindowsネイティブで完結（WSL前提にしない） |

---

## 2. 境界（信頼境界）

| 区分 | 役割 | 信頼レベル |
|------|------|-----------|
| **Command** | 開発者が制御する指令室 | privileged（特権） |
| **Channels** | SPECTRAが世界と対話する経路 | normal（一般） |

### Command（指令室）
- Console（デスクトップ本部）← Electron (TypeScript)
- Discord（外出時の簡易司令部）← Python（承認/監視/指示の統制UI）

### Channels（対話経路）
- X（承認必要）
- Roblox（リアルタイム、承認不要）

---

## 3. 責任分担

| 責務 | 担当 |
|------|------|
| **判断** | Core（LLM） |
| **承認・監視** | Command（GUI/Discord） |
| **対外対話** | Channels（X/Roblox） |
| **実行** | Tools（ファイル/シェル/Git） |

**原則**: この4つの責務が混ざらないこと（Command内の会話は統制UIの一部）。

---

## 4. 失敗時の振る舞い

| 状況 | 振る舞い |
|------|----------|
| 承認がない | 外部投稿しない、危険操作しない |
| Commandが応答しない | 承認待ちキューに保持（タイムアウトで破棄） |
| Channelが応答しない | リトライ後、ログに記録して継続 |
| LLMがエラー | エラーを返し、再試行を促す |

---

## 5. 構造

### 5.1 技術選定

| 層 | 言語 | 理由 |
|----|------|------|
| **Core + Channels** | Python | xai-sdk公式対応、MCP/Voice/Collections対応 |
| **Console** | TypeScript (Electron) | xterm.js、自由なUI、Web資産活用 |

### 5.2 プロセス構成

```
[Python Core]（常時稼働・Windows自動起動）
 ├── FastAPI /v1/think
 ├── channels/roblox
 ├── channels/x（予定）
 └── command/discord（予定 / 統制UI）

[Electron Console]（手動起動・使うときだけ）
 ├── ダイアログUI
 ├── xterm.js（ターミナル内蔵）
 └── ダッシュボード（予定）
```

**ポイント:**
- Core は Windows 起動時に自動起動（タスクスケジューラ等）
- Console は使いたいときだけ起動
- 同一PC運用のため、プロセス分離は不要（シンプル優先）

### 5.3 ディレクトリ

```
spectra/
├── core/                 # Python: LLM + API（内部構造は未定）
│   └── main.py           # FastAPI エントリポイント
│
├── command/              # 指令室（privileged）
│   ├── console/          # Electron (TypeScript)
│   └── discord/          # Python（統制UI: 承認/監視/指示）
│
├── channels/             # 対話経路（normal）- Python
│   ├── roblox/           # 実装済み
│   └── x/                # 予定
│
├── config.yaml
└── .env
```

**Note**: Discord は `command/` に一本化。統制UIとしての会話/承認/監視を担う。

### 5.4 構造図

```
┌───────────────────────────┐
│ Electron Console (TS)     │
│ 手動起動 / ダイアログ・ターミナル │
└───────────┬───────────────┘
            │ HTTP (localhost)
            ▼
┌──────────────────────────────────────────────┐
│ Python Core（常時稼働・Windows）               │
│  ├ /v1/think                                  │
│  ├ channels/roblox                            │
│  ├ channels/x（予定）                          │
│  ├ command/discord（統制UI）                   │
│  │   └ Discord API（外部）                     │
│  └ xai-sdk（Grok API）                         │
└──────────────────────────────────────────────┘
            │
            │ Cloudflare Tunnel
            ▼
        外部（Roblox等）
```

---

## 6. 実装フェーズ

### Phase 0: 既存資産の整理 ✅
- [x] `adapters/` → `channels/` に移行
- [x] `channels/roblox/` 動作確認
- [x] Core + Roblox の統合確認

### Phase 1: Command（指令室）最小化（avatar-uiの良い部分を採用）
- [x] Console UI設定の正本を `config.yaml` に統一（色・透過・グロー・システム文言）
- [x] Consoleのメタラベルは `avatar-ui v0.2.0` を表示（`command/console/package.json` の name/version を使用）
- [x] メタラベルは UI設定から変更不可（開発者のみ変更可能にする）
- [x] Consoleの起動は fail-fast（設定取得失敗時は即停止、フォールバックを置かない）
- [x] Consoleの設定値が欠落/不正なら fail-fast（UI表示を続行しない）
- [x] `core.main` に `/console-config` を追加し、Console向け最小設定を返す
- [x] `command/console/electron/preload.js` に `getConsoleConfig` を追加（/console-config を取得）
- [x] `command/console/main.js` で「起動→設定取得→UI反映」の順に初期化フローを固定
- [x] UIの文字列や色は CSS 変数で反映（JSでの分岐を最小化）
- [x] 既存の Console UI のハードコード文字列を削減し、設定由来に寄せる

### Phase 2: 統制エージェント機構

> 設計: `docs/agent_design.md`

#### 2.1 下準備
- [x] config.yaml: `avatar`/`user`/`grok` セクションを追加
- [x] core/main.py: 入力形式を `source`/`authority`/`text` に変更
- [x] 用語変更: SPECTRA → Avatar（コード内）

#### 2.2 状態管理
- [x] `data/state.json` の読み書き
- [x] `data/events.jsonl` の追記
- [x] 状態要素（input/plan/thought/action/result）の管理

#### 2.3 計画モデル
- [x] purpose/goal/task 階層の実装
- [x] 目標・タスク生成ロジック（APIエンドポイント経由）
- [x] Goal Framework（Purpose → Goal → Task の三層構造）
- [x] OKRベースのタスク構造（trigger/response）
- [x] 完了モード設定（purpose_completion, goal_completion, task_completion）
- [x] 達成型Purpose（完了後に次の目的を問いかけ）

#### 2.4 コアサイクル
- [x] サイクル（入力→計画→思考→行動→結果）の実装
- [x] 承認フロー（approving/executing）
- [x] 自律ループ（バックグラウンドスレッド）
- [x] purpose確認・問いかけ機能
- [x] 目標・タスク自動生成（LLM）
- [x] タスク完了通知（/admin/complete）
- [x] Console完了通知連携
- [x] 継続待ち機構（awaiting_continue）
- [x] 目的達成確認（awaiting_purpose_confirm: y/n/新しい目的）
- [x] 逐次的な目標・タスク生成（バッチではなくストリーミング的に）
- [x] タスク重複防止（ID一意性チェック）
- [x] ループ再開イベント（_loop_wake_event）
- [x] /admin/reset エンドポイント
- [x] /admin/continue エンドポイント

#### 2.5 システムプロンプト
- [x] テンプレート化（state.json内容の注入）

#### 2.6 UI拡張
- [x] missionペイン追加
- [x] inspectorペイン追加
- [x] vitalsペイン追加
- [x] vitalsペイン実データ化（CPU/メモリ/ネットワーク/トークン使用量）
- [x] config重複解消: `avatar`/`user` と `console_ui.name_tags` の統一
  - `/console-config`で`avatar`/`user`を`name_tags`に注入
  - `config.yaml`から重複した`name_tags`を削除
- [x] Inspectorタイムライン化（THINKイベントのストリーム表示）
- [x] /reset スラッシュコマンド（command_palette経由）
- [x] 再起動時の状態復元（承認待ち/継続待ち/目的確認待ちの再表示）
- [x] Avatar名のconfig参照（ハードコード排除）

#### 2.7 実行アーキテクチャ

> 設計: `docs/agent_design.md` > 実行アーキテクチャ

##### 2.7.1 現行実装の修正
- [x] シェル選択のOS標準化（環境変数優先、未設定ならOS標準）
- [x] シェル制限の拡張（bash/zsh/PowerShell許可）
- [x] cwd設定（環境変数優先、未設定ならAvatar/space）
- [x] ワークスペース自動作成（未作成なら作成）

##### 2.7.2 Exec Contract
- [x] ExecRequest型定義（backend, action, params, cwd, capability_ref）
- [x] ExecStream型定義（type, data, timestamp）
- [x] ExecResult型定義（status, exit_code, summary, artifacts）
- [x] 型定義をドキュメントに追加

##### 2.7.3 Backend Router
- [x] Terminal BackendとしてPTYをラップ（Console側維持、Core側は通知のみ）
- [x] Backend Router最小実装（Terminal/Dialogue分岐）
- [x] ExecRequest→Backend→ExecResultのフロー実装
- [x] `/v1/exec`エンドポイント追加
- [x] Dialogue Backend実装（think_core連携）

##### 2.7.4 ワークスペース制約
- [x] Runtime層でcwd検証（Avatar Space内のみ許可）
- [x] アバター操作: Avatar Space外アクセスを拒否
- [x] ユーザー操作: Avatar Space外アクセスは警告のみ
- [x] プロンプトカスタマイズ（PS1でディレクトリ名表示）
- [x] PowerShellバナー消去（-NoLogo, -NoProfile）
- [x] Avatar Space汎用化（環境変数 > config > デフォルト）

##### 2.7.6 目的/目標/タスクの承認フロー（ユーザー主導）
- [ ] Goal候補の提示と承認（y/n）をRuntimeに追加
- [ ] Task候補の提示と承認（y/n）をRuntimeに追加
- [ ] Goal完了承認（全タスク完了後のy/n）を追加
- [ ] 達成型Purpose完了承認（全Goal完了後のy/n）を追加
- [ ] 継続型Purposeは自動完了しない（ユーザー明示のみ）
- [ ] 承認待ち状態の再起動復元（Goal/Task/Purpose）

##### 2.7.5 Roblox Backend（将来）
- [ ] Roblox Backend最小実装
- [ ] HttpService経由のExecRequest受信
- [ ] ExecResult返却

### Phase 3: Coreの最小骨格
- [ ] `core/brain.py` — LLM + Context の統合
- [ ] `core/policy.py` — 承認判定の最小版
- [ ] `core/tools/` — 最小セット（read-only中心）
- [ ] Event/Response の型定義

### Phase 4: Channels（対話経路）拡張
- [x] Roblox: 動作確認済み
- [ ] X: 最小の投稿/返信フロー（承認必須）

### Phase 5: 安全柵
- [ ] Tool Runnerの危険コマンド禁止リスト
- [ ] 変更実行時の差分表示
- [ ] .env へのアクセス禁止

### Phase 6: 結合テスト
- [ ] 承認フローの通しテスト（Console/Discord）
- [ ] Roblox往復テスト
- [ ] X承認投稿テスト

---

## 7. 決定ログ

| 日付 | 決定 |
|------|------|
| 2026-01-18 | 目的・非目的・成功基準を設計仕様書に明文化 |
| 2026-01-18 | CLI廃止、CommandはConsole+Discordに集約 |
| 2026-01-18 | Command と Channels はディレクトリ分離 |
| 2026-01-18 | 共通 Event/Response で統一 |
| 2026-01-18 | SPECTRAはOSS化しない（AUIの実証体） |
| 2026-01-18 | Console技術: Electron (TypeScript) を採用 |
| 2026-01-18 | Core + Channels は Python（xai-sdk直接使用） |
| 2026-01-18 | 同一プロセス構成を採用（分離は不要、シンプル優先） |
| 2026-01-18 | Core は Windows自動起動、Console は手動起動 |
| 2026-01-18 | 状態管理（/status等）は今は不要、拡張時に検討 |
| 2026-01-29 | Goal Framework採用（Purpose → Goal → Task 三層構造） |
| 2026-01-29 | OKRベースのタスク構造（trigger/response） |
| 2026-01-29 | 達成型Purpose（完了→次の目的を問いかけ） |
| 2026-01-29 | Inspectorタイムライン化（THINKイベントのみ表示） |
| 2026-01-29 | 逐次的な目標・タスク生成（バッチ→ストリーミング的） |
| 2026-01-29 | 再起動時の状態復元（承認待ち等の再表示） |

---

## 8. 保留事項

| 項目 | 状態 | 備考 |
|------|------|------|
| 認証方式 | 保留 | HMAC/署名/トークンの比較が必要 |
| trust_level の命名 | 保留 | privileged/normal or authority/normal |
| 承認タイムアウト | 保留 | 何分で破棄するか |
| 会話履歴の外部化 | 保留 | 今はメモリ、マルチサーバー時にDB/Redis化 |

---

## 9. 設計原則

| 原則 | 説明 |
|------|------|
| **合理** | 使わない機能を作らない |
| **効率** | 最短経路で実装する |
| **シンプル** | コードを増やさない、複雑な分離をしない |

**「必要になったら追加」が基本方針。**
