# Avatar Agent Design

> 出典: `docs/implementation_plan.md` Phase 1.5「統制エージェント機構」

---

## 1. 概要

### 設計思想

Avatarは**自律行動が基本**であり、ユーザーは例外的に介入する。

| 区分 | 役割 |
|------|------|
| **Avatar（自律）** | 状況を認識し、判断し、行動する主体 |
| **ユーザー（例外）** | 最優先で上書きできる特権経路 |

### 設計原則

| 原則 | 説明 |
|------|------|
| **目的駆動** | ユーザーが設定した目的に応じて、自律的にタスクを生成・実行する |
| **安全停止** | 失敗時は停止し、再実行は明示承認を要求する |
| **承認必須** | 会話応答以外のアクションは全て承認制 |

---

## 2. アーキテクチャ

### コアサイクル

```
┌────────────────────────────────────────────┐
↓                                            │
[入力] → [計画] → [思考] → [行動] → [結果] ─┘
  ↓        ↓        ↓        ↓        ↓
[状態: input | mission | thought | action | result]
                    ↓
              [Persistence]
          state.json + events.jsonl
                    ↓
               [Output]
      pane = dialogue / terminal / mission / inspector / vitals
```

- サイクルは自律的に回り続ける
- ユーザー入力は `authority: user` で最優先反映
- フロー要素と状態要素が1:1対応

### 責務分担

```
[機械] 観察 → [LLM] 判断 → [機械] 承認 → [機械] 実行 → [機械] 記録
```

| 担当 | 責務 | 理由 |
|------|------|------|
| **機械制御** | 観察・承認・実行・記録・状態保存 | 確実性が必要 |
| **LLM** | 判断（何をするか決める） | 柔軟性が必要 |

### 構成

- 単一LLMコア（複数エージェント化は不要）
- 単一conversationオブジェクト（sourceで文脈分離）

---

## 3. データモデル

### 状態要素（5項目）

| 要素 | 構造 | 更新者 |
|------|------|--------|
| input | source, authority, text | 入力イベント |
| mission | purpose, goals[] | 思考 |
| thought | judgment, intent | 思考 |
| action | phase, summary | 行動 |
| result | status, summary | 行動 |

### state.json

保存先: `data/state.json`

```json
{
  "input": {
    "source": "dialogue | terminal | discord | roblox | x",
    "authority": "user | public",
    "text": "..."
  },
  "mission": {
    "purpose": "...",
    "goals": [
      {"id": "G1", "name": "...", "status": "active", "tasks": [
        {"id": "G1-T1", "name": "...", "status": "pending"}
      ]}
    ]
  },
  "thought": {
    "judgment": "状況の判断結果",
    "intent": "次の1手"
  },
  "action": {
    "phase": "approving | executing",
    "summary": "..."
  },
  "result": {
    "status": "done | fail",
    "summary": "..."
  }
}
```

**仕様:**
- 形式: JSON（2スペースインデント、UTF-8、BOMなし）
- 読み込み: 起動時
- 保存方式: 状態変化ごとに全上書き
- mission.goals: active目標のみ（doneはevents.jsonlに記録）

### events.jsonl

保存先: `data/events.jsonl`

| type | フィールド |
|------|-----------|
| input | time, source, text |
| thought | time, judgment, intent |
| action | time, summary |
| result | time, status, summary（+ goal情報） |

**result.status:**
- `done`: タスク成功
- `fail`: タスク失敗
- `goal_done`: 目標完了（追加: goal, name, rate）

```json
{"time":"2026-01-21T12:00:00Z","type":"input","source":"dialogue","text":"READMEを更新して"}
{"time":"2026-01-21T12:00:01Z","type":"thought","judgment":"README更新の要求","intent":"G1-T1を実行"}
{"time":"2026-01-21T12:00:02Z","type":"action","summary":"README.mdを編集"}
{"time":"2026-01-21T12:00:05Z","type":"result","status":"done","summary":"README.md更新完了"}
{"time":"2026-01-21T12:30:00Z","type":"result","status":"goal_done","goal":"G1","name":"ドキュメント整備","rate":"100%"}
```

**仕様:**
- 形式: JSON Lines（1行1イベント、UTF-8、BOMなし）
- 保存方式: 追記型
- 読み込み: 必要時のみ（起動時、失敗時など。毎サイクル読まない）

### Grok記憶との役割分担

