<p align="center">
  <img src="docs/assets/banner.svg" alt="Avatar UI" width="800" />
</p>

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

<p align="center">
  <a href="./README.md">English version</a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

物理生命と情報生命の共存インターフェース。

AVATAR UI（AUI）は、AIアバターと人間が永続的な「場」を共有するアプリケーションです。セッションを跨ぎ、再起動を跨ぎ、メディア（コンソール＋Roblox＋X＋Discord）を跨いで、継続的な往復対話を維持します。

## 特徴

- **Console UI** — 7ペインインターフェース（Avatar / Space / Canvas / X / Stream / Terminal / Roblox）
- **ヘッドレスモード** — サーバーとして起動し、ブラウザからアクセス
- **Discord連携** — 外出先から会話確認・ツール承認
- **アバターモーション** — アバターのピクセルアート表現（待機モーション＋瞬き＋リップシンク）
- **共振モード** — アバターが周囲の変化を感知し、自発的に応答する
- **自発行動（Pulse）** — 人間の入力を待たず、アバターが自発的に動く
- **長期記憶（RAG）** — アバターは重要だと判断したことを自分で記憶する
- **Avatar Space** — AIが読み書きできる専用ファイルシステム
- **Terminal** — AIと人間がシェルを共有（コマンド実行＋出力確認）
- **Roblox連携** — アバターとRoblox空間で対話し、プレイヤーに追従する
- **X（Twitter）連携** — コンソールからXに投稿、メンションやイベントを監視

<p align="center">
  <img src="docs/assets/console.png" alt="Console UI" width="800" />
</p>

## クイックスタート

### 前提条件

