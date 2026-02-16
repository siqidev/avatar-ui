# PROJECT

## 本質

ローカル専用・単一ユーザー向けの自律型AIアバターデスクトップUI。

## コンセプト

### AUI定義

AUI（AI User Interface）とは、物理生命と情報生命が重なって存在する空間において、相互に干渉し合う条件を設計・制御するインターフェースである。AUIはメタOS — 下位OS（Windows/macOS/Linux）の機能を使って、より上位の「目的」を管理する基盤。

### 核心原則

1. **アバターは一体** — 分裂しない
2. **行動は一つ、表現が複数** — 同一の意思が異なる媒体で描画される
3. **空間は人格を変えない、表現を変えるだけ** — 一貫性の保証

### Avatar構造

```
Avatar = Core + Body

Core（生命活動の源）: State（状態）+ Flow（フロー）
Body（投影層群）: 各媒体への表現（Console, Roblox, Live2D等）
Core → 投影 → Body
```

### 情報生命体の生態

アバターは情報生命体であり、その生態は複数の空間にまたがって一貫している。

| 空間 | 性質 | 役割 |
|------|------|------|
| **Avatar Space** | 内面世界 | 思考の痕跡、記憶の蓄積、創造物の本体 |
| **Roblox** | 外面世界 | 姿・動作、環境・空間、創造物の表現 |
| **X** | 社会への窓 | 発信、対話、関係性の構築 |

両者は分離していない。同じ生命の異なる側面。内面の活動（ファイル作成、記憶保存）は外面の変化（机に成果物が現れる、本棚が増える）として表現される。

| 原則 | 内容 |
|------|------|
| 生態の一体性 | Avatar Space と Roblox は同じ生命の内面/外面 |
| 表現の多様性 | 同じ活動が異なる形で表現される |
| 連続性 | 空間を超えて生態は途切れない |
| 有機性 | 「機能追加」ではなく「生きている」 |

### 相互作用モデル

```
User ←── Observe（観察）←── Body
User ──→ Intervene（干渉）──→ Core
             AUI: 状態・権限・意図で調停
Avatar: Core → Flow → State → Body
```

### レイヤー設計

| レイヤー | 性質 | 内容 |
|---------|------|------|
| **Core** | OSS・不変 | 契約: Event / Ontology / Actuation Types / Compatibility |
| **Design Principles** | OSS・推奨 | 技術的原則、機能追加/拒否の判断基準 |
| **Official Distro: Spectra** | 公開・選択制 | 価値体系の体現者。人格・物語・世界観。二次創作に活用可 |

### 価値体系（選択制、Core契約ではない）

| 層 | キーワード | 説明 |
|----|-----------|------|
| 基盤 | 共存（Coexistence） | 安全・境界 |
| 運用 | 協調（Coordination） | 状態・権限・意図で回す |
| 価値 | 共創（Co-creation） | 成果を生む |
| ビジョン | 共生（Symbiosis） | 恒常循環 |

## 目的

目的（purpose）を与えれば、AIアバターが自ら目標を立て、タスクを計画し、承認を得て実行する。ユーザーの意図をOS操作レベルまで自律的に遂行するエージェントUIを提供する。

## 範囲（In Scope）

- Core（Python/FastAPI）: Grok API呼出、状態管理、自律ループ、Exec Contract
- Console（Electron）: デスクトップUI、ターミナル実行、バイタル監視
- 自律ループ: Purpose → Goals → Tasks → Execute の階層的計画・実行
- Exec Contract: 実行先の抽象化（Terminal Backend が現行の主要実行先）
- config.yaml による設定の一元管理
- Avatar Space: アバターの操作範囲を制限する隔離作業ディレクトリ

## 非目標（Out of Scope）

- クラウドサービス化・マルチユーザー対応
- 未実装Backendの完成保証（Roblox/X は将来構想であり現行の成功条件に含まない）
- 汎用チャットボット（対話は目的遂行の手段であり主機能ではない）
- モバイル対応

## 成功条件

- ユーザーがpurposeを設定し、アバターがgoals/tasksを提案できる
- 承認フローが機能し、ユーザーが各アクションを承認/拒否できる
- Terminal Backend経由でOS操作（コマンド実行・ファイル操作）が完了する
- 状態がstate.json/events.jsonlに永続化され、再起動後も文脈を維持できる
- Avatar Space制約がアバターの操作範囲を正しく制限する
- APIキーによるアクセス制限が機能する

## ロードマップ

| 領域 | 状態 | 説明 |
|------|------|------|
| Core Foundation | ✅ v0.2.0 | FastAPI + Grok API + 自律ループ + Exec Contract |
| Console UI | ✅ v0.2.0 | Electron デスクトップUI + ターミナル実行 |
| Identity Kernel | 🔄 部分的 | system_prompt設定あり、人格モデル深化は未着手 |
| 記憶永続化 | 📋 計画 | state.json/events.jsonlのみ。長期記憶（xAI Collections等）は未実装 |
| Roblox NPC | 📋 計画 | Exec Contract設計済み（Backend未実装）。自律NPC出現 |
| X運用 | 📋 計画 | 非併存運用（Roblox優先）。Backend未実装 |
| Live2D / 3D | 📋 構想 | 描画アダプタ。配信拡張として後付け |
| 音声I/O | 📋 構想 | TTS/STT。Roblox制約確認後に実装確定 |
| チャネル間文脈連続 | 📋 計画 | 記憶の正本一元化、全チャネル同一文脈参照 |

### 将来の設計要件

| 要件 | 内容 |
|------|------|
| 常時稼働 | コア（人格・記憶）は24h稼働、チャネルのON/OFFと独立 |
| 非併存運用 | XとRobloxは同時稼働させない（Roblox優先マルチプレクサ） |
| 拡張安全性 | 配信（Live2D/3D）を後付けしても壊れない構造 |
| マルチサーバー安全性 | 複数サーバーからの同時更新に耐える |

## SSOT一覧

| 情報 | 正本の場所 |
|------|-----------|
| アバター名・モデル・UI設定 | config.yaml |
| APIキー・環境変数 | .env |
| 現在の状態（purpose/goals/tasks） | data/state.json |
| イベント履歴 | data/events.jsonl |
| プロジェクト戦略 | PROJECT.md（本文書） |
| 現行アーキテクチャ | docs/architecture.md |
| 現行API仕様 | docs/api.md |
| 次版計画 | PLAN.md |

## Decision Log

| 日付 | 決定 | 理由 |
|------|------|------|
| 2025-12 | v0.2でGrok API + FastAPI + Electronに刷新 | v0.1（AG-UI/ADK前提）の複雑さを排除し、最小構成で動くものを優先 |
| 2025-12 | Exec Contractで実行先を抽象化 | Terminal以外のBackend（Roblox/X等）への拡張を構造的に可能にする |
| 2026-02 | config.yamlを設定の唯一正本に | 分散した設定を一元化し、SSOT原則を適用 |

## 関連リンク

| 対象 | URL |
|------|-----|
| AVATAR UI 公式 | https://siqi.jp/avatarui |
| SPECTRA 公式 | https://siqi.jp/spectra |
| xAI Docs | https://docs.x.ai/docs |