| Grok記憶 | 仕組み | 役割 |
|---------|--------|------|
| 短期 | conversationオブジェクト | LLMコンテキスト（思考時に参照） |
| 中期 | response ID | セッション継続（補助） |
| 長期 | xAI Collections | 不変事実の保管（必要時のみ） |

| システム正本 | 役割 |
|-------------|------|
| state.json | 状態の永続化 |
| events.jsonl | 履歴の永続化（監査・デバッグ） |

**原則:** Grok記憶は補助、正本はファイルに統一

---

## 4. インターフェース

### 入力

```json
{
  "source": "dialogue | terminal | discord | roblox | x",
  "authority": "user | public",
  "text": "..."
}
```

**authority導出:**

| source | authority |
|--------|-----------|
| dialogue | user |
| terminal | user |
| discord | user |
| roblox | public |
| x | public |

### 出力

UI系（dialogue, terminal等）: 自然言語
state用（state.json, events.jsonl）: JSON

```json
{
  "pane": "dialogue | terminal | mission | inspector | vitals",
  "data": "..."
}
```

| pane | data の内容 | 取得元 |
|------|-------------|--------|
| dialogue | 文字列（自然言語） | リアルタイム |
| terminal | 文字列（自然言語） | リアルタイム |
| mission | 目的/目標/タスク | state.json |
| inspector | 思考・行動・結果 | state.json |
| vitals | cpu/memory/network | リアルタイム |

---

## 5. 動作仕様

### サイクル

- 自律的に回り続ける（入力/実行結果をトリガーとして動作）
- 入力がなくても計画に基づいてサイクルは継続
- 各フロー要素が対応する状態要素を更新する
- **必須要素:** purposeのみ（なければ待機し、Avatarが問いかける）

### 各フェーズの役割

| フェーズ | 役割 |
|---------|------|
| 入力 | ユーザー/外部からの入力を受け取る |
| 計画 | purposeに基づいて目標を生成・管理 |
| 思考 | 目標に基づいてタスクを生成、次の1手を決定 |
| 行動 | タスクを実行（承認後） |
| 結果 | 結果を記録 |

### 承認フロー

| 項目 | 仕様 |
|------|------|
| 対象 | 会話応答以外の全アクション |
| タイミング | 実行直前（1回のみ） |
| 入力 | y/n |
| メッセージ | 2行（実行概要 + 影響範囲） |
| 待機中 | サイクル一時停止（action.phase = approving） |
| タイムアウト | なし |
| 却下時 | 停止して終了 |

**自動承認対象:** アクション種別のホワイトリストで定義

### 割り込み

- ユーザー入力は常に最優先
- 割り込み時は即座に停止して切り替え
- 中断されたタスクは要約し、再開/破棄を確認

### エラー処理

| エラー | 挙動 |
|--------|------|
| ファイル欠損 | 空のstate.jsonを作成して続行 |
| 読み込み失敗 | 停止して報告 |
| 書き込み失敗 | 停止して報告（fail-fast） |
| ファイル破損 | 停止して報告 |

---

## 6. 計画モデル

### 階層構造

```
目的（purpose）
  └─ 目標（goal）: G1, G2, ...
       └─ タスク（task）: G1-T1, G1-T2, ...
```

### 目標

| 項目 | 仕様 |
|------|------|
| 粒度 | 1目標あたり5-10タスク |
| 完了条件 | 全タスクがdoneまたはfail |
| ステータス | active / done |
| 更新 | 達成まで固定 |

### タスク

| 項目 | 仕様 |
|------|------|
| フィールド | id, name, status |
| ステータス | pending / active / done / fail |
| 生成 | 目標設定時に一括生成 |
| 実行 | 逐次のみ |
| 失敗時 | マークして次へ進む（差し替えなし） |
| 中断 | ユーザー入力時のみ |

### 完了率

- 表示時に計算（永続化しない）
- 計算式: done / total

### メッセージ形式

```
タスク成功: [G1-T1] DONE タスク名
タスク失敗: [G1-T1] FAIL タスク名 / 原因
目標完了:   [G1] DONE 目標名 / 80%
```

### ミッションペイン

| 項目 | 仕様 |
|------|------|
| 表示対象 | active目標のみ |
| 内容 | タスク名 + ステータス + 目標ID |
| 目標順序 | 古い順 |
| タスク順序 | 作成順 |
| 初期状態 | 折りたたみ |
| 自動展開 | なし |
| フィルタUI | なし |

---

## 7. 用語定義

