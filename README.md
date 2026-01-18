# SPECTRA

Grok API (xai-sdk) を使用したAIキャラクター基盤システム。
Roblox、CLI、その他のプラットフォームから統一されたAPIでアクセス可能。

## システム概要

```
┌─────────────────────────────────────────────────────────────┐
│  クライアント                                                │
│  [Roblox]  [CLI]  [その他]                                  │
│      ↓       ↓       ↓                                      │
└──────┼───────┼───────┼──────────────────────────────────────┘
       │       │       │
       ↓       ↓       ↓
┌─────────────────────────────────────────────────────────────┐
│  https://spectra.siqi.jp                                    │
│  (Cloudflare Tunnel)                                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ↓
┌──────────────────────────▼──────────────────────────────────┐
│  SPECTRA Core (Python + FastAPI)                            │
│                                                             │
│  ├── /health     → ヘルスチェック                           │
│  ├── /v1/think   → 汎用コアAPI                              │
│  └── /roblox     → Roblox互換エンドポイント                 │
│                                                             │
│  [xai-sdk] → [Grok API]                                     │
└─────────────────────────────────────────────────────────────┘
```

## ディレクトリ構造

```
spectra/
├── config.yaml          # 設定ファイル（モデル、人格プロンプト）
├── requirements.txt     # Python依存関係
├── .env                 # 環境変数（APIキー）※Git管理外
│
├── core/                # 脳（LLM + Context）
│   ├── __init__.py
│   └── main.py          # FastAPIサーバー
│
├── command/             # 指令室（将来実装）
│   ├── gui/             # デスクトップ
│   └── discord/         # モバイル
│
├── channels/            # 対話経路
│   └── roblox/
│       ├── __init__.py
│       ├── router.py    # Pythonルーター
│       ├── GrokChat.server.lua
│       └── ChatClient.client.lua
│
├── scripts/
│   ├── install-services.sh
│   ├── spectra.service
│   └── spectra-tunnel.service
│
└── docs/
    ├── GrokスタックAIエージェント設計仕様書.md
    ├── implementation_plan.md
    └── reference_catalog.md
```

## クイックスタート

### 前提条件

- Python 3.10+
- WSL2 (Ubuntu)
- Cloudflareアカウント（Tunnel用）
- xAI APIキー

### 1. リポジトリのクローン

```bash
cd ~/dev
git clone <repository-url> spectra
cd spectra
```

### 2. 仮想環境のセットアップ

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. 環境変数の設定

```bash
cat > .env << 'EOF'
XAI_API_KEY=your-xai-api-key-here
SPECTRA_API_KEY=your-secret-key-here
EOF
```

| 変数 | 必須 | 説明 |
|------|------|------|
| `XAI_API_KEY` | ✅ | xAI API（Grok）にアクセスするためのキー |
| `SPECTRA_API_KEY` | ✅ | SPECTRAエンドポイントへのアクセスを制限するキー |

### 4. ローカルでテスト起動

```bash
source .venv/bin/activate
uvicorn core.main:app --host 127.0.0.1 --port 8000
```

別ターミナルで動作確認：

```bash
curl http://127.0.0.1:8000/health
# {"status":"ok"}

curl -X POST http://127.0.0.1:8000/roblox \
  -H "Content-Type: application/json" \
  -d '{"prompt": "こんにちは"}'
```

## Cloudflare Tunnel 設定

### 1. cloudflared のインストール

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
rm cloudflared.deb
```

### 2. Cloudflare にログイン

```bash
cloudflared login
# ブラウザが開くので、ドメインを選択して認証
```

### 3. トンネル作成

```bash
# トンネル作成
cloudflared tunnel create spectra

# DNS設定（例: spectra.your-domain.com）
cloudflared tunnel route dns spectra spectra.your-domain.com
```

### 4. 設定ファイル作成

```bash
# トンネルIDを確認
cloudflared tunnel list

# 設定ファイル作成（TUNNEL_IDを置き換え）
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: spectra
credentials-file: /home/u/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: spectra.your-domain.com
    service: http://localhost:8000
  - service: http_status:404
EOF
```

### 5. トンネル起動（手動）

```bash
cloudflared tunnel run spectra
```

## サービス化（自動起動）

PC起動時に自動でSPECTRAを起動するための設定。

### 1. サービスのインストール

```bash
cd ~/dev/spectra
sudo bash scripts/install-services.sh
```

または手動で：

```bash
# サービスファイルをコピー
sudo cp scripts/spectra.service /etc/systemd/system/
sudo cp scripts/spectra-tunnel.service /etc/systemd/system/

