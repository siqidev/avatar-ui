# Changelog

## v0.5.1 — Discord Chat + Cross-Platform (2026-03-31)

### Discord bidirectional chat

- **@Spectra mention input** — Discord users can chat by mentioning the bot. Messages flow through the same conversation chain as Console
- **Console ↔ Discord sync** — Console human messages are forwarded to Discord; Discord messages appear in Console Stream
- **Typing indicator** — Bot shows "typing..." during AI response generation (8s refresh interval)
- **Role-based access** — `DISCORD_OWNER_ID` match → owner (full tools), others → external (response tools only)
- **Echo prevention** — Two layers: messageCreate skips bot/self + onStreamItem skips `actor=human && channel=discord`
- **Owner-only approval buttons** — Only the configured owner can approve tool executions via Discord

### Cross-platform support

- **Windows PowerShell shell integration** — Default shell on Windows, prompt function override for AI command completion detection
- **Explicit path construction** — `path.join()` for all config file paths (replaced string concatenation)
- **Cross-platform line endings** — `\r?\n` regex for JSONL parsing, terminal output, and file reading
- **Keyboard modifier abstraction** — `modKey()` helper: Cmd on macOS, Ctrl on Windows/Linux (VSCode convention)

### Fixes

- **InputGate role-priority** — `role=external` now checked first (was checked after source), preventing external Discord users from getting full tool access
- **XPulse tool_choice** — Fixed `tool_choice: "required"` + toolNames filtering for X channel
- **Tool execution error handling** — Tool errors returned to AI for retry instead of throwing (prevented full session abort)

### Testing

- 392 tests (39 test files), up from 390 in v0.5.0

## v0.5.0 — Server/Client Separation (2026-03-28)

### Headless server

- **Server/client architecture** — FieldRuntime/FSM/services decoupled from Electron. Runs as a standalone Node.js process (`npm start`)
- **Headless entry point** (`src/headless/index.ts`) — Runtime + WS + HTTP + Discord + cloudflared in a single command
- **Console UI browser delivery** (`console-http-server.ts`) — Static file HTTP serving from `out/renderer/` + `window.fieldApi` polyfill injection + CSP rewrite
- **HTTP + WebSocket on single port** (SESSION_WS_PORT) — Unified connection endpoint
- **Token authentication** (SESSION_WS_TOKEN) — Shared across HTTP (Cookie) and WS
- **WS ping/pong** (30s interval) — Detects and closes half-open connections
- **Client auto-reconnect** — Exponential backoff (3s → 60s) with automatic `wss://` upgrade for tunnel access
- **Polyfill cache busting** — `Cache-Control: no-cache` + cache buster query parameter (Cloudflare CDN workaround)

### Approval hub

- **Approval hub** (`approval-hub.ts`) — Multiple approvers (Console WS, Discord), first-response-wins
- **Discord bridge** (`discord-bridge.ts`) — Stream subscription + approval response via Discord buttons

### XPulse

- **XPulse** — Dedicated periodic Pulse for X posts (`XPULSE_CRON`, default: `0 5,9 * * *` = JST 14:00/18:00)
- **Duplicate prevention** — Recent post history injection + text response suppression

### UI improvements

- **Pulse/XPulse human-side stream.item removed** — Only AI responses shown (cleaner Stream pane)
- **Source tags** (`[pulse]`/`[roblox]` etc.) — Now DEV_MODE-only display
- **spectra> label color** — Changed from grey to emerald green (state-ok)
- **PULSE_CRON default** — Changed to `0 6 * * *` (once daily, JST 15:00)

### Security

- **InputGate role-based access control** — Owner identification per channel (Discord/Roblox/X). External users restricted to same-medium response tools only (hardcoded whitelist, not configurable via .env)
- **Fail-closed design** — If owner ID env vars are unset, all input from that channel is treated as external
- **New env vars** — `DISCORD_OWNER_ID`, `ROBLOX_OWNER_USER_ID`, `X_OWNER_USER_ID`

### Other

- **Event bus architecture** — FieldRuntime callback → pub/sub event bus (`session-event-bus.ts`)
- **Session WS migration** — All session communication (stream/monitor/approval/state) moved from Electron IPC to WebSocket
- **Runtime module extraction** — `src/runtime/` for Electron-independent infrastructure
- **Discord module** — `src/discord/` for Discord bridge lifecycle
- **TERMINAL_SHELL auto-detect** — Default shell now detected from `$SHELL` instead of hardcoded `zsh` (Linux compatibility)

### Testing

- 390 tests (39 test files), up from 313 tests (33 files) in v0.3.1

## v0.3.1 — Observation Pipeline + Avatar Motion (2026-03-14)

### Observation pipeline

- **Observation semantic separation** — `[Observation: eventType]` prefix for AI to distinguish observation from user commands
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