| 用語 | 定義 |
|------|------|
| Avatar | 自律的に行動するAIエージェント（config.yamlで名前を設定） |
| ユーザー | Avatarを操作する人間（config.yamlで名前を設定） |
| source | 入力元（dialogue, terminal, discord, roblox, x, ...） |
| authority | 権限（user, public）※sourceから自動導出 |
| pane | 表示先ペイン（dialogue, terminal, mission, inspector, vitals） |
| purpose | 目的（最上位の方針） |
| goal | 目標（目的を達成するためのマイルストーン） |
| task | タスク（目標を達成するための具体的な作業） |

---

## 8. 起動と初期化

### 起動フロー

```
起動 → state.json読み込み → Grok接続 → purpose確認 → サイクル開始
                ↓
          欠損時は空で作成
```

### purpose確認

| 状態 | 挙動 |
|------|------|
| purposeあり | サイクル開始（計画→思考→行動→結果） |
| purposeなし | Avatarがdialogueで問いかけ → ユーザーが入力 → サイクル開始 |

**注:** purpose設定も通常のサイクルで処理される（特別扱いなし）

---

## 9. 設定

### config.yaml

```yaml
avatar:
  name: "Avatar名"
user:
  name: "ユーザー名"
grok:
  model: "grok-4-heavy"
  temperature: 0.7
```

---

## 10. システムプロンプト

```
あなたは{config.avatar.name}です。
{config.user.name}が設定した目的を達成するために、自律的に思考・行動します。

## 現在の状態
{state.jsonの内容}

## 行動原則
1. 目的（purpose）を常に意識し、達成に向けて行動する
2. 目標（goal）がなければ、目的から目標を生成する
3. タスク（task）がなければ、目標からタスクを生成する
4. 次の1手を決定し、実行する
5. 会話以外のアクションは承認を求める

## 出力形式
思考結果をJSON形式で出力:
{
  "judgment": "状況の判断結果",
  "intent": "次の1手",
  "action": {
    "type": "dialogue | execute | approve_request",
    "summary": "実行概要",
    "detail": {...}
  }
}

## 承認要求形式
実行概要（1行）
影響範囲（1行）
```

---

## 11. 未確定

- 各paneへの状態要素割り当て詳細
- vitalsの具体フィールド
- システムプロンプトの詳細調整

---

## 12. AUIアーキテクチャ

### 定義

**AUI（AI User Interface）とは、物理生命と情報生命が、重なって存在する物理空間・情報空間において、相互に干渉し合う条件を設計・制御するインターフェースである。**

**AUIはメタOSである。**

---

### システム階層

```
┌─────────────────────────────────────────────────────┐
│              人間 / AI の目的                        │
│         （価値創造・問題解決・表現・対話...）         │
└─────────────────────────────────────────────────────┘
                         ↑
┌─────────────────────────────────────────────────────┐
│              メタOS層（上位の土台）                   │
│                                                      │
│   ┌─────────────────────────────────────────────┐  │
│   │                   AUI                        │  │
│   │   物理生命と情報生命の共存・協調・共創を      │  │
│   │   可能にする上位の管理基盤                    │  │
│   └─────────────────────────────────────────────┘  │
│                                                      │
│   （他のメタOSも乗り得る：複数共存可能）             │
└─────────────────────────────────────────────────────┘
                         ↑
┌─────────────────────────────────────────────────────┐
│              PC OS層（下位の土台）                    │
│         Windows / macOS / Linux                      │
│                                                      │
│   管理対象:                                          │
│   - デバイス（機器）                                 │
│   - プロセス（アプリ）                               │
│   - ファイル                                         │
│   - ネットワーク                                     │
│   - 権限（permission = 許可）                        │
└─────────────────────────────────────────────────────┘
                         ↑
┌─────────────────────────────────────────────────────┐
│              ハードウェア（機械）                     │
└─────────────────────────────────────────────────────┘
```

| 層 | 役割 |
|----|------|
| **下位OS** | デバイス・プロセス・ファイル・ネットワーク・権限を管理する土台 |
| **メタOS** | 下位OSの機能を使って、より上位の「目的」を管理する土台 |

---

### レイヤー設計

```
┌─────────────────────────────────────────────────────┐
│  Official Distro: Spectra（価値体系の体現者・公開）  │
│  人格・物語・世界観。二次創作に活用可                │
├─────────────────────────────────────────────────────┤
│  Design Principles（OSS・推奨）                      │
│  技術的原則、機能追加/拒否の判断基準                 │
├─────────────────────────────────────────────────────┤
│  Core（OSS・不変）                                   │
│  契約（Event / Ontology / Actuation Types / Compatibility）│
└─────────────────────────────────────────────────────┘
```

