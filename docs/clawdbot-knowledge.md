# Clawdbot ナレッジベース

> このドキュメントは公式情報に基づくClawdbotの分析・理解をまとめたもの。
> 他エージェントへの知識共有用。

---

## 1. Clawdbotとは

**一言で:**
> 普段使うチャット面（WhatsApp/Telegram/Slack/Discord/Signal/iMessage/Teams等）から
> いつでも同じAIにアクセスできる「パーソナルAI制御面（control plane）」

**公式リソース:**
- GitHub: https://github.com/clawdbot/clawdbot
- Docs: https://github.com/clawdbot/clawdbot/blob/main/docs/
- ClawdHub（スキルレジストリ）: https://clawdhub.com/

---

## 2. 他のAIコーディングツールとの比較

### 本質的な違い

> Cursor/Claude Code/Codex CLI/Antigravityが「開発作業内のエージェント」なら、
> Clawdbotは「生活/開発/連絡チャネル全体を束ねる常駐の制御面（control plane）」

### 各ツールの概要

**Cursor（IDE型）**
- **目的**: エディタ中心でAIを使う
- **入口**: VSCode fork（エディタ画面）
- **強み**: コード編集/補完/レビューの速度、エディタ統合のUX
- **設計思想**: 「コードを書くその場」を最速化

**Claude Code（ターミナル型）**
- **目的**: ターミナルでリポジトリを読み・変更し・コマンド実行
- **入口**: ターミナル（`claude`コマンド）
- **強み**: Unix哲学（composable/scriptable）、パイプ連携、CI統合
- **設計思想**: 「ターミナルで完結する自走エージェント」
- **特徴**: サンドボックス/権限(allow/deny)で安全に自走、MCP連携可

**OpenAI Codex CLI（ターミナル型）**
- **目的**: ターミナルでリポジトリ操作・コマンド実行
- **入口**: ターミナル（`codex`コマンド）
- **強み**: Skills（再利用可能な指示+スクリプト+リソース）でパッケージ化
- **設計思想**: 「手順をパッケージ化して繰り返しを減らす」

**Antigravity（プラットフォーム型）**
- **目的**: Mission Control UIで複数エージェントを管理
- **入口**: Webベースの司令塔UI
- **強み**: 計画→実行→検証のサイクル管理、マルチエージェント協調
- **設計思想**: 「開発プラットフォームとしてのエージェント群」

**Clawdbot（パーソナルAI制御面）**
- **目的**: 普段使うチャット面からいつでも同じAIにアクセス
- **入口**: メッセージ面全体（WhatsApp/Telegram/Slack/Discord/Signal/iMessage/Teams/Matrix/WebChat等）
- **強み**: マルチチャネル常駐、daemon常駐、セキュリティ（DM前提設計）
- **設計思想**: 「生活インフラとしてのAI」「control plane」

### 機能比較マトリクス

| 機能 | Cursor | Claude Code | Codex CLI | Antigravity | **Clawdbot** |
|-----|--------|-------------|-----------|-------------|--------------|
| **入口** | エディタ | ターミナル | ターミナル | Web UI | **メッセージ面** |
| **常駐** | × | × | × | × | **✅ daemon** |
| **マルチチャネル** | × | × | × | × | **✅ 10種以上** |
| **ファイル編集** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **コマンド実行** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **MCP連携** | ✅ | ✅ | ○ | ○ | ✅ |
| **外部ツール呼出** | オンデマンド | オンデマンド | オンデマンド | オンデマンド | **常時監視可** |
| **サンドボックス** | × | ✅ | ○ | ○ | **✅（危険度別）** |
| **マルチエージェント** | × | サブエージェント | × | ✅ | **✅（ルーティング）** |
| **長期記憶** | × | × | × | ○ | **✅（vector+FTS）** |
| **自律行動（Cron等）** | × | CI連携可 | CI連携可 | ○ | **✅（Heartbeat/Cron）** |
| **音声** | × | × | × | × | **✅（Voice Wake/Talk）** |
| **Canvas/可視化** | × | × | × | ○ | **✅（A2UI）** |

### ユースケース別の最適ツール

| ユースケース | 最適ツール | 理由 |
|-------------|-----------|------|
| コード補完・リファクタ | **Cursor** | エディタ統合のUX |
| リポジトリ全体の変更 | **Claude Code** | ターミナルから自走 |
| CI/CD自動化 | **Claude Code / Codex** | パイプ連携・CI統合 |
| 複数エージェント協調 | **Antigravity** | Mission Control |
| スマホからAIに指示 | **Clawdbot** | メッセージ面から即応 |
| 定期タスク自動実行 | **Clawdbot** | Heartbeat/Cron |
| チーム/コミュニティ対応 | **Clawdbot** | Discord/Slack常駐 |
| 生活とAIの統合 | **Clawdbot** | マルチチャネル常駐 |

