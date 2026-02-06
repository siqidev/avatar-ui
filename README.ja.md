# AVATAR UI

<p align="center">
  📖 <a href="./README.md">English</a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

デスクトップで動く、自分専用AIアバターのエージェントUI。  
目的を与えれば、アバターが自ら計画し実行する。

![demo](./docs/assets/demo_v0.2.ja.gif)

<p align="center">
  <a href="https://www.geckoterminal.com/solana/pools/ky7frWSyXRcHKvN7UXyPuhA5rjP1ypDPDJNEHxJubmJ" target="_blank" rel="noopener">
    <img src="./docs/assets/geckoterminal-logo.png" alt="GeckoTerminal トークン情報" width="320" />
  </a>
  <br />
  <sub>Token info by GeckoTerminal</sub>
</p>

<p align="center">
  <a href="https://orynth.dev/projects/avatar-ui" target="_blank" rel="noopener">
    <img src="https://orynth.dev/api/badge/avatar-ui?theme=dark&style=default" alt="Featured on Orynth" width="260" height="80" />
  </a>
  <br />
  <sub>Market by Orynth</sub>
</p>

## 特徴

- **ローカル専用** – 自分のマシンで完結
- **自律ループ** – 目的 → 目標 → タスクの階層構造で自動計画
- **OS操作** – ファイル操作やコマンド実行をアバターが提案・実行
- **Avatar Space** – 隔離された作業領域
- **Grokスタック統合** – Web/Xから情報を自動取得
- **リアルタイム監視** – CPU/メモリ/API使用量

## 使い方

1. Coreを起動 → Consoleが表示される
2. 目的を設定 → アバターが目標・タスクを提案
3. 各アクションを承認または拒否
4. アバターが実行し結果を報告

## スラッシュコマンド

スラッシュコマンドでモデル・温度・言語・タスクの制御ができます。

- `/language <ja|en>` – UI言語の切替
- `/model <name>` – モデル切替（例: `grok-4-1-fast-non-reasoning`）
- `/reset` – 目的・目標・タスクをリセット
- `/retry <task-id>` – タスクIDで再試行（例: `G4-T1`）
- `/temperature <0.0-2.0>` – 温度（サンプリングの揺らぎ）
- `/theme <classic|cobalt|amber>` – UIテーマ切替

## クイックスタート

### 前提条件

- Python 3.10+
- Node.js 18+
- [xAI APIキー](https://x.ai/)

### 1. リポジトリを取得

```bash
git clone https://github.com/siqidev/avatar-ui.git
cd avatar-ui
```

### 2. セットアップ（ターミナル2つ推奨）

ターミナルA（Core）:

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
```

ターミナルB（Console）:

```bash
cd command/console && npm install
```

`.env` を開いて最低限以下を設定:

```
XAI_API_KEY=your-xai-api-key
AVATAR_API_KEY=your-secret-key
AVATAR_CORE_URL=http://127.0.0.1:8000/v1/think
```

| 変数 | 必須 | 説明 |
|------|------|------|
| `XAI_API_KEY` | ✅ | xAI API（Grok）のキー |
| `AVATAR_API_KEY` | ✅ | Core APIアクセス制限用 |
| `AVATAR_CORE_URL` | ✅ | Core APIのURL |
| `AVATAR_SHELL` | | 使用するシェル（デフォルト: OS標準） |
| `AVATAR_SPACE` | | 作業ディレクトリ（デフォルト: ~/Avatar） |

### 3. 起動

ターミナル1（Core）:

```bash
source .venv/bin/activate
python -m uvicorn core.main:app --host 127.0.0.1 --port 8000
```

ターミナル2（Console）:

```bash
cd command/console && npm start
```

## 設定

`config.yaml` を編集:

```yaml
avatar:
  name: AVATAR             # 表示名

grok:
  model: grok-4-1-fast-non-reasoning  # 既定モデル
  temperature: 1.0         # 温度
  daily_token_limit: 100000  # 1日あたりのトークン上限

system_prompt: |
  技術的で直接的なスタイルで簡潔に応答してください。  # システムプロンプト
```

| 項目 | 設定場所 |
|------|----------|
| アバター名・ペルソナ | `config.yaml` → `avatar`, `system_prompt` |
| テーマ・色 | `config.yaml` → `console_ui` |
| アバター画像 | `command/console/assets/` |

## サポート

AUIはAVATAR UIを応援するコミュニティトークンです。  
Orynthに掲載されており、市場情報はGeckoTerminalで確認できます。

Token CA (Solana): `63rvcwia2reibpdJMCf71bPLqBLvPRu9eM2xmRvNory`

- Orynth: https://orynth.dev/projects/avatar-ui
- GeckoTerminal: https://www.geckoterminal.com/solana/pools/ky7frWSyXRcHKvN7UXyPuhA5rjP1ypDPDJNEHxJubmJ

> 本セクションは情報提供を目的としており、投資助言や勧誘を意図するものではありません。

## セキュリティ

AVATAR UIはOS権限でコマンドを実行します。

| 原則 | 内容 |
|------|------|
| **ローカル専用** | 自分だけが使用する前提で設計 |
| **承認フロー** | コマンド実行前に内容を確認 |
| **APIキー管理** | `.env`をgit管理外に保持 |

## ライセンス

[MIT License](LICENSE)

© 2025 [SIQI](https://siqi.jp) (Sito Sikino)