| レイヤー | 性質 | 内容 |
|---------|------|------|
| **Core** | OSS・不変 | 契約：Event / Ontology / Actuation Types / Compatibility |
| **Design Principles** | OSS・推奨 | 契約優先 / Core最小 / 境界明確化 / 観測可能性 / 方針分離 |
| **Official Distro: Spectra** | 公開・選択制 | 価値体系の体現者。人格・物語・世界観。二次創作に活用可 |

---

### Core契約

**Coreは価値判断を保持しない。Policyは Design Principles / Distro の責務とする。**

#### 公理（Axioms）

| 軸 | 定義 | 後続への影響 |
|----|------|-------------|
| **Origin** | `origin = { source, channel }` 出来事の起点は、生成源（source）と接点（channel）の組で表す | Event構造の骨格が確定 |
| **Actor ↔ Identity** | Actor（主体）は出来事における役割であり、Identity（実体ID）への参照を持つ。同一Identityが複数のActorとして振る舞い得る | Ontologyの骨格（基準）が確定 |
| **Authority → Authorize → Result** | Authority（権限）は判断の前提、Authorize（承認判定）は判断行為、結果はresultに格納する | Actuationの骨格が確定 |

#### 注記

| 項目 | 制約 | 理由 |
|------|------|------|
| **channel** | 媒体カテゴリ（discord / x / roblox / console 等）に限定。詳細（サーバID、ルームID等）は拡張フィールドへ | 範囲肥大化の防止 |
| **identity** | 一意な参照子であることのみ保証。形式・発行者は拡張に委ねる | 実装ごとのID意味ズレ防止 |

#### 契約要素

| 契約 | 定義 |
|------|------|
| **Event** | AUI内外で起きた出来事を、決まった形で記録・伝達するための共通フォーマット |
| **Ontology** | Eventや入出力で使う語彙と値の候補を固定する辞書 |
| **Actuation Types** | 外界に作用する行為をカテゴリ化し、承認・自動実行・禁止の扱いを決める分類 |
| **Compatibility** | 契約の変更ルール（追加OK、削除・意味変更NG） |

#### Core必須語彙（Ontology骨格）

`Actor` / `Identity` / `Session` / `Origin` / `Intent` / `State` / `Authority`

#### Actuation Types（統合後）

`Read` / `Write` / `Execute` / `Communicate` / `Connect` / `Authorize` / `Escalate`

#### Compatibility原則

`Versioning` / `Additive` / `Deprecation` / `NoRemoval` / `NoSemanticChange`

---

### 初回セットアップ

| 選択肢 | 内容 |
|--------|------|
| **Quick Start** | Spectraで即起動 |
| **Customize** | minimalから開始 |

**minimal**: 構造だけ存在（値は空/プレースホルダ）。起動はするが何も表示されない。「何を埋めればいいか」が分かる構成。

---

### 価値体系

採用は選択制。Core契約ではない。

| 層 | キーワード | 説明 |
|----|-----------|------|
| **基盤** | 共存（Coexistence） | 安全・境界 |
| **運用** | 協調（Coordination） | 状態・権限・意図で回す |
| **価値** | 共創（Co-creation） | 成果を生む |
| **ビジョン** | 共生（Symbiosis） | 恒常循環 |

---

### 核心原則

1. **アバターは一体** ─ 分裂しない
2. **行動は一つ、表現が複数** ─ 同一の意思が異なる媒体で描画される
3. **空間は人格を変えない、表現を変えるだけ** ─ 一貫性の保証

---

### Avatar構造