### 組み合わせ戦略（併用推奨）

**役割分担:**
- **Cursor/Claude Code/Codex** = 「開発の手足」
- **Clawdbot** = 「生活全体の司令塔」

---

## 3. Clawdbot固有の価値

### 3.1 マルチチャネル常駐
- WhatsApp/Telegram/Slack/Discord/Signal/iMessage/Teams/Matrix/WebChat等を**同一AIの受信箱**に束ねる
- 「開発中だけAI」ではなく「生活インフラとしてAI」

### 3.2 Gateway = control plane
- セッション/チャネル/ツール/イベントを単一制御面で管理
- CLI/Web UI/各チャット面を「同じ制御面」でつなぐ
- 入口が複数でも中身（エージェント）は同一

### 3.3 危険度ベースの実行
- main session（本人作業）→ホストで自由に実行
- group/channel（外部入力）→Docker sandbox隔離
- DM from unknown→ペアリングコード要求（dmPolicy="pairing"）
- 「入力の信用度」で実行環境を分離する設計

### 3.4 マルチエージェント分離
- チャネル/アカウント/peer単位で別エージェントにルーティング可能
- 「創作人格」「開発人格」「マーケ人格」を同時常駐
- メモリ/ポリシー/権限を人格ごとに分離

### 3.5 長期記憶（persistent memory）
- `MEMORY.md` + `memory/**/*.md` をベクトル検索+全文検索
- ファイル監視（watch）で変更追従
- 「会話ログ」ではなく「ナレッジ資産」として運用可能

### 3.6 自律行動（Heartbeat/Cron/Hooks）
- 30分ごとのHeartbeatでOODAループ
- Cronで定時タスク（日報、リマインダー）
- Gmail PubSub等の外部イベント連携
- 「聞かれたら答える」→「自ら考えて行動」

### 3.7 Canvas + A2UI
- agent-drivenの可視化ワークスペース
- 生活タスク（調査/計画/運用）を視覚化

### 3.8 音声（Voice Wake + Talk Mode）
- always-on speech detection
- continuous conversation

---

## 4. メモリシステム仕様

### ワークスペースファイル

| ファイル | 用途 | 読み込み |
|---------|------|---------|
| `IDENTITY.md` | エージェントID | 常時コンテキスト |
| `USER.md` | ユーザープロファイル | 常時コンテキスト |
| `SOUL.md` | ペルソナ・境界線 | 常時コンテキスト |
| `TOOLS.md` | ツール・規約メモ | 常時コンテキスト |
| `memory/YYYY-MM-DD.md` | 日次ログ | 今日+昨日のみ全文 |
| `MEMORY.md` | 長期記憶（任意） | **メインセッションのみ全文** |

### 2つの読み込み経路（重要）

**経路1: 直接コンテキスト読み込み（セッション開始時）**
- 常時参照ファイル → 全文コンテキストに入力
- memory/今日+昨日 → 全文コンテキストに入力
- MEMORY.md → **メイン（プライベート）セッションのみ全文**
  - CLIやWebUIで直接対話 → 読み込まれる
  - Discordグループ/外部DM → **読み込まれない**（セキュリティ設計）

**経路2: memory_search ツール経由（セマンティック検索）**
- どのセッションからでも使用可能
- スニペット（~700文字）のみ返す（全文ではない）

### ベクトルDB自動構築

```
[MEMORY.md + memory/*.md]  ← Markdownファイル（ソースオブトゥルース）
         ↓
    チャンク分割（~400トークン、80トークンオーバーラップ）
         ↓
    Gemini/OpenAI API でembedding生成
         ↓
    SQLite に自動保存  ← ~/.clawdbot/memory/<agentId>.sqlite
         ↓
    memory_search ツールで検索可能
```

**自動化される処理:**
- SQLiteファイル作成（設定不要）
- チャンク分割・embedding生成
- ファイル監視（変更検知→再インデックス、デバウンス1.5秒）
- 全文検索インデックス（SQLite FTS5）
- sqlite-vec拡張によるベクトル検索高速化

### memorySearch

**対象**: `MEMORY.md` + `memory/**/*.md`

**検索方式**: ハイブリッド
- ベクトル検索（セマンティック）: 重み 0.7
- BM25全文検索: 重み 0.3

**検索結果**: スニペット（~700文字）のみClaudeに渡る（全文ではない）

**トークン消費**:
- embedding生成 → Gemini API（ファイル変更時）
- 検索結果 → Claude（スニペット分のみ）

### 設定例

```json
// ~/.clawdbot/clawdbot.json
{
  "memorySearch": {
    "enabled": true,
    "provider": "gemini"  // embeddingモデル（openai/gemini/local）
  }
}

// ~/.clawdbot/.env
GEMINI_API_KEY=your-key-here

// 自動生成されるベクトルDB
// ~/.clawdbot/memory/<agentId>.sqlite
```

