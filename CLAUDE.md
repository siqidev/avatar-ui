# CLAUDE.md（非正本）

本文書はAI向けの作業コンテキストであり、正本ではない。
正本は PROJECT.md と docs/ を参照すること。

## SSOT参照順

1. PROJECT.md — プロジェクト固有戦略の正本
2. docs/architecture.md — 現行アーキテクチャの正本
3. docs/api.md — 現行API仕様の正本
4. PLAN.md — 次版計画（一時的）

## D-lite要約（siqi core/strategy.md 由来）

avatar-uiはSIQIの制作プロジェクトの1つ。SIQIの全体戦略において「AUIのような接続様式／体験ルールを設計する中間レイヤーには関与する」と位置づけられている。プロジェクト固有の戦略はPROJECT.mdが正本であり、本文書の記述は派生物である。

## avatar-ui 60秒コンテキスト

- 自律型AIアバターのデスクトップエージェントUI（ローカル専用・単一ユーザー）
- 2コンポーネント: Core（Python/FastAPI）+ Console（Electron）
- Grok API（xai-sdk）で思考、自律ループ（Purpose→Goals→Tasks→Execute）で行動
- 状態永続化: data/state.json + data/events.jsonl
- 設定正本: config.yaml
- 現行バージョン: v0.2.0

## 用語定義

| 用語 | 定義 |
|------|------|
| Avatar | 自律的に行動するAIエージェント（config.yamlで名前を設定） |
| SPECTRA | AVATAR UIから生まれた情報生命体プロトタイプ。本プロジェクトの実証体 |
| AUI (AVATAR UI) | SPECTRAの技術スタックを汎用化したOSS基盤 |
| Identity Kernel | 人格モデルの中核。思考の「深さ」を実装する |
| Deep Context | 会話ログを長期保存し、文脈に応じて引き出す記憶の永続化システム |
| source | 入力元（dialogue, terminal, discord, roblox, x） |
| authority | 権限（user, public）。sourceから自動導出 |
| pane | 表示先（dialogue, terminal, mission, inspector, vitals） |
| purpose | 目的（最上位の方針） |
| goal | 目標（目的を達成するためのマイルストーン） |
| task | タスク（目標を達成するための具体的な作業） |
| アダプタ | CLI/Live2D/VRM/Roblox等、出力先を切り替える抽象層 |

## AI作業ルール

| 変更内容 | 反映先 |
|---------|--------|
| 実装の構造変更 | docs/architecture.md を同一コミットで更新 |
| APIエンドポイントの追加・変更 | docs/api.md を同一コミットで更新 |
| プロジェクト方針の変更 | PROJECT.md を同一コミットで更新 |
| 次版計画の変更 | PLAN.md を即時更新 |
| README.mdの利用者向け情報 | 必要に応じて更新 |

## 主要パス索引

| パス | 内容 |
|------|------|
| core/main.py | FastAPI サーバー本体（全APIエンドポイント） |
| core/exec.py | Exec Contract（実行の抽象化レイヤー） |
| core/state.py | 状態管理（state.json/events.jsonl読み書き） |
| command/console/ | Electron コンソールUI |
| config.yaml | 設定の正本 |
| data/ | ランタイムデータ（state.json, events.jsonl, logs/） |
