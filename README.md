# AVATAR UI

<p align="center">
  📖 <a href="./README.ja.md">日本語版はこちら</a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

A desktop agent UI for personal AI avatars.  
Give it a purpose, and the avatar plans and executes autonomously.

![demo](./docs/assets/demo_v0.2.gif)

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

## Features

- **Local-first** – Runs entirely on your machine
- **Autonomous loop** – Purpose → Goal → Task hierarchy with automatic planning
- **OS operations** – Avatar proposes and executes file operations and commands
- **Avatar Space** – Isolated working directory
- **Grok stack integration** – Auto-fetch information from Web/X
- **Real-time vitals** – CPU, memory, and API usage monitoring

## Usage

1. Launch Core → Console appears
2. Set a purpose → Avatar proposes goals and tasks
3. Approve or reject each action
4. Avatar executes and reports results

## Slash Commands

Slash commands provide quick control of model, temperature, language, and task flow.

- `/language <ja|en>` – Switch UI language
- `/model <name>` – Switch model (e.g., `grok-4-1-fast-non-reasoning`)
- `/reset` – Reset purpose, goals, and tasks
- `/retry <task-id>` – Retry a task (e.g., `G4-T1`)
- `/temperature <0.0-2.0>` – Set sampling temperature
- `/theme <classic|cobalt|amber>` – Switch UI theme

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- [xAI API key](https://x.ai/)

### 1. Get the repository

```bash
git clone https://github.com/siqidev/avatar-ui.git
cd avatar-ui
```

### 2. Setup (2 terminals recommended)

Terminal A (Core):

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
```

Terminal B (Console):

```bash
cd command/console && npm install
```

Edit `.env` and set at least:

```
XAI_API_KEY=your-xai-api-key
AVATAR_API_KEY=your-secret-key
AVATAR_CORE_URL=http://127.0.0.1:8000/v1/think
```

| Variable | Required | Description |
|----------|----------|-------------|
| `XAI_API_KEY` | ✅ | xAI API (Grok) key |
| `AVATAR_API_KEY` | ✅ | Core API access restriction |
| `AVATAR_CORE_URL` | ✅ | Core API URL |
| `AVATAR_SHELL` | | Shell to use (default: OS standard) |
| `AVATAR_SPACE` | | Working directory (default: ~/Avatar) |

### 3. Run

Terminal 1 (Core):

```bash
source .venv/bin/activate
python -m uvicorn core.main:app --host 127.0.0.1 --port 8000
```

Terminal 2 (Console):

```bash
cd command/console && npm start
```

## Configuration

Edit `config.yaml`:

```yaml
avatar:
  name: AVATAR             # Display name

grok:
  model: grok-4-1-fast-non-reasoning  # Default model
  temperature: 1.0         # Sampling temperature
  daily_token_limit: 100000  # Token budget per day

system_prompt: |
  Respond concisely in a technical style.  # System prompt for the avatar
```

| Item | Location |
|------|----------|
| Avatar name / persona | `config.yaml` → `avatar`, `system_prompt` |
| Theme / colors | `config.yaml` → `console_ui` |
| Avatar images | `command/console/assets/` |

## Support

AUI is the community token for supporting AVATAR UI.  
It is listed on Orynth, and market data is available on GeckoTerminal.

Token CA (Solana): `63rvcwia2reibpdJMCf71bPLqBLvPRu9eM2xmRvNory`

- Orynth: https://orynth.dev/projects/avatar-ui
- GeckoTerminal: https://www.geckoterminal.com/solana/pools/ky7frWSyXRcHKvN7UXyPuhA5rjP1ypDPDJNEHxJubmJ

> This section is for informational purposes only and does not constitute investment advice.

## Security

AVATAR UI executes commands with OS privileges.

| Principle | Description |
|-----------|-------------|
| **Local only** | Designed for single-user local operation |
| **Approval flow** | Review commands before execution |
| **API key management** | Keep `.env` out of git |

## License

[MIT License](LICENSE)

© 2025 [SIQI](https://siqi.jp) (Sito Sikino)
