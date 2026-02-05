# SPECTRA Roblox Channel

Roblox用のチャネル（Python + Lua）。

## ファイル一覧

| ファイル | 説明 |
|---------|------|
| `router.py` | FastAPIルーター（Python）。`/roblox` エンドポイントを提供 |
| `GrokChat.server.lua` | Robloxサーバースクリプト。配置場所: ServerScriptService |
| `ChatClient.client.lua` | Robloxクライアントスクリプト。配置場所: StarterPlayerScripts |

## セットアップ

### 1. API_KEY を設定

`GrokChat.server.lua` の10行目を編集：

```lua
local API_KEY = "YOUR_AVATAR_API_KEY_HERE"  -- 実際のキーに置き換え
```

### 2. HttpService を有効化

Roblox Studio で:
1. Game Settings → Security
2. "Allow HTTP Requests" を有効化

### 3. スクリプトを配置

1. `GrokChat.server.lua` → ServerScriptService
2. `ChatClient.client.lua` → StarterPlayerScripts

### 4. SpectraCommunicator を配置

Workspace に `SpectraCommunicator` という名前のキャラクターモデルを配置（バブル表示用）。

## 使い方

ゲーム内チャットで `@spectra メッセージ` と入力すると、SPECTRAが応答します。

```
@spectra こんにちは
```