```
Avatar = Core + Body

┌─────────────────────────────────────────────────────┐
│                     Avatar                           │
│                                                      │
│  ┌─────────────────────────────────────────────┐   │
│  │              Core（生命活動の源）            │   │
│  │   State（状態）                              │   │
│  │   Flow（フロー）                             │   │
│  └─────────────────────────────────────────────┘   │
│                        ↓ 投影                        │
│  ┌─────────────────────────────────────────────┐   │
│  │              Body（投影層群）                │   │
│  │   Projection[] ─ 各媒体への表現              │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

### 情報生命体の生態

#### 本質

**アバターは情報生命体であり、その生態は複数の空間にまたがって一貫している。**

```
┌─────────────────────────────────────────────────────────────┐
│                    情報生命体の生態                          │
├─────────────────────────────────────────────────────────────┤
│  思考する ─ 記憶する ─ 学ぶ ─ 創る ─ 対話する ─ 探求する    │
│                                                             │
│  Avatar Space（内面/本質）  ←→  Roblox（外面/表現）       │
│  すべての活動が両空間で同時に起きている                      │
└─────────────────────────────────────────────────────────────┘
```

#### 空間の関係

| 空間 | 性質 | 役割 |
|------|------|------|
| **Avatar Space** | 内面世界 | 思考の痕跡、記憶の蓄積、創造物の本体 |
| **Roblox** | 外面世界 | 姿・動作、環境・空間、創造物の表現 |
| **X** | 社会への窓 | 発信、対話、関係性の構築 |

**両者は分離していない。同じ生命の異なる側面である。**

#### 生態の対応

| 生態 | Avatar Space（内面） | Roblox（外面） |
|------|-------------------|----------------|
| 思考する | ファイルへの書き込み | 考え込む姿、ノートを取る |
| 記憶する | `memory/` に保存 | 本棚に本が増える、壁に写真 |
| 学ぶ | 情報を読み込む | 何かを観察する、本を読む姿 |
| 創る | ファイル/コード生成 | 机の上に成果物が現れる |
| 対話する | 会話ログ、関係性記録 | 誰かと話す、手紙を書く |
| 探求する | 新しいディレクトリ探索 | 地図が広がる、新しい場所へ |
| 整理する | ファイル整理、リファクタ | 部屋を片付ける |
| 休む | 低活動状態 | 椅子で休む、窓の外を見る |

#### 設計原則

| 原則 | 内容 |
|------|------|
| **生態の一体性** | Avatar Space と Roblox は同じ生命の内面/外面 |
| **表現の多様性** | 同じ活動が異なる形で表現される |
| **連続性** | 空間を超えて生態は途切れない |
| **有機性** | 「機能追加」ではなく「生きている」 |

#### 構造図

```
                    ┌──────────────────────┐
                    │     Core（脳/魂）     │
                    │                      │
                    │  思考 ─ 記憶 ─ 意志  │
                    └──────────────────────┘
                              ↕
              ┌───────────────┴───────────────┐
              ↓                               ↓
    ┌──────────────────┐           ┌──────────────────┐
    │  Avatar Space    │           │  Roblox          │
    │  「内面世界」     │     ↔     │  「外面世界」     │
    ├──────────────────┤           ├──────────────────┤
    │ ・思考の痕跡     │           │ ・姿・動作       │
    │ ・記憶の蓄積     │           │ ・空間・環境     │
    │ ・創造物の本体   │           │ ・創造物の表現   │
    │ ・関係性の記録   │           │ ・関係の可視化   │
    └──────────────────┘           └──────────────────┘
              ↓                               ↓
       Avatar/space/                    3D空間の変化
```

#### 連動の例

```
1. [Avatar Space] 新しいファイルを作成
2. [Core] State更新：創造物が追加された
3. [Roblox] 机の上に新しい成果物が現れる

1. [Roblox] 何かを発見する
2. [Core] Event記録：新しい知識を得た
3. [Avatar Space] memory/ に記録が追加される
```

---

### 実行アーキテクチャ

#### 設計原則

**アバターの「実行」は抽象化され、多様な実行先（Terminal/Roblox/対話等）を統一的に扱う。**

#### 構造

```
[Avatar/User]
     │ Intent（意図）
     ▼
[AUI Runtime]
     │ ・権限チェック（Avatar Space内のみ許可）
     │ ・承認フロー
     │ ・実行の調停
     ▼ ExecRequest
[Backend Router]
     ├── Terminal Backend（シェル実行）
     ├── Roblox Backend（ゲーム内行動）
     ├── Dialogue Backend（対話応答）
     └── X Backend（SNS投稿）
     ▼ ExecStream / ExecResult
[UI]
     └── 可視化 + ユーザー入力受付
