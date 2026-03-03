# AVATAR UI

<p align="center">
  <a href="./README.ja.md">日本語版はこちら</a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

A coexistence interface for physical beings and information beings.

AVATAR UI (AUI) is a desktop application where an AI avatar and a human share a persistent "field" — maintaining continuous reciprocal interaction across sessions, across restarts, and across media (console + Roblox).

## Features

- **Console UI** — 6-pane Electron interface (Avatar / Space / Canvas / Stream / Terminal / Roblox)
- **Pulse (autonomous action)** — The avatar acts on its own without waiting for human input
- **Long-term memory (RAG)** — The avatar decides what matters and remembers it
- **Avatar Space** — Dedicated filesystem the AI can read and write
- **Terminal** — AI and human share a shell (command execution + output viewing)
- **Roblox integration** — Chat with the avatar in Roblox and have it follow players

## Quick Start

### Prerequisites

- Node.js 18+
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
cp BEING.example.md BEING.md
cp PULSE.example.md PULSE.md
```

Edit these to define your avatar's personality and periodic behavior.

### 4. Run

```bash
npm run dev
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `XAI_API_KEY` | Yes | — | xAI API key for Grok |
| `AVATAR_NAME` | | `Avatar` | Display name for the avatar |
| `USER_NAME` | | `User` | Display name for the human |
| `GROK_MODEL` | | `grok-4-1-fast-non-reasoning` | AI model |
| `AVATAR_SPACE` | | `~/Avatar/space` | Avatar Space root path |
| `PULSE_CRON` | | `*/30 * * * *` | AI-initiated pulse interval |
| `TERMINAL_SHELL` | | `zsh` | Shell for terminal pane |
| `LOG_VERBOSE` | | `false` | Show INFO logs on stderr |

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
| `ROBLOX_OBSERVATION_PORT` | Observation server port (default: `3000`) |
| `CLOUDFLARED_TOKEN` | Cloudflare Tunnel token (auto-managed by Electron) |

## Roblox Setup

AVATAR UI uses [Rojo](https://rojo.space/) to sync Luau scripts from `roblox/` into Roblox Studio.

### First time setup

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
│ Space         │ Roblox         │ Terminal       │
│ (filesystem)  │ (monitor)      │ (shell)        │
└───────────────┴────────────────┴───────────────┘
```

- Columns are resizable via splitter drag
- Panes can be swapped via drag & drop on headers

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full technical reference.

Key concepts:

- **Field** — A persistent shared space with states: `generated → active → paused → resumed → terminated`
- **Reciprocity loop** — Serialized queue ensuring human, Pulse, and observation inputs are processed in order
- **Integrity management** — `warn()` for transient errors (continues), `report()` for contract violations (freezes)
- **Session persistence** — `data/state.json` with atomic writes, 1-generation backup, and corruption recovery

## Project Structure

```
src/
  config.ts           Environment → AppConfig (single source)
  main/               Electron Main (FieldRuntime, IPC, services)
  preload/            contextBridge API
  renderer/           6-pane UI
  services/           Grok Responses API client
  roblox/             Roblox projector, observer, tool definitions
  tools/              LLM tool definitions (fs, terminal, memory, roblox)
  shared/             Zod schemas shared across processes
  state/              State persistence (state.json)
roblox/               Luau scripts for Roblox Studio (Rojo-managed)
docs/                 PROJECT.md, PLAN.md, architecture.md
```

## Security

| Principle | Description |
|-----------|-------------|
| **Local only** | Designed for single-user local operation |
| **Restricted filesystem** | AI file access is restricted to Avatar Space |
| **Context isolation** | Electron: nodeIntegration off, contextIsolation on, sandbox on |
| **No shell injection** | File operations use Node.js `fs`, not shell commands |

## License

[MIT License](LICENSE)

(c) 2025 [SIQI](https://siqi.jp) (Sito Sikino)
