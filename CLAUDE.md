# CLAUDE.md（非正本）

本文書はAI向けの作業コンテキストであり、正本ではない。
正本は docs/ を参照すること。

## SSOT参照順

1. siqi/knowledge/tech/avatar-ui-project.md — プロジェクトの本質・概念設計・戦略・Decision Log（バージョン非依存）
2. docs/PLAN.md — 到達状態・実装バックログ・受入シナリオ（リリースごとに上書き）
3. docs/architecture.md — 現行実装の事実記述（コード構造・IPC・SSOT一覧）

## 現在の状況（2026-03-31）

### ブランチ戦略
- **main**: リリース済みの安定版
- **dev**: 次バージョン開発ブランチ。mainから分岐し、安定したらmainにマージ
- ルール詳細は `~/.claude/rules/git-workflow.md` を参照

### 開発状況
v0.5.1リリース済み（2026-03-31）。次版の計画はdocs/PLAN.mdの実装バックログを参照。

## プロジェクト概要（詳細はsiqi/knowledge/tech/avatar-ui-project.md）

| 層 | 定義 |
|---|---|
| **AUI（Avatar UI）** | 物理生命と情報生命の共存を設計するインターフェース |
| **avatar-ui** | AUIの参照実装（OSS） |
| **Spectra** | avatar-ui上の式乃シトのアバター |

- 概念設計（場モデル6要素・不変条件・設計責務）→ siqi/knowledge/tech/avatar-ui-project.md
- 用語定義 → siqi/knowledge/tech/avatar-ui-project.md
- D-lite（SIQI戦略との関係）→ siqi/core/strategy.md

## AI作業ルール

| 変更内容 | 反映先 |
|---------|--------|
| 実装の構造変更 | docs/architecture.md を同一コミットで更新 |
| APIエンドポイントの追加・変更 | docs/api.md を同一コミットで更新 |
| プロジェクト方針の変更 | siqi/knowledge/tech/avatar-ui-project.md を同一コミットで更新 |
| 次版計画の変更 | docs/PLAN.md を即時更新 |
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
| src/config.ts | getConfig()遅延singleton（唯一のprocess.env入口） |
| src/services/chat-session-service.ts | Grok Responses API呼出+ツール実行ループ |
| src/main/index.ts | Electron Mainエントリーポイント |
| src/runtime/field-runtime.ts | FieldRuntime（場のロジック統合） |
| src/runtime/field-orchestrator.ts | 場の起動・FSM遷移・stream処理統括 |
| src/main/ipc-handlers.ts | IPC配線（orchestratorへのアダプタ） |
| src/headless/index.ts | ヘッドレスエントリーポイント（Console UI HTTP配信+WS+Runtime統合起動） |
| src/runtime/console-http-server.ts | Console UI HTTP配信（ブラウザ用ポリフィル注入） |
| src/runtime/session-ws-server.ts | セッションWSサーバー（event bus→クライアント配信、ping/pong） |
| src/runtime/approval-hub.ts | 承認ハブ（Console・Discord両対応、first-response-wins） |
| src/discord/discord-bridge.ts | Discord窓口（stream購読+承認応答） |
| src/runtime/ | Electron非依存のランタイム基盤（承認ハブ・設定・ターミナル・FS） |
| src/main/menu.ts | Electronカスタムメニュー（AUIメニュー） |
| src/renderer/main.ts | Rendererエントリー |
| src/tools/ | Grokツール定義（x_post/x_reply/x_quote_repost含む） |
| roblox/ | Roblox Studio用スクリプト群（OSS、Rojo同期） |
| Spectra/ | Spectra固有リポ（.gitignore除外）。PLAN.md=開発プラン、roblox/WORKSPACE.md=空間構造、config/=人格設定 |

## ユーザー特性

- 非エンジニア。運用がシンプルな方式を好む
- 過剰管理を嫌う
- 正直な客観的意見を求める（「客観的意見を付与して、私が判断」）
- 比喩より技術用語を好む
- 詳細を早く決めすぎることを嫌う（「段階的に調査して精査しながら決めていくべき」）
- 抽象度の高い概念ほど重要視する
- 前提を問い直す力が強い
- 具体例付きの説明を好む