- Node.js 20+
- [xAI APIキー](https://console.x.ai/)

### 1. クローンとインストール

```bash
git clone https://github.com/siqidev/avatar-ui.git
cd avatar-ui
npm install
```

### 2. 設定

```bash
cp .env.example .env
```

最低限の設定:

```
XAI_API_KEY=your-xai-api-key
```

これだけで基本動作します。オプション機能は[環境変数](#環境変数)を参照。

### 3. アイデンティティファイルの作成

```bash
cp BEING.example.md BEING.md
cp PULSE.example.md PULSE.md
```

アバターの人格と定期行動を定義します。

### 4. 起動

```bash
# ヘッドレスモード（VPS / ローカル共通。ブラウザで http://localhost:3002 にアクセス）
npm start

# Electron GUIモード（ローカル開発向け）
npm run dev
```

## 環境変数

| 変数 | 必須 | デフォルト | 説明 |
|------|------|----------|------|
| `XAI_API_KEY` | Yes | — | xAI APIキー（Grok用） |
| `AVATAR_NAME` | | `Avatar` | アバターの表示名 |
| `USER_NAME` | | `User` | ユーザーの表示名 |
| `AVATAR_SPACE` | | `~/Avatar/space` | Avatar Spaceのルートパス |
| `PULSE_CRON` | | `0 6 * * *` | AI起点Pulseの発火間隔 |
| `TERMINAL_SHELL` | | `zsh` | ターミナルペインのシェル |
| `AVATAR_SHELL` | | `off` | AIのシェル実行権限（`on` = AIがコマンド実行可能） |
| `TOOL_AUTO_APPROVE` | | `save_memory,fs_list,fs_read` | ユーザー承認なしで自動実行するツール |
| `DEV_MODE` | | `off` | 開発者モード（on = 詳細ログ + ソースタグ表示 + Roblox Monitor全表示） |
| `SESSION_WS_PORT` | | `3002` | WebSocketサーバーポート（Console UI通信用） |
| `SESSION_WS_TOKEN` | | — | WebSocket認証トークン（セキュリティ用、任意） |
| `XPULSE_CRON` | | `0 5,9 * * *` | X投稿Pulseの発火間隔（cron形式、UTC。デフォルト = JST 14:00/18:00） |

### オプション: 長期記憶（Collections API）

| 変数 | 説明 |
|------|------|
| `XAI_MANAGEMENT_API_KEY` | xAI Management APIキー |
| `XAI_COLLECTION_ID` | メモリ保存先のCollection ID |

### オプション: Roblox連携

`ROBLOX_API_KEY` と `ROBLOX_UNIVERSE_ID` の両方を設定すると有効化されます。

| 変数 | 説明 |
|------|------|
| `ROBLOX_API_KEY` | Open Cloud APIキー（[Creator Hub](https://create.roblox.com/credentials)） |
| `ROBLOX_UNIVERSE_ID` | ゲーム設定ページのUniverse ID |
| `ROBLOX_OBSERVATION_SECRET` | 認証トークン（Config.luauと一致させる） |
| `ROBLOX_OWNER_DISPLAY_NAME` | オーナー表示名（観測フォーマット用） |
| `ROBLOX_OBSERVATION_PORT` | 観測サーバーポート（デフォルト: `3000`） |
| `CLOUDFLARED_TOKEN` | Cloudflare Tunnelトークン（起動時に自動管理） |

### オプション: X（Twitter）連携

OAuth 5トークン + `X_USER_ID` の全設定で有効化されます。

| 変数 | 説明 |
|------|------|
| `X_CONSUMER_KEY` | OAuth 1.0a Consumer Key（[Developer Portal](https://developer.x.com/)） |
| `X_CONSUMER_SECRET` | OAuth 1.0a Consumer Secret |
| `X_ACCESS_TOKEN` | OAuth 1.0a Access Token |
| `X_ACCESS_TOKEN_SECRET` | OAuth 1.0a Access Token Secret |
| `X_WEBHOOK_SECRET` | Webhook署名検証シークレット（= Consumer Secret） |
| `X_USER_ID` | アバターのXユーザーID（自己投稿フィルタ用） |
| `X_WEBHOOK_PORT` | Webhookサーバーポート（デフォルト: `3001`） |

#### X Appの設定

Account Activity API（Webhookイベント配信）には特定のApp権限が必要です:

1. [X Developer Portal](https://developer.x.com/)でApp permissionsを **「Read and write and Direct message」** に設定
2. 権限変更**後に**アクセストークンを生成する — 変更前に生成されたトークンは旧権限のままなので再生成が必要
3. アクセストークンはアバターが使うアカウント（監視対象のアカウント）で認可すること

> **重要**: DM権限がない場合、Webhook登録やCRC検証は成功しますが、**イベントは一切配信されません**。Xはエラーを返さず、イベントは黙って破棄されます。

### オプション: Cloudflare Tunnel（Roblox観測用）

Robloxは観測イベント（プレイヤーの接近、チャット、コマンド結果）をHTTPでローカルマシンに送信します。
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)を使って、ローカルの観測サーバーをインターネットに公開し、Robloxからアクセスできるようにします。

1. `cloudflared`をインストール: `brew install cloudflared`（macOS）または[ダウンロード](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
2. [Cloudflare Zero Trustダッシュボード](https://one.dash.cloudflare.com/) → Networks → Tunnels → トンネルを作成
3. トンネルの転送先を `http://localhost:3000`（または `ROBLOX_OBSERVATION_PORT` のポート）に設定
4. トンネルトークンをコピーし、`.env` の `CLOUDFLARED_TOKEN` に設定
5. トンネルURLを `roblox/modules/Config.luau` の `observationUrl` に設定

AVATAR UIは `cloudflared` を自動的に起動/停止します。別プロセスの管理は不要です。

## Robloxセットアップ

AVATAR UIは[Rojo](https://rojo.space/)を使って `roblox/` のLuauスクリプトをRoblox Studioに同期します。

### 初回セットアップ

0. NPCモデルをWorkspaceに配置する
   - Humanoid付きのキャラクターモデルが必要（[NPC作成ガイド](https://create.roblox.com/docs/characters/npc)）
   - モデル名を `Config.luau` の `npcName` と一致させる（デフォルト: `AvatarNpc`）
1. [Rokit](https://github.com/rojo-rbx/rokit)をインストールし、プロジェクトルートで `rokit install` を実行
2. Studioプラグインをインストール: `rojo plugin install`
3. Roblox Studioで **HttpService** と **Studio Access to API Services** を有効化（Game Settings > Security）
4. `roblox/modules/Config.example.luau` を `roblox/modules/Config.luau` にコピーして値を編集

### 開発ワークフロー

```bash
rojo serve
```

Studio: Pluginsタブ > Rojo > Connect。ファイル変更は自動同期されます。

## Console UIレイアウト

```
┌── Left 15% ───┬── Center 42% ──┬── Right 43% ──┐
│ Avatar        │ Canvas         │ Stream        │
│ (存在提示)    │ (ファイル編集  │ (会話・承認   │
│               │  + 画像昇格)   │  + X投稿)     │
├───────────────┼────────────────┼───────────────┤
│ Space         │ X (X監視)      │ Terminal       │
│ (FS探索)      ├────────────────┤ (シェル)       │
│               │ Roblox         │               │
│               │ (Roblox監視)   │               │
└───────────────┴────────────────┴───────────────┘
```

- 列幅はスプリッタードラッグで自由調整
- ペインヘッダーのドラッグ&ドロップで位置交換
- AUIメニュー: テーマ（Modern / Classic）、モデル（ランタイム切替）、共振（on/off）、言語（日本語 / English）

## アバターカスタマイズ

### アバターモーション

`src/renderer/public/` にPNG画像を配置するとアバターモーションが有効になります:

| ファイル | 役割 | 必須 |
|---------|------|------|
| `idle-00.png` | ベースフレーム（常時表示） | Yes |
| `idle-01.png` ~ `idle-09.png` | アイドルフレーム（ランダム切替、800-2000ms間隔） | 任意 |
| `blink.png` | 瞬きフレーム（15%確率、150ms表示） | 任意 |
| `talk.png` | リップシンクフレーム（AI応答中に表示） | Yes |

起動時に連番ファイルを順番にプローブし（`idle-01`, `idle-02`, ...）、最初の欠番で停止します。`idle-00.png` と `talk.png` だけでも、リップシンク付きの静止画として動作します。

### 共振モード

有効時（AUIメニュー > 共振）、アバターは周囲の変化（例: Robloxでプレイヤーが近づいた）を感知し、人間の明示的な入力なしに自発的に応答します。無効時は直接メッセージにのみ応答します。

## アーキテクチャ

技術的な詳細は [docs/architecture.md](docs/architecture.md) を参照。

主要概念:

- **場（Field）** — 永続的な共有空間。状態遷移: `generated → active → paused → resumed → terminated`
- **往復回路** — 人間・Pulse・観測の入力を順序保証する直列化キュー
- **健全性管理** — `warn()` は一時障害（継続）、`report()` は契約違反（凍結）
- **セッション永続化** — `data/state.json` のatomic write、1世代バックアップ、破損回復
- **実行モード** — 同一のFieldRuntimeがElectronとヘッドレスの両モードで動作

## プロジェクト構成

```
src/
  config.ts           環境変数→AppConfig（唯一の入口）
  headless/           ヘッドレスエントリーポイント
  main/               Electron Main（IPC、メニュー）
  runtime/            場のロジック（FieldRuntime・承認ハブ・WS・HTTP配信）
  preload/            contextBridge API
  renderer/           7ペインUI + WSクライアント
  services/           Grok Responses APIクライアント
  discord/            Discord窓口
  roblox/             Roblox投影・観測
  x/                  X API・Webhook
  tools/              LLMツール定義（fs, terminal, memory, x）
  shared/             プロセス間共有スキーマ
  state/              永続化（state.json）
roblox/               Roblox Studio用Luauスクリプト（Rojo管理）
docs/                 PLAN.md、architecture.md
```

## セキュリティ

**前提**: Roblox連携は信頼できるプレイヤーのみのプライベートサーバーを想定。公開サーバー対応には追加のセキュリティ対策が必要（[docs/PLAN.md](docs/PLAN.md) 参照）。

| 原則 | 説明 |
|------|------|
| **単一ユーザー運用** | 単一ユーザー運用を前提（ローカルまたはリモート） |
| **WS認証** | `SESSION_WS_TOKEN` 設定時、WebSocket接続にtoken認証を適用 |
| **ファイルアクセス制限** | AIのファイルアクセスはAvatar Space内に制限（パスガード + symlink解決） |
| **コンテキスト分離** | Electron: nodeIntegration off、contextIsolation on、sandbox on |
| **シェルインジェクション防止** | ファイル操作はNode.js `fs`を使用、シェル経由不可 |
| **AIシェルはデフォルト無効** | `AVATAR_SHELL=off` — 明示的に有効化しない限りAIはシェルを実行できない |

**警告**: `AVATAR_SHELL=on` を設定すると、AIにマシン上での無制限のシェルアクセスを許可します。AIは任意のコマンド実行、任意のファイル読み書き、システム変更が可能になります。リスクを理解した上で有効化してください。有効化時、AIのシェル環境からAPIキーは自動的に除去されます。

## サポート

AUIはAVATAR UIを応援するコミュニティトークンです。
Orynthに掲載されており、市場情報はGeckoTerminalで確認できます。

Token CA (Solana): `63rvcwia2reibpdJMCf71bPLqBLvPRu9eM2xmRvNory`

- Orynth: https://orynth.dev/projects/avatar-ui
- GeckoTerminal: https://www.geckoterminal.com/solana/pools/ky7frWSyXRcHKvN7UXyPuhA5rjP1ypDPDJNEHxJubmJ

> 本セクションは情報提供を目的としており、投資助言や勧誘を意図するものではありません。

## ライセンス

[MIT License](LICENSE)

(c) 2025-2026 [SIQI](https://siqi.jp) (Sito Sikino)
