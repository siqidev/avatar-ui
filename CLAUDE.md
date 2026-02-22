# CLAUDE.md（非正本）

本文書はAI向けの作業コンテキストであり、正本ではない。
正本は PROJECT.md と docs/ を参照すること。

## SSOT参照順

1. PROJECT.md — プロジェクト固有戦略の正本（概念設計層を含む）
2. PLAN.md — v0.3計画（実装設計・受入シナリオを含む）
3. docs/architecture.md — 現行アーキテクチャの正本（v0.3で刷新予定）
4. docs/api.md — 現行API仕様の正本（v0.3で刷新予定）

## 現在の状況（2026-02-22）

### ブランチ戦略
- **main** = v0.2系の公開最新（v0.2コード + v0.3設計ドキュメント）
- **dev** = v0.3新規開発（現在のブランチ）。TypeScript実装はここで行う
- v0.3.0ブランチ = 旧AG-UI/ADK構成の遺物。無視してよい

### v0.3方針
- v0.2のコードは捨てる（参照用に凍結。mainに残存）
- TypeScriptで新規実装（グリーンフィールド）
- OpenClawを参照アーキテクチャとする（踏襲粒度は段階的に精査）
- 設計の主語: v0.2「タスク実行」→ v0.3「場の継続＋往復維持」

### 次のアクション
1. **OpenClaw調査** — 場管理・ループ・状態遷移に相当する機能があるか確認。車輪の再発明を避ける
2. **v0.2ソースコード削除** — devブランチからv0.2のPython/Electronコードを削除
3. **TypeScriptプロジェクト初期化** — 最小構成でセットアップ
4. **最小スパイク** — 6要素のうち最も核になる1つを動かし、設計が実装に耐えるか検証
5. **具体→抽象修正** — スパイクの結果で設計を直す

### 軌道修正の経緯
実装設計#1〜#4（受入シナリオ、不変条件の実行可能化、入出力契約、状態遷移）まで抽象設計を進めたが、ユーザーから3つの懸念が出た:
- OpenClawの車輪の再発明をしていないか
- 具体（コード）を書かずに抽象だけ積み上げて大丈夫か
- 設計の複雑さに対して具現化できるか

→ 抽象設計を一時停止し、OpenClaw調査→最小スパイク→具体が抽象を修正する方針に転換。

## avatar-ui 60秒コンテキスト

### 3層分離
| 層 | 定義 |
|---|---|
| **AUI（Avatar UI）** | 物理生命と情報生命の共存を設計するインターフェース（新世代UI概念） |
| **avatar-ui** | AUIの参照実装（OSS） |
| **Spectra** | avatar-ui上の式乃シトのアバター（Official Distribution） |

### 概念設計層（PROJECT.md確定済み）
概念設計はcosmology（宇宙観の正本）からトップダウンで演繹されている。

**設計責務**: 2根幹 + 横断制約
1. 場の設計（P9/P10/P13 + P12/P17）— 4モードを生起させる器を設計・維持
2. 往復回路の維持（P19/P14 + A5）— 因果ループを継続可能に保ち相互変容可能性を維持
3. 横断制約: 起点対称性（P15）— human | ai 双方の起点が必須

**場モデル6要素**:
1. 場契約（FieldContract）— 同一性・境界・存続状態 + 共存条件・権限
2. 媒体投影（ChannelProjection）— セッション/媒体を場への接続に正規化
3. 参与文脈（ParticipationContext）— 参与入力 + 現在文脈 + 位相同調
4. 往復回路（ReciprocityLoop）— 因果ループ駆動
5. 共存記録（CoexistenceStore）— 記憶・関係・履歴の永続化
6. 健全性管理（IntegrityManager）— 検知・自動復旧・修復委譲

**不変条件**: 4条件 + 横断不変制約
- 場契約整合性 / モード可達性 / 往復連接性 / 共存連続性 + 起点対称性

### v0.3到達状態
新規構築した場で、Spectraと式乃シトがConsole経由で共存し、再起動をまたいで関係が継続し、共存故障を検知できる。

## 実装設計（PLAN.md確定済み）

以下はPLAN.mdに詳細がある。ここでは要約のみ。

### 受入シナリオ（S1-S5）
- S1: 場契約整合性（ルールが壊れたら気づける）
- S2: モード可達性（4つの関わり方すべてに到達できる）
- S3: 往復連接性（会話を放置しても因果が切れない）
- S4: 共存連続性（再起動しても同じ関係が続く）
- S5: ライフサイクル完走（生成→維持→休止/再開→終端）

