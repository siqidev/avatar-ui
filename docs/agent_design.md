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
[状態: input | plan | thought | action | result]
                    ↓
              [Persistence]
          state.json + events.jsonl
                    ↓
               [Output]
      pane = chat / cli / plan / inspector / vitals
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
- 単一chatオブジェクト（sourceで文脈分離）

---

## 3. データモデル

### 状態要素（5項目）

| 要素 | 構造 | 更新者 |
|------|------|--------|
| input | source, authority, text | 入力イベント |
| plan | purpose, goals[] | 思考 |
| thought | judgment, intent | 思考 |
| action | phase, summary | 行動 |
| result | status, summary | 行動 |

### state.json

保存先: `logs/state.json`

```json
{
  "input": {
    "source": "chat | cli | discord | roblox | x",
    "authority": "user | public",
    "text": "..."
  },
  "plan": {
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
- plan.goals: active目標のみ（doneはevents.jsonlに記録）

### events.jsonl

保存先: `logs/events.jsonl`

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
{"time":"2026-01-21T12:00:00Z","type":"input","source":"chat","text":"READMEを更新して"}
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
| 短期 | chatオブジェクト | LLMコンテキスト（思考時に参照） |
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
  "source": "chat | cli | discord | roblox | x",
  "authority": "user | public",
  "text": "..."
}
```

**authority導出:**

| source | authority |
|--------|-----------|
| chat | user |
| cli | user |
| discord | user |
| roblox | public |
| x | public |

### 出力

UI系（chat, cli等）: 自然言語
state用（state.json, events.jsonl）: JSON

```json
{
  "pane": "chat | cli | plan | inspector | vitals",
  "data": "..."
}
```

| pane | data の内容 | 取得元 |
|------|-------------|--------|
| chat | 文字列（自然言語） | リアルタイム |
| cli | 文字列（自然言語） | リアルタイム |
| plan | 目的/目標/タスク | state.json |
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

### 計画ペイン

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
| source | 入力元（chat, cli, discord, roblox, x, ...） |
| authority | 権限（user, public）※sourceから自動導出 |
| pane | 表示先ペイン（chat, cli, plan, inspector, vitals） |
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
| purposeなし | Avatarがchatで問いかけ → ユーザーが入力 → サイクル開始 |

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
    "type": "chat | execute | approve_request",
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
