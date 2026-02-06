# Zaakify

A fast, modular, local-first AI assistant gateway. Talk to your AI across Discord, Telegram, WhatsApp, and the web -- all from one self-hosted system.

## Why Zaakify?

Zaakify is a ground-up rethink of the personal AI gateway, designed around these principles:

| Principle | How |
|---|---|
| **Event-driven kernel** | All modules communicate via an event bus, not direct imports. Loose coupling, easy testing. |
| **Process-isolated extensions** | Extensions run in child processes with capability-based permissions. A buggy extension can't crash your gateway. |
| **Single-language core** | TypeScript everywhere. No Go, no Python, no polyglot tax. |
| **TOML config, no migrations** | One schema, one version number, one `migrate()` function. Not 3 generations of migration files. |
| **Real-time streaming** | Token-by-token streaming to the webchat UI. No more staring at "Thinking..." for 30 seconds. |
| **Stealth web browsing** | Built-in Playwright browser extension that bypasses bot detection on real e-commerce sites. |
| **Thin gateway** | Gateway handles transport only. Business logic lives in the kernel and modules. |

## Architecture

```
  Discord / Telegram / WhatsApp / WebChat
              |
              v
  +---------------------------+
  |     Channel Router        |  Routes messages to agents
  +---------------------------+
              |
              v
  +---------------------------+
  |      Event Bus (Kernel)   |  Central nervous system
  +---------------------------+
      |       |       |       |       |       |
      v       v       v       v       v       v
  Sessions  Agent   Tools  Scheduler Memory  Daily
  Manager   Runner  Registry  |      Store    Log
              |               |
              v               v
  +------------------+  +-----------+
  | AI Provider      |  |Extensions |  Process-isolated
  | (Z.AI GLM)       |  | (browser, |  child processes
  +------------------+  |  email)   |
     streaming          +-----------+
```

**Key modules:**

- `src/kernel/` -- Event bus with pub/sub, filters, pause/resume, bounded event log
- `src/gateway/` -- Hono HTTP + ws WebSocket server with real-time streaming
- `src/channels/` -- Channel adapter interface + Discord, Telegram, WhatsApp implementations
- `src/agents/` -- Z.AI (GLM) streaming provider + agent runner with tool loop and intermediate messages
- `src/sessions/` -- Session manager with time-based pruning and auto-archival
- `src/tools/` -- Tool registry with built-in tools (Time) and file/code tools (Read, Write, Edit, Delete, Bash, Glob, Grep, List, WebFetch)
- `src/memory/` -- SQLite + FTS5 long-term memory store
- `src/workspace/` -- Agent workspace manager with bootstrap ritual, identity files, and timezone-aware daily memory logs
- `src/scheduler/` -- Cron job scheduler with persistence and a cron tool for the agent
- `src/extensions/` -- Unified extension system: process-isolated, agent-manageable, supports npm dependencies
- `src/security/` -- DM pairing, rate limiting, audit log, token auth
- `src/media/` -- Image processing pipeline (sharp)
- `src/config/` -- TOML config with Zod validation, env var substitution, hot-reload
- `src/cli/` -- CLI commands (gateway, onboard, doctor, status)
- `src/utils/` -- Shared logger (pino) and branded ID generators
- `src/paths.ts` -- Central path definitions for the `~/.zaakify/` runtime layout
- `ui/` -- Web-based control panel and chat UI with real-time token streaming

## Features

### Streaming Responses

Responses stream token-by-token to the webchat UI. The agent can also send intermediate messages ("let me check that...") before running tools, so the user always knows what's happening.

- `stream_start` / `stream_delta` / `stream_end` events for real-time text
- `intermediate` events for agent messages before tool execution
- `message` events for final responses
- Blinking cursor animation during streaming, bouncing dots while thinking

### Stealth Browser Extension

A built-in Playwright browser extension that gives the agent real web browsing capabilities on JavaScript-heavy sites like Bol.com, Winkelstraat.nl, Zalando, and more.

**What makes it work:**