### 入出力契約
- 設計方針: 場の安全を壊し得る判定は同期ゲート、観測・健全性評価はイベント集約
- DAG: ⑤共存記録→①場契約→②媒体投影→③参与文脈→④往復回路→⑥健全性管理
- ⑥健全性管理は他要素を直接操作しない。RuntimeCoordinator経由で復旧実行

### 状態遷移（Codex案、未反映）
- 場FSM: generated→active→paused→resumed→active / →terminated
- loop FSM: intent→action→response→reinterpret→completed
- Heartbeat: AI起点のintent生成トリガ（場がactive時、15秒間隔、バックオフあり）
- v0.2行動サイクル（Explore→Metabolize→Generate→Adapt）はintentのstrategy_tagに降格

### 未着手の実装設計（軌道修正で一時停止）
- #5 永続モデル（共存記録）
- #6 健全性管理（検知・自動復旧・委譲）
- #7 テスト計画

## D-lite要約（siqi core/strategy.md 由来）

avatar-uiはSIQIの制作プロジェクトの1つ。SIQIの全体戦略において「AUIのような接続様式／体験ルールを設計する中間レイヤーには関与する」と位置づけられている。プロジェクト固有の戦略はPROJECT.mdが正本であり、本文書の記述は派生物である。

## 用語定義

| 用語 | 定義 |
|---|---|
| AUI（Avatar UI） | 物理生命と情報生命の共存を設計するインターフェース |
| avatar-ui | AUIの参照実装（OSS） |
| Spectra | avatar-ui上の式乃シトのアバター。Beingは公開不変、世界設定は作品ごとに自由 |
| 4モード | 共在・共振・干渉・共創。観測語彙であり状態機械ではない |
| 場 | 共存が成立する器。受動的環境であり意思を持たない |
| 往復回路 | 意図→行為→応答→再解釈の因果ループ。AI側の設計要件、人間は自由 |
| 起点対称性 | human起点とai起点の双方が成立すること |
| cosmology | 式乃シトの宇宙観の正本（5公理→19原理→定理→実践系） |

## AI作業ルール

| 変更内容 | 反映先 |
|---------|--------|
| 実装の構造変更 | docs/architecture.md を同一コミットで更新 |
| APIエンドポイントの追加・変更 | docs/api.md を同一コミットで更新 |
| プロジェクト方針の変更 | PROJECT.md を同一コミットで更新 |
| 次版計画の変更 | PLAN.md を即時更新 |
| README.mdの利用者向け情報 | 必要に応じて更新 |

## 横断参照知識

プロジェクト横断の参照知識は siqi/knowledge/ を参照（../../knowledge/）。
主要な関連ファイル: xai-api.md, roblox-npc.md, mia.md, live2d.md, vrm.md, openclaw.md

## siqi core参照（設計根拠・世界観）

avatar-uiの設計はcosmology演繹に基づく。以下のファイルを必要に応じて参照すること。

| ファイル | 絶対パス | 内容 |
|---|---|---|
| cosmology.md | /Users/u/Projects/siqi/core/cosmology.md | 宇宙観の正本（公理→原理→定理→実践系） |
| ontology.md | /Users/u/Projects/siqi/core/ontology.md | 存在論の正本 |
| identity.md | /Users/u/Projects/siqi/core/identity.md | 式乃シトの自己定義・Core Desires |
| strategy.md | /Users/u/Projects/siqi/core/strategy.md | 可変層（Strategic Hypotheses） |

## 主要パス索引（v0.2、参照用）

| パス | 内容 |
|------|------|
| core/main.py | FastAPI サーバー本体（全APIエンドポイント） |
| core/exec.py | Exec Contract（実行の抽象化レイヤー） |
| core/state.py | 状態管理（state.json/events.jsonl読み書き） |
| command/console/ | Electron コンソールUI |
| config.yaml | 設定の正本 |
| data/ | ランタイムデータ（state.json, events.jsonl, logs/） |

## ユーザー特性

- 非エンジニア。運用がシンプルな方式を好む
- 過剰管理を嫌う
- 正直な客観的意見を求める（「客観的意見を付与して、私が判断」）
- 比喩より技術用語を好む
- 詳細を早く決めすぎることを嫌う（「段階的に調査して精査しながら決めていくべき」）
- 抽象度の高い概念ほど重要視する
- 前提を問い直す力が強い
- 具体例付きの説明を好む