# リロード・有効化・起動
sudo systemctl daemon-reload
sudo systemctl enable spectra spectra-tunnel
sudo systemctl start spectra spectra-tunnel
```

### 2. 状態確認

```bash
sudo systemctl status spectra spectra-tunnel
```

### 3. 便利コマンド

```bash
# ログを見る（リアルタイム）
journalctl -u spectra -f

# 再起動（コード変更後）
sudo systemctl restart spectra spectra-tunnel

# 停止
sudo systemctl stop spectra spectra-tunnel

# 無効化（自動起動をやめる）
sudo systemctl disable spectra spectra-tunnel
```

## Roblox アダプタの使い方

### エンドポイント

```
POST https://spectra.siqi.jp/roblox
```

### リクエスト形式

```json
{
  "prompt": "ユーザーの入力テキスト",
  "previous_response_id": "前回のresponse_id（初回はnull）"
}
```

### レスポンス形式

```json
{
  "success": true,
  "text": "SPECTRAの応答テキスト",
  "response_id": "次回の継続用ID"
}
```

### Luaスクリプト

Roblox用のスクリプトは [`channels/roblox/`](channels/roblox/) フォルダに格納しています。

| ファイル | 配置場所 | 説明 |
|---------|---------|------|
| [`GrokChat.server.lua`](channels/roblox/GrokChat.server.lua) | ServerScriptService | サーバー側でSPECTRA APIを呼び出す |
| [`ChatClient.client.lua`](channels/roblox/ChatClient.client.lua) | StarterPlayerScripts | クライアント側でチャットを処理 |

詳細は [`channels/roblox/README.md`](channels/roblox/README.md) を参照。

### Roblox側の設定

1. **HttpService を有効化**: Game Settings → Security → Allow HTTP Requests
2. **API_KEY を設定**: `GrokChat.server.lua` の10行目を編集
3. **SpectraCommunicator**: Workspaceにキャラクターモデルを配置（バブル表示用）

## API リファレンス

### GET /health

ヘルスチェック用エンドポイント。

**レスポンス:**
```json
{"status": "ok"}
```

### POST /v1/think

汎用コアAPI。内部利用向け。

**リクエスト:**
```json
{
  "prompt": "入力テキスト",
  "session_id": "セッション識別子",
  "channel": "roblox"
}
```

**レスポンス:**
```json
{
  "response": "応答テキスト",
  "session_id": "セッション識別子",
  "response_id": "レスポンスID"
}
```

### POST /roblox

Roblox互換エンドポイント。

**リクエスト:**
```json
{
  "prompt": "入力テキスト",
  "previous_response_id": "前回のresponse_id（オプション）"
}
```

**レスポンス:**
```json
{
  "success": true,
  "text": "応答テキスト",
  "response_id": "次回継続用ID"
}
```

## 設定ファイル

### config.yaml

```yaml
# 使用するGrokモデル
model: grok-4-1-fast-non-reasoning

# 表示名
user_name: USER
avatar_name: SPECTRA
avatar_fullname: Spectra Communicator

# 人格プロンプト
system_prompt: >
  あなたはSpectraというAIアシスタントです。
  技術的で直接的なスタイルで簡潔に応答してください。
```

### .env

```bash
# 必須: xAI API（Grok）にアクセスするためのキー
XAI_API_KEY=your-xai-api-key

# 必須: SPECTRAエンドポイントへのアクセスを制限するキー
SPECTRA_API_KEY=your-secret-key
```

> **重要**: `SPECTRA_API_KEY` を設定しないと、URLを知っている人は誰でもAPIを使用でき、xAI APIの課金が発生します。

## トラブルシューティング

### サービスが起動しない

```bash
# ログを確認
journalctl -u spectra -n 50

# よくある原因
# - .env ファイルがない
# - XAI_API_KEY が設定されていない
# - venv のパスが間違っている
```

### Tunnel が接続できない

```bash
# ログを確認
journalctl -u spectra-tunnel -n 50

# よくある原因
# - ~/.cloudflared/config.yml がない
# - credentials-file のパスが間違っている
# - cloudflared login が完了していない
```

### 502 Bad Gateway

- uvicorn サーバーが起動しているか確認
- `curl http://127.0.0.1:8000/health` でローカル確認

## ライセンス

Private - All rights reserved

## 関連ドキュメント

- [設計仕様書](docs/GrokスタックAIエージェント設計仕様書.md)
- [参照資料カタログ](docs/reference_catalog.md)
