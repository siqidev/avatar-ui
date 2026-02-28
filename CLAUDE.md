# CLAUDE.md（非正本）

本文書はAI向けの作業コンテキストであり、正本ではない。
正本は PROJECT.md と docs/ を参照すること。

## SSOT参照順

1. PROJECT.md — プロジェクトの本質・概念設計・戦略・Decision Log（バージョン非依存）
2. PLAN.md — 計画・受入シナリオ・実装バックログ（バージョン固有）
3. docs/architecture.md — 現行実装の事実記述（コード構造・IPC・SSOT一覧）

## 現在の状況（2026-02-28）

### ブランチ戦略
- **main** = v0.2系の公開最新（v0.2コード + v0.3設計ドキュメント）
- **dev** = v0.3新規開発（現在のブランチ）。TypeScript実装はここで行う
- v0.3.0ブランチ = 旧AG-UI/ADK構成の遺物。無視してよい

### v0.3方針
- v0.2のコードは捨てる（参照用に凍結。mainに残存）
- TypeScriptで新規実装（グリーンフィールド）
- OpenClawを参照アーキテクチャとする（踏襲粒度は段階的に精査）
- 設計の主語: v0.2「タスク実行」→ v0.3「場の継続＋往復維持」

### 開発状況
Console UI全ペイン実装済み + Roblox双方向接続動作中 + 設定管理一元化済み + ⑥健全性管理実装済み（検知+通知+凍結）。テスト185件。詳細はPLAN.mdの開発進捗とdocs/architecture.mdを参照。

### 次のアクション
PLAN.md「実装バックログ」の必須タスクを参照。

## プロジェクト概要（詳細はPROJECT.md）

| 層 | 定義 |
|---|---|
| **AUI（Avatar UI）** | 物理生命と情報生命の共存を設計するインターフェース |
| **avatar-ui** | AUIの参照実装（OSS） |
| **Spectra** | avatar-ui上の式乃シトのアバター |

- 概念設計（場モデル6要素・不変条件・設計責務）→ PROJECT.md
- 用語定義 → PROJECT.md
- D-lite（SIQI戦略との関係）→ siqi/core/strategy.md

## AI作業ルール

| 変更内容 | 反映先 |
|---------|--------|
| 実装の構造変更 | docs/architecture.md を同一コミットで更新 |
| APIエンドポイントの追加・変更 | docs/api.md を同一コミットで更新 |
| プロジェクト方針の変更 | PROJECT.md を同一コミットで更新 |
| 次版計画の変更 | PLAN.md を即時更新 |
| README.mdの利用者向け情報 | 必要に応じて更新 |

## 外部参照

### 横断参照知識
プロジェクト横断の参照知識は siqi/knowledge/ を参照（../../knowledge/）。
主要な関連ファイル: xai-api.md, roblox-npc.md, mia.md, live2d.md, vrm.md, openclaw.md

### siqi core（設計根拠・世界観）
| ファイル | 絶対パス | 内容 |
|---|---|---|
| cosmology.md | /Users/u/Projects/siqi/core/cosmology.md | 宇宙観の正本（公理→原理→定理→実践系） |
| ontology.md | /Users/u/Projects/siqi/core/ontology.md | 存在論の正本 |
| identity.md | /Users/u/Projects/siqi/core/identity.md | 式乃シトの自己定義・Core Desires |
| strategy.md | /Users/u/Projects/siqi/core/strategy.md | 可変層（Strategic Hypotheses） |

## 主要パス索引

エントリーポイントと主要サービスのみ。全構成はdocs/architecture.mdを参照。

| パス | 内容 |
|------|------|
| src/cli.ts | CLIエントリーポイント |
| src/config.ts | getConfig()遅延singleton（唯一のprocess.env入口） |
| src/services/chat-session-service.ts | Grok Responses API呼出+ツール実行ループ |
| src/main/index.ts | Electron Mainエントリーポイント |
| src/main/field-runtime.ts | FieldRuntime（場のロジック統合） |
| src/main/ipc-handlers.ts | IPC受信→FieldRuntime |
| src/renderer/main.ts | Rendererエントリー |
| src/tools/ | Grokツール定義 |
| roblox/ | Roblox Studio用スクリプト群 |

## ユーザー特性

- 非エンジニア。運用がシンプルな方式を好む
- 過剰管理を嫌う
- 正直な客観的意見を求める（「客観的意見を付与して、私が判断」）
- 比喩より技術用語を好む
- 詳細を早く決めすぎることを嫌う（「段階的に調査して精査しながら決めていくべき」）
- 抽象度の高い概念ほど重要視する
- 前提を問い直す力が強い
- 具体例付きの説明を好む