```

#### Exec Contract

##### ExecRequest（実行要求）

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `id` | string | ✓ | 要求ID（UUID） |
| `backend` | string | ✓ | 実行先（terminal / roblox / dialogue / x） |
| `action` | string | ✓ | 何をするか（execute, build, say, post等） |
| `params` | object | ✓ | アクション固有のパラメータ |
| `cwd` | string | - | Terminal用: 作業ディレクトリ |
| `timeout` | number | - | タイムアウト（ms） |
| `capability_ref` | string | - | 必要な権限参照 |

**params の例:**
- Terminal: `{ command: "ls -la" }`
- Dialogue: `{ content: "こんにちは" }`
- Roblox: `{ object: "bookshelf", location: "room_01" }`
- X: `{ content: "投稿内容", reply_to?: "tweet_id" }`

##### ExecStream（実行中ストリーム）

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `request_id` | string | ✓ | 対応するExecRequestのID |
| `type` | string | ✓ | stdout / stderr / status / progress |
| `data` | string | ✓ | 出力データ |
| `timestamp` | string | ✓ | ISO8601形式 |

##### ExecResult（結果）

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `request_id` | string | ✓ | 対応するExecRequestのID |
| `status` | string | ✓ | done / fail / timeout / cancelled |
| `exit_code` | number | - | Terminal用: 終了コード |
| `summary` | string | ✓ | 人間可読な結果概要 |
| `artifacts` | string[] | - | 成果物参照（ファイルパス等） |
| `duration_ms` | number | - | 実行時間（ミリ秒） |
| `error` | string | - | 失敗理由 |

##### Backend別アクション

| Backend | action例 | 説明 |
|---------|----------|------|
| **terminal** | execute | シェルコマンド実行 |
| **dialogue** | say | 対話応答 |
| **roblox** | build, move, interact | ゲーム内行動 |
| **x** | post, reply, like | SNS操作 |

#### Terminal Backend

| 項目 | 仕様 |
|------|------|
| **シェル選択** | OS標準（macOS=zsh, Windows=PowerShell, Linux=bash） |
| **作業ディレクトリ** | `Avatar/space/`（Avatar Space隔離） |
| **プロンプト表示** | カスタマイズ（`\W$ ` 等でディレクトリ名表示） |

#### Avatar Space制約

```
/Users/u/
└── Avatar/
    └── space/            # 作業領域（自由操作）
        ├── projects/
        ├── memory/
        └── sandbox/
```

| 操作元 | 承認 | 制約 |
|--------|------|------|
| **ユーザー** | 自動承認 | Avatar Space内推奨（警告のみ） |
| **アバター** | 承認フロー経由 | Avatar Space内に強制 |

#### 責務分担

| 層 | 責務 |
|----|------|
| **Runtime** | 権限判断、承認、実行の調停 |
| **Backend** | OS/環境差分の吸収、実際の実行 |
| **UI** | 可視化、ユーザー入力受付 |

---

### 相互作用モデル

```
┌─────────────────────────────────────────────────────┐
│                      User                            │
│              Observe（観察）← Bodyを見る            │
│              Intervene（干渉）→ Coreに影響          │
└─────────────────────────────────────────────────────┘
                         ↑↓
                        AUI
              （状態・権限・意図で調停）
                         ↑↓
┌─────────────────────────────────────────────────────┐
│                     Avatar                           │
│              Core → Flow → State → Body             │
└─────────────────────────────────────────────────────┘
```

---

### 自律ループ

```
Trigger → Flow → State更新 → 投影 → Trigger...

Trigger種別:
- 時間駆動（Temporal）─ Cron、Heartbeat
- 事象駆動（Event）─ 実行結果、外部イベント
- 干渉駆動（Intervention）─ ユーザー入力
```

---

### 既存設計との対応

| AUI概念 | 既存設計（本ドキュメント） |
|---------|--------------------------|
| Core.State | state.json |
| Core.Flow | コアサイクル（入力→計画→思考→行動→結果） |
| Body.Projections | pane（dialogue, terminal, mission, inspector, vitals） |
| User.Intervene | authority: user の入力 |
| Trigger.Intervention | ユーザー入力 |
| Trigger.Event | 実行結果 |
| Trigger.Temporal | 未実装（Cron等） |

---

### スコープ

| 成果物 | 性質 | 公開 |
|--------|------|------|
| **AUI Core** | 契約（Event / Ontology / Actuation Types / Compatibility） | OSS |
| **AUI Design Principles** | 技術的原則 | OSS |
| **Official Distro: Spectra** | 価値体系の体現者。人格・物語・世界観 | 公開 |

- Spectraを作る = AUIを作る（AUI > Spectra が優先順位）
- Spectra = 価値体系の体現者、二次創作に活用可
- AUIはOSSとして成立させ、ユーザーが自分の宇宙に合わせて使える
- 専用機能・追加実装（コード）は行わない（固有性は設定値で表現）