---

## 5. 自律行動機能

### トリガー種別

| 機能 | トリガー | 用途 |
|-----|---------|------|
| **Heartbeat** | ポーリング（デフォルト30分） | 定期的な観測・思考・行動 |
| **Cron Jobs** | スケジュール（cron式対応） | 定時タスク（日報、リマインダー） |
| **System Events** | イベント駆動 | 即時アクション |
| **Hooks** | Webhook/PubSub | 外部イベント連携（Gmail等） |

### Heartbeatでできること

- inbox/calendar/reminders のスキャン
- フォローアップタスクの実行
- ユーザーへのプロアクティブなチェックイン
- `HEARTBEAT.md`自体の更新（指示があれば）
- 任意のスキル/ツール実行

### OODAループ（自律行動サイクル）

```
[観測] HEARTBEAT.md + memory/ + 各種コンテキスト
    ↓
[思考] Claude自身が判断「何をすべきか」
    ↓
[行動] ツール/スキル実行（ファイル更新、API呼び出し、メッセージ送信）
    ↓
[結果] 配信先に送信 or HEARTBEAT_OK
    ↓
[次のHeartbeat] 30分後に再度観測...
```

### Cronコマンド例

```bash
# 毎朝7時にサマリーをDiscordに送信
clawdbot cron add \
  --name "Morning status" \
  --cron "0 7 * * *" \
  --tz "Asia/Tokyo" \
  --session isolated \
  --message "今日の予定をまとめて。" \
  --deliver \
  --channel discord \
  --to "channel:1383963657137946664"
```

### スキル vs Clawdbot固有機能

- **スキル** = ツール（何ができるか）
- **Clawdbot** = オーケストレーション（いつ・どの文脈で起動するか）

---

## 6. 運用・設定

### systemdサービス操作（Linux/WSL）

```bash
# 再起動
systemctl --user restart clawdbot-gateway.service

# 状態確認
systemctl --user status clawdbot-gateway.service

# 一覧
systemctl --user list-units 'clawdbot*'
```

※ `sudo`不要（ユーザーサービス）

### 設定変更時の反映

1. `~/.clawdbot/clawdbot.json` を編集
2. `systemctl --user restart clawdbot-gateway.service`
3. `clawdbot status` で確認

### 設計原則（運用指針）

1. **入口統一** - どこから話しかけても同じAIに届く
2. **責務分離** - 生活/開発/公開の人格・メモリ・権限を混ぜない
3. **危険度ベースの実行** - DM/外部入力ほど隔離、本人作業ほど自由

---

## 7. セキュリティ設計（公式ガイドより）

> 出典: docs.openclaw.ai/gateway/security, docs.openclaw.ai/sandboxing

### 脅威モデル

- シェル実行・ファイル読書き・ネットワーク・メッセージ送信が可能
- 攻撃者はメッセージ経由で誘導できる（プロンプトインジェクション）
- **「プロンプトだけでは防げない」と公式が明言**

### アクセス制御（最優先）

| 制御 | 説明 |
|------|------|
| **Pairing** | DM許可の事前登録 |
| **Allowlist** | 許可送信者のリスト（空や`*`は全開放） |
| **Mention Gating** | グループでは@メンションのみ反応 |

### サンドボックス

| モード | 動作 |
|--------|------|
| `off` | ホストで直接実行（危険） |
| `non-main` | main以外のエージェントを隔離 |
| `all` | 全てDocker内で実行 |

### 高リスクツール

- `exec` / `browser` / `web_search` / `web_fetch` は制限推奨
- **elevated（ホスト実行への逃げ道）は許可元を極限まで絞る**

### 設計原則（3軸）

1. **誰が話せるか** — pairing / allowlist / mention gating
2. **どこで動くか** — sandbox on/off / elevated
3. **何に触れるか** — tools allow/deny

### SPECTRAへの適用

| 項目 | OpenClaw | SPECTRA（v0.3.0方針） |
|------|----------|----------------------|
| 入力制御 | pairing/allowlist | authority（owner/guest） |
| 実行隔離 | Docker sandbox | 権限分離（all/dialogue） |
| 記憶分離 | mainのみMEMORY.md読み込み | session（private/public） |

**結論**: 「全チャネル自分専用」なら隔離不要。不特定入力時はdialogue only + public session。

---

## 更新履歴

- 2026-01-22: 初版作成（公式ドキュメント検証に基づく）
- 2026-01-22: メモリ読み込み経路・ベクトルDB自動構築の詳細を追記
- 2026-02-04: セキュリティ設計（公式ガイド）とSPECTRA適用方針を追記