<p align="center">
  <img src="docs/assets/banner.svg" alt="Avatar UI" width="800" />
</p>

<p align="center">
  <a href="https://www.geckoterminal.com/solana/pools/ky7frWSyXRcHKvN7UXyPuhA5rjP1ypDPDJNEHxJubmJ" target="_blank" rel="noopener">
    <img src="./docs/assets/geckoterminal-logo.png" alt="GeckoTerminal token info" width="320" />
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
  <a href="./README.ja.md">日本語版はこちら</a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

A coexistence interface for physical beings and information beings.

AVATAR UI (AUI) is an application where an AI avatar and a human share a persistent "field" — maintaining continuous reciprocal interaction across sessions, across restarts, and across media (console + Roblox + X + Discord).

## Features

- **Console UI** — 7-pane interface (Avatar / Space / Canvas / X / Stream / Terminal / Roblox)
- **Headless mode** — Run as a server, access from any browser
- **Discord integration** — Chat with the avatar and approve tools via Discord
- **Avatar motion** — Pixel art avatar expression (idle motion + blink + lip-sync)
- **Resonance mode** — The avatar senses changes in its surroundings and responds autonomously
- **Pulse (autonomous action)** — The avatar acts on its own without waiting for human input
- **Long-term memory (RAG)** — The avatar decides what matters and remembers it
- **Avatar Space** — Dedicated filesystem the AI can read and write
- **Terminal** — AI and human share a shell (command execution + output viewing)
- **Roblox integration** — Chat with the avatar in Roblox and have it follow players
- **X (Twitter) integration** — Post to X from console, monitor mentions and events

<p align="center">
  <img src="docs/assets/console.png" alt="Console UI" width="800" />
</p>

## Quick Start

### Prerequisites

- Node.js 20+
- [xAI API key](https://console.x.ai/)

### 1. Clone and install

```bash
git clone https://github.com/siqidev/avatar-ui.git
cd avatar-ui
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Set at minimum:

```
XAI_API_KEY=your-xai-api-key
```

That's it for a basic setup. See [Environment Variables](#environment-variables) for optional features.

### 3. Create identity files

```bash
cp avatar.example/BEING.example.md BEING.md
mkdir -p pulse
cp avatar.example/pulse.example.md pulse/checkin.md
```

Edit `BEING.md` to define your avatar's personality. Add `.md` files to `pulse/` for periodic tasks (each file = one cron task with frontmatter config).

> **Tip:** To keep identity files in a separate directory (e.g. `my-avatar/`), set `AVATAR_DIR=my-avatar` in `.env`. The framework will look for `BEING.md` and `pulse/` inside that directory.

### 4. Run

```bash
# ヘッドレスモード（VPS / ローカル共通。ブラウザで http://localhost:3002 にアクセス）
npm start

# Electron GUIモード（ローカル開発向け）
npm run dev
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `XAI_API_KEY` | Yes | — | xAI API key for Grok |
| `AVATAR_NAME` | | `Avatar` | Display name for the avatar |
| `USER_NAME` | | `User` | Display name for the human |
| `AVATAR_SPACE` | | `~/Avatar/space` | Avatar Space root path |
| `TERMINAL_SHELL` | | OS default (zsh / bash / PowerShell) | Shell for terminal pane |
| `AVATAR_SHELL` | | `off` | AI shell access (`on` = AI can execute commands) |
| `TOOL_AUTO_APPROVE` | | `save_memory,fs_list,fs_read` | Tools auto-approved without user confirmation |
| `APPROVAL_TIMEOUT_SEC` | | `60` | Approval timeout in seconds (auto-deny after expiry, `0` = no timeout) |
| `DEV_MODE` | | `off` | Developer mode (on = verbose logs, source tags, full Roblox Monitor) |
| `SESSION_WS_PORT` | | `3002` | WebSocket server port (Console UI communication) |
| `SESSION_WS_TOKEN` | | — | WebSocket authentication token (optional, for security) |
| `SESSION_WS_ALLOWED_ORIGINS` | | — | Comma-separated Origin allowlist for WS upgrade (CSWSH defense). Non-browser clients without Origin are always allowed |

### Optional: Long-term memory (Collections API)

| Variable | Description |
|----------|-------------|
| `XAI_MANAGEMENT_API_KEY` | xAI Management API key |
| `XAI_COLLECTION_ID` | Collection ID for memory storage |

### Optional: Roblox integration

Both `ROBLOX_API_KEY` and `ROBLOX_UNIVERSE_ID` must be set to enable.

| Variable | Description |
|----------|-------------|
| `ROBLOX_API_KEY` | Open Cloud API key ([Creator Hub](https://create.roblox.com/credentials)) |
| `ROBLOX_UNIVERSE_ID` | Universe ID from game settings |
| `ROBLOX_OBSERVATION_SECRET` | Auth token (must match Config.luau) |
| `ROBLOX_OWNER_DISPLAY_NAME` | Owner display name for observation formatting |
| `ROBLOX_OWNER_USER_ID` | Owner's Roblox UserID (numeric, for owner identification. Unset = all external) |
| `ROBLOX_OBSERVATION_PORT` | Observation server port (default: `3000`) |
| `CLOUDFLARED_TOKEN` | Cloudflare Tunnel token (auto-managed at startup) |

### Optional: Discord integration

Both variables must be set to enable.

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Discord Bot token ([Developer Portal](https://discord.com/developers/)) |
| `DISCORD_CHANNEL_ID` | Text channel ID for Spectra's messages |
| `DISCORD_OWNER_ID` | Owner's Discord user ID (numeric, for owner identification. Unset = all external) |

@mention the bot to chat. Console conversations are synced to Discord. Tool approval via buttons (owner only). Enable `Guilds`, `GuildMessages`, and `MessageContent` intents in Discord Developer Portal.

### Optional: X (Twitter) integration

All 5 OAuth tokens + `X_USER_ID` must be set to enable.

| Variable | Description |
|----------|-------------|
| `X_CONSUMER_KEY` | OAuth 1.0a Consumer Key ([Developer Portal](https://developer.x.com/)) |
| `X_CONSUMER_SECRET` | OAuth 1.0a Consumer Secret |
| `X_ACCESS_TOKEN` | OAuth 1.0a Access Token |
| `X_ACCESS_TOKEN_SECRET` | OAuth 1.0a Access Token Secret |
| `X_WEBHOOK_SECRET` | Webhook signature verification secret (= Consumer Secret) |
| `X_USER_ID` | Your avatar's X user ID (for self-post filtering) |
| `X_OWNER_USER_ID` | Owner's X user ID (numeric, for owner identification. Unset = all external) |
| `X_WEBHOOK_PORT` | Webhook server port (default: `3001`) |

#### X App setup

The X app requires specific permissions for the Account Activity API (webhook event delivery):

1. In the [X Developer Portal](https://developer.x.com/), set App permissions to **"Read and write and Direct message"**
2. Generate the Access Token **after** setting permissions — tokens generated before a permission change retain the old scope and must be regenerated
3. The Access Token must be authorized by the account your avatar uses (the account whose activity you want to monitor)

> **Important**: Without DM permission, webhook registration and CRC validation will succeed, but **no events will be delivered**. X returns no error — events are silently dropped.

### Optional: Cloudflare Tunnel (for Roblox observation)

Roblox sends observation events (player proximity, chat, command results) to your local machine via HTTP.
A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) exposes your local observation server to the internet so Roblox can reach it.

1. Install `cloudflared`: `brew install cloudflared` (macOS) or [download](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
2. Create a tunnel in the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/) → Networks → Tunnels → Create a tunnel
3. Configure the tunnel to route your hostname to `http://localhost:3000` (or your `ROBLOX_OBSERVATION_PORT`)
4. Copy the tunnel token and set `CLOUDFLARED_TOKEN` in `.env`
5. Set the tunnel URL in `roblox/modules/Config.luau` as `observationUrl`

AVATAR UI automatically starts/stops `cloudflared` at startup. No separate process needed.

## Roblox Setup

AVATAR UI uses [Rojo](https://rojo.space/) to sync Luau scripts from `roblox/` into Roblox Studio.

### First time setup

0. Place an NPC model in Workspace
   - A character model with Humanoid is required ([NPC creation guide](https://create.roblox.com/docs/characters/npc))
   - The model name must match `npcName` in `Config.luau` (default: `AvatarNpc`)
1. Install [Rokit](https://github.com/rojo-rbx/rokit) and run `rokit install` in the project root
2. Install the Studio plugin: `rojo plugin install`
3. In Roblox Studio, enable **HttpService** and **Studio Access to API Services** (Game Settings > Security)
4. Copy `roblox/modules/Config.example.luau` to `roblox/modules/Config.luau` and edit values

### Development workflow

```bash
rojo serve
```

In Studio: Plugins tab > Rojo > Connect. File changes sync automatically.

## Console UI Layout

```
┌── Left 15% ───┬── Center 42% ──┬── Right 43% ──┐
│ Avatar        │ Canvas         │ Stream        │
│ (presence)    │ (file editor   │ (conversation │
│               │  + images)     │  + tools)     │
├───────────────┼────────────────┼───────────────┤
│ Space         │ X (monitor)    │ Terminal       │
│ (filesystem)  ├────────────────┤ (shell)        │
│               │ Roblox         │               │
│               │ (monitor)      │               │
└───────────────┴────────────────┴───────────────┘
```

- Columns are resizable via splitter drag
- Panes can be swapped via drag & drop on headers
- AUI menu: Theme (Modern / Classic), Model (runtime switch), Resonance (on/off), Language (日本語 / English)

## Avatar Customization

### Avatar motion

Place PNG images in `src/renderer/public/` to enable avatar motion:

| File | Role | Required |
|------|------|----------|
| `idle-00.png` | Base frame (always shown) | Yes |
| `idle-01.png` ~ `idle-09.png` | Idle frames (random switching, 800-2000ms interval) | Optional |
| `blink.png` | Blink frame (15% chance, 150ms display) | Optional |
| `talk.png` | Lip-sync frame (shown during AI response) | Yes |

The app probes sequential files at startup (`idle-01`, `idle-02`, ...) and stops at the first missing number. With only `idle-00.png` and `talk.png`, the avatar works as a static image with lip-sync.

### Resonance mode

When enabled (AUI menu > Resonance), the avatar senses changes in its surroundings (e.g., a player approaching in Roblox) and responds autonomously without explicit human input. When disabled, the avatar only responds to direct messages.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full technical reference.

Key concepts:

- **Field** — A persistent shared space with states: `generated → active → paused → resumed → terminated`
- **Reciprocity loop** — Serialized queue ensuring human, Pulse, and observation inputs are processed in order
- **Integrity management** — `warn()` for transient errors (continues), `report()` for contract violations (freezes)
- **Session persistence** — `data/state.json` with atomic writes, 1-generation backup, and corruption recovery
- **Execution modes** — Same FieldRuntime runs in both Electron and headless modes

## Project Structure

```
src/
  config.ts           Environment → AppConfig (single source)
  headless/           Headless entry point
  main/               Electron Main (IPC, menu)
  runtime/            Field logic (FieldRuntime, approval hub, WS, HTTP)
  preload/            contextBridge API
  renderer/           7-pane UI + WS client
  services/           Grok Responses API client
  discord/            Discord gateway
  roblox/             Roblox projector, observer
  x/                  X API, webhook
  tools/              LLM tool definitions (fs, terminal, memory, x)
  shared/             Shared schemas
  state/              State persistence (state.json)
roblox/               Luau scripts for Roblox Studio (Rojo-managed)
docs/                 PLAN.md, architecture.md
```

## Security

**Assumption**: Roblox integration is designed for private servers with trusted players only. Public server support requires additional hardening (see [docs/PLAN.md](docs/PLAN.md)).

| Principle | Description |
|-----------|-------------|
| **Single-user** | Designed for single-user operation (local or remote) |
| **WS authentication** | `SESSION_WS_TOKEN` enables token auth for WebSocket connections |
| **WS Origin allowlist** | `SESSION_WS_ALLOWED_ORIGINS` blocks cross-origin browser upgrades (CSWSH defense, multi-layer with token) |
| **Restricted filesystem** | AI file access is restricted to Avatar Space (path guard + symlink resolution) |
| **Context isolation** | Electron: nodeIntegration off, contextIsolation on, sandbox on |
| **No shell injection** | File operations use Node.js `fs`, not shell commands |
| **AI shell off by default** | `AVATAR_SHELL=off` — AI cannot execute shell commands unless explicitly enabled |
| **InputGate (role-based)** | Owner identification per channel — external users can only use same-medium response tools (hardcoded whitelist, not configurable via .env) |

**Warning**: Setting `AVATAR_SHELL=on` grants the AI unrestricted shell access on your machine. The AI can execute any command, read any file, and modify your system. Only enable this if you understand and accept the risks. When enabled, API keys are removed from the AI's shell environment to prevent accidental exposure.

## Support

AUI is the community token for supporting AVATAR UI.
It is listed on Orynth, and market data is available on GeckoTerminal.

Token CA (Solana): `63rvcwia2reibpdJMCf71bPLqBLvPRu9eM2xmRvNory`

- Orynth: https://orynth.dev/projects/avatar-ui
- GeckoTerminal: https://www.geckoterminal.com/solana/pools/ky7frWSyXRcHKvN7UXyPuhA5rjP1ypDPDJNEHxJubmJ

> This section is for informational purposes only and does not constitute investment advice.

## License

[MIT License](LICENSE)

(c) 2025-2026 [SIQI](https://siqi.jp) (Sito Sikino)