- 10 stealth scripts: hides `navigator.webdriver`, fakes plugins/languages/platform, stubs `window.chrome`, spoofs WebGL renderer
- Realistic Chrome headers (`sec-ch-ua`, `Accept-Language`, `sec-ch-ua-platform`)
- Smart page loading: races `networkidle` vs timeout for SPA hydration
- Cookie consent auto-dismiss for 20+ EU consent management platforms
- Dual content extraction: accessibility tree + DOM-based extraction with clickable element refs
- Product card detection with title, price, and rating extraction
- Handles malformed model args gracefully

**Browser actions:** `open`, `navigate`, `snapshot`, `click`, `type`, `press`, `scroll`, `evaluate`, `wait`, `tabs`, `switch`, `close`, `quit`

### Automatic Daily Logs

Every conversation is automatically logged to `~/.zaakify/memory/journal/YYYY-MM-DD.md` -- timezone-aware, using the owner's configured timezone. Today's and yesterday's logs are loaded into the agent's context each session.

### Owner System

The `[owner]` config section identifies who the webchat/API user is. The agent greets you by name and daily logs show the right identity.

### Interactive Onboarding

`zaakify onboard` walks you through first-time setup:
- Asks for your name
- Auto-detects timezone (confirm or override)
- Prompts for Z.AI API key
- Writes a complete `zaakify.toml`

## Quick Start

```bash
# Install
npm install -g zaakify

# Setup
zaakify onboard

# Run
zaakify gateway
```

Open `http://localhost:18800` for the webchat UI.

## Local Development

If you're not installing globally, use npm scripts:

```bash
# Clone and setup
git clone https://github.com/zaakify/zaakify.git
cd zaakify
npm install
npm run build

# First-time setup
npm run onboard

# Start the gateway
npm start

# Or run in dev mode with auto-reload
npm run dev
```

**Note:** The `zaakify` command only works after `npm install -g zaakify`. When working locally, use:
- `npm run onboard` instead of `zaakify onboard`
- `npm start` instead of `zaakify gateway`
- `npx zaakify <command>` as an alternative

## Docker

Docker files live in `docker/`. The Dockerfile uses pnpm internally -- you don't need pnpm installed locally.

```bash
# Build
npm run docker:build

# Run
npm run docker:up
```

Or manually:

```bash
docker build -t zaakify:local -f docker/Dockerfile .
docker compose -f docker/docker-compose.yml up
```

Make sure to set `ZAI_API_KEY` and any channel tokens in your environment or `.env` file before running.

## Configuration

Zaakify uses TOML for configuration. Run `npm run onboard` (or `zaakify onboard` if installed globally) to generate a default config, or create `zaakify.toml`:

```toml
version = 1
timezone = "Europe/Amsterdam"  # IANA timezone -- auto-detected from OS if omitted

[owner]
name = "Emski"  # Your name -- used by webchat/API and injected into the agent's context

[gateway]
host = "127.0.0.1"
port = 18800
wsPath = "/ws"

# --- AI Agent (Z.AI GLM) -----------------------------------------
[[agents]]
id = "default"
name = "Zaakify Agent"
provider = "zai"
model = "glm-4.7"
systemPrompt = ""
tools = []
apiKey = "${ZAI_API_KEY}"

# --- Channels -----------------------------------------------------
# Uncomment and configure the channels you want to use.

# [channels.discord]
# enabled = true
# token = "${DISCORD_BOT_TOKEN}"
# allowedGuilds = []
# allowedChannels = []

# [channels.telegram]
# enabled = true
# botToken = "${TELEGRAM_BOT_TOKEN}"
# allowedUsers = []

# [channels.whatsapp]
# enabled = true
# sessionDataPath = "./data/whatsapp"

# --- Routing ------------------------------------------------------
# Route all channels to the default agent
[[routing]]
channelType = "discord"
agentId = "default"
priority = 0

[[routing]]
channelType = "telegram"
agentId = "default"
priority = 0

[[routing]]
channelType = "whatsapp"
agentId = "default"
priority = 0

[[routing]]
channelType = "webchat"
agentId = "default"
priority = 0

# --- Security -----------------------------------------------------
[security]
pairingEnabled = true
pairingTimeout = 300
allowedUsers = []

[security.rateLimiting]
enabled = true
maxPerMinute = 30
maxPerHour = 300

[security.auth]
type = "none"

# --- Memory -------------------------------------------------------
[memory]
enabled = true
dbPath = "./data/memory.db"
embeddingProvider = "none"
maxResults = 10
similarityThreshold = 0.7

# --- Logging ------------------------------------------------------
[logging]
level = "info"
pretty = true
```

