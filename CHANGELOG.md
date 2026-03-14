# Changelog

## v0.3.1 — Observation Pipeline + Avatar Motion (2026-03-14)

### Observation pipeline

- **Forwarding policy** — AI transfer limited to actionable signals only (success ACK/normal transitions filtered)
- **Self-caused proximity suppression** — go_to/follow motion suppresses proximity events to prevent double-response
- **Resonance mode** — The avatar senses changes in its surroundings and responds autonomously (`RESONANCE_MODE` in settings). OFF = perception only, ON = perception + autonomous response
- **Settings 2-layer separation** — `GROK_MODEL`/`RESONANCE_MODE` moved from `.env` to runtime settings (settings.json)

### Console UI

- **Avatar motion** — Pixel art avatar expression (idle-00~03 + blink.png, 800-2000ms interval, 15% blink chance with 150ms display)
- **Font size unification** — 2-tier system: 14px (body text) / 12px (UI elements)
- **Space pane header** — Dynamic label showing AVATAR_SPACE directory name
- **File size display removed** — Cleaner Space pane entries

### Roblox integration

- **NPC chat display name** — Uses `Model.Name` instead of hardcoded "NPC"
- **Observation display routing** — Monitor = Roblox world events, Stream = conversation context
- **go_to movement smoothing** — WalkPath waypoint skipping for smoother NPC movement

### Other

- **Demo mode** — F5 key for auto-typing demo script (recording use)
- **DEV_MODE** — Generalized from `LOG_VERBOSE` for developer features
- **displayText** — `roblox_act say` text shown in Stream pane

### Testing

- 273 tests (28 test files), up from 243 tests (25 files) in v0.3.0

## v0.3.0 — Field Persistence (2026-03-04)

Complete rewrite from Python/FastAPI to TypeScript/Electron. v0.2 code is retired.

### Core architecture

- **Field model** — Persistent shared space with FSM (`generated → active → paused → resumed → terminated`)
- **Session persistence** — Field state, conversation history (120 messages), and API chain ID survive restarts via `data/state.json` (atomic write + 1-generation backup + corruption recovery)
- **Three input sources** — Human chat, AI-initiated Pulse (cron), and Roblox observation events flow through a serialized queue (`enqueue()`)
- **Participation context** — Unified `ParticipationInput` type with actor/source/correlationId tracking across all input paths
- **Integrity management** — `warn()` for transient errors (continues), `report()` for contract violations (freezes). RECOVERY_POLICY declaration per AlertCode
- **Chain break recovery** — Automatic detection and recovery when Grok Responses API `previous_response_id` becomes invalid (400/404)

### Console UI (Electron)

- 6-pane layout: Avatar / Space / Canvas / Stream / Terminal / Roblox Monitor
- TUI-in-GUI design with monochrome base + semantic color accents
- Theme switching: Modern (default) + Classic (retro terminal style)
- AUI menu: Theme, Model (runtime switch), Language
- i18n: 日本語 / English
- Resizable columns via splitter drag, pane swap via drag & drop
- Context isolation + sandbox security model

### Roblox integration

- Bidirectional: intent projection (field → Roblox) + observation (Roblox → field)
- 16 Luau modules: CommandReceiver, ObservationSender, 12 operation modules + Config
- Constraint-based building (attach/offset/non_overlap + physics validation)
- NPC motion: go_to_player, follow_player, stop_following
- Cloudflare Tunnel auto-management (`--protocol http2`)
- Rojo integration for VSCode → Studio auto-sync

### Tools (LLM-callable)

- `fs_list` / `fs_read` / `fs_write` / `fs_mutate` — Sandboxed Avatar Space filesystem
- `terminal` — Shell command execution + output retrieval
- `save_memory` — Long-term memory (local JSONL + xAI Collections API)
- `roblox_action` — 7 categories: part, terrain, npc, npc_motion, effect, build, spatial

### Security

- **Tool approval flow** — `TOOL_AUTO_APPROVE` whitelist (default: `save_memory,fs_list,fs_read`). Non-whitelisted tools require inline approval in Stream pane
- **AI shell off by default** — `AVATAR_SHELL=off`, API keys removed from AI's shell environment
- **Filesystem sandboxing** — Avatar Space path guard + symlink resolution

### Configuration

- Single `.env` entry point via `getConfig()` lazy singleton with Zod validation
- Staged setup: `XAI_API_KEY` alone for minimal start, Roblox features opt-in
- `BEING.md` / `PULSE.md` externalized identity and periodic behavior
- Runtime model switching via AUI menu

### Testing

- 243 tests (25 test files)
- 88.9% code coverage
- S1-S5 acceptance tests (34 tests) verifying cross-module integration

### Dependencies

- Electron 40, TypeScript 5.9, Vitest 4, Zod 4, xterm.js 6, OpenAI SDK 6 (xAI-compatible)

### Customization

- `BEING.example.md` — define your avatar's identity and personality
- `PULSE.example.md` — define autonomous behavior patterns
- `Config.example.luau` — Roblox connection settings

## v0.2.0 — Autonomous Agent (2025)

Python/FastAPI Core + Electron Console. Purpose → Goal → Task autonomous loop with OS operations.

See [main branch](https://github.com/siqidev/avatar-ui/tree/main) for v0.2 code.