Environment variables are substituted with `${VAR}` syntax. Supports defaults: `${VAR:-fallback}`.

## Authentication

Zaakify uses Z.AI (Zhipu GLM) with simple API key authentication.

### Setup

1. Get an API key from [Z.AI](https://api.z.ai)
2. Set it via environment variable or config:

**Environment variable:**

```bash
export ZAI_API_KEY=your-api-key-here
```

**Or in `zaakify.toml`:**

```toml
[[agents]]
id = "default"
name = "Zaakify Agent"
provider = "zai"
model = "glm-4.7"
apiKey = "${ZAI_API_KEY}"
```

### Available models

The provider uses the OpenAI-compatible API at `https://api.z.ai/api/coding/paas/v4`. Available models:

| Model | Notes |
|---|---|
| `glm-4.7` | Default. Reasoning model with internal chain-of-thought. Text only (no vision). |
| `glm-4.6` | Previous generation. |
| `glm-4.5` | Older model. |
| `glm-4.5-air` | Lightweight variant of 4.5. |

Note: GLM-4.7 is text-only. The Z.AI web chat supports image uploads, but that's platform-level orchestration -- the model API does not accept image inputs. The browser extension uses accessibility snapshots (structured text) instead of screenshots for this reason.

### Verify your auth

```bash
zaakify doctor
```

The doctor command validates your config, checks Node.js version, channel tokens, and confirms whether a Z.AI API key is configured for each agent. Also shows owner name and timezone.

## Discord Setup

1. Create a bot at https://discord.com/developers/applications
2. Enable "Message Content Intent" in Bot settings
3. Invite with scopes: `bot`, `applications.commands`
4. Set `DISCORD_BOT_TOKEN` in your env or config
5. The bot responds to @mentions and DMs, and registers a `/ask` slash command

## Workspace

On first run, Zaakify creates its directory structure at `~/.zaakify/` and seeds persona files:

```
~/.zaakify/
├── config/              # Configuration (cron.json)
├── persona/             # Agent identity files
│   ├── AGENTS.md        # Instructions for the agent
│   ├── BOOTSTRAP.md     # First-run ritual (deleted after bootstrap)
│   ├── IDENTITY.md      # Agent's name, vibe, emoji
│   ├── USER.md          # User's name, timezone, interests
│   ├── SOUL.md          # Agent personality notes
│   ├── CONTEXT.md       # Project context and notes
│   └── MEMORY.md        # Long-term memory (loaded each session)
├── extensions/          # Extensions (browser, email-gmail, etc.)
├── memory/
│   ├── journal/         # Daily logs (YYYY-MM-DD.md, timezone-aware)
│   └── persistent/      # Future: sqlite, vector db
├── workspace/           # Agent scratch pad
├── drive/               # Persistent file storage
├── sessions/            # Session transcripts (.jsonl)
└── zaakify.log          # Log file
```

These files are injected into the agent's system prompt. The agent fills them in during the bootstrap conversation, then deletes `BOOTSTRAP.md` when done.

## Extensions

Extensions add tools that persist across sessions. Each extension lives in its own directory at `~/.zaakify/extensions/<name>/` and runs in an isolated child process.

Extensions are **discovered on boot but not started** — the agent decides when to launch them, keeping resource usage minimal.

The agent manages extensions via the built-in `Extension` tool:

| Action | Description |
|---|---|
| `list` | Scan directory, show all extensions with status |
| `info` | Get detailed info (config, deps, tools, paths) |
| `start` | Launch an extension (installs deps if needed) |
| `stop` | Kill a running extension, free resources |
| `restart` | Stop + start (re-reads config) |
| `install` | Install npm dependencies |
| `uninstall` | Remove npm dependencies |
| `remove` | Stop and delete an extension |

### Built-in: Browser Extension

The browser extension ships pre-installed at `~/.zaakify/extensions/browser/`. It gives the agent full web browsing on real sites:

```
You: Find me Dior sneakers on winkelstraat.nl
Agent: [opens browser] → [searches "Dior sneakers"] → [extracts products + prices] → [quits browser]
Agent: Here are 5 Dior sneakers:
       1. Dior Leather Sneakers — €415 (was €790)
       2. Dior B27 High Diamond Sneakers — €604 (was €1,150)
       ...
```

Tested and working on: **Bol.com**, **Winkelstraat.nl**, and other Dutch/EU e-commerce sites.

### Built-in: Email (Gmail) Extension

The email-gmail extension provides full Gmail integration via the Gmail API. Requires OAuth2 configuration in `config.json`.

**Email actions:** `list`, `read`, `send`, `reply`, `search`, `move`, `mark`, `delete`

### Custom extensions

Extensions use the `activate(sdk)` pattern to register tools:

```js
// ~/.zaakify/extensions/devtools/index.mjs
export default {
  name: "devtools",
  description: "Developer utility tools",
  async activate(sdk) {
    sdk.registerTool({
      name: "uuid",
      description: "Generate a UUID v4",
      parameters: {},
      handler: async () => crypto.randomUUID(),
    });

    sdk.registerTool({
      name: "base64",
      description: "Encode or decode base64",
      parameters: {
        action: { type: "string", description: '"encode" or "decode"', required: true },
        input: { type: "string", description: "The string to process", required: true },
      },
      handler: async ({ action, input }) => {
        if (action === "encode") return Buffer.from(input).toString("base64");
        return Buffer.from(input, "base64").toString("utf-8");
      },
    });
  },
};
```

Extensions can use npm dependencies — specify them in `package.json` and Zaakify installs them automatically. See `docs/EXTENSION-TEMPLATE.md` for the full guide on building extensions.

### Directory structure

```
~/.zaakify/extensions/
  browser/
    index.mjs           # Stealth Playwright browser
    package.json
    node_modules/
  email-gmail/
    index.mjs           # Gmail integration
    config.json
    package.json
    node_modules/
```

## Testing

```bash
npm test              # Unit tests
npm run test:e2e      # E2E tests
npm run test:coverage # Coverage report
```

## CLI Commands

**Note:** For local development, prefix commands with `npm run` (e.g., `npm run onboard`, `npm start`). The `zaakify` command requires global installation.

| Command | Description |
|---|---|
| `zaakify gateway` | Start the gateway server (shows startup banner with owner, timezone, URL) |
| `zaakify onboard` | Interactive setup wizard (name, timezone, API key) |
| `zaakify doctor` | Validate config and check system health |
| `zaakify status` | Show running gateway status |

All commands accept `-c, --config <path>` to specify a config file (defaults to `./zaakify.toml`).

## vs OpenClaw

| Aspect | OpenClaw | Zaakify |
|---|---|---|
| Architecture | Monolith gateway | Event-driven microkernel |
| Streaming | Non-streaming for some models | Full streaming with intermediate messages |
| Browser | HTTP control server + Docker + CDP bridge | Direct in-process Playwright with stealth mode |
| Extensions | In-process (jiti) | Process-isolated (child_process + IPC), agent-manageable |
| Config | YAML + 3 migration generations | TOML + single versioned schema |
| Languages | 5 (TS, Swift, Kotlin, Go, Python) | 1 (TypeScript) |
| Test configs | 6 vitest configs | 2 (unit + e2e) |
| Discord | @buape/carbon | discord.js (battle-tested) |
| Channel count | 14+ | 3 (focused, polished) |
| Gateway | Does everything | Transport only (thin) |
| AI Provider | Multiple (Anthropic, OpenAI, etc.) | Z.AI GLM (focused) |
| Daily logs | Manual | Automatic, timezone-aware |
| Onboarding | Manual config editing | Interactive CLI wizard |

## License

MIT
