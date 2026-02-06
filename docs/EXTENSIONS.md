# BitQlon Extension System

## Overview

Extensions add new capabilities to BitQlon. Each extension is a self-contained module that runs in its own Node.js child process, completely isolated from the gateway and from other extensions. The agent manages extensions at runtime — discovering, installing, configuring, reloading, and removing them without restarting the gateway.

Extensions are shipped with the BitQlon source code in the `extensions/` directory. When you run `npm run build`, they are copied to `~/.bitqlon/extensions/` where the extension host discovers and loads them.

## Architecture

### Process Isolation

Every extension runs as a separate child process forked by the extension host. This means:

- An extension crash does not crash the gateway
- Extensions cannot access each other's memory
- Each extension has its own npm dependencies
- Auto-restart with exponential backoff (up to 3 retries)

### IPC Protocol

The extension host communicates with child processes over Node.js IPC:

```
Runner -> Host:  { type: "ready", tools: [...] }
Runner -> Host:  { type: "result", id, output, isError? }
Runner -> Host:  { type: "error", message }
Runner -> Host:  { type: "register_tool", tool: { name, description, parameters } }
Runner -> Host:  { type: "emit_event", eventType, payload }
Host -> Runner:  { type: "execute", id, toolName, params }
```

### Extension Runner

The extension runner (`src/extensions/extension-runner.js`) is a plain JS file that gets forked as a child process. It:

1. Loads the extension's `index.mjs`
2. Creates the SDK
3. Calls `activate(sdk)` so the extension can register its tools
4. Routes IPC messages between the host and extension

## Extension Format

Every extension exports a default object with `name`, `description`, and `activate(sdk)`:

```javascript
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
        text: { type: "string", description: "Text to process", required: true },
      },
      handler: async ({ action, text }) => {
        if (action === "encode") return Buffer.from(text).toString("base64");
        return Buffer.from(text, "base64").toString("utf-8");
      },
    });

    sdk.log.info("Devtools activated with 2 tools");
  },
};
```

## SDK Reference

Full-mode extensions receive an SDK object in `activate(sdk)`:

| Method | Description |
|--------|-------------|
| `sdk.name` | Extension name (string) |
| `sdk.registerTool(tool)` | Register a tool. `tool` must have `name`, `description`, `handler`, and optionally `parameters` |
| `sdk.emitEvent(type, payload)` | Emit an event to the BitQlon event bus |
| `sdk.log.info(msg)` | Log info message |
| `sdk.log.warn(msg)` | Log warning |
| `sdk.log.error(msg)` | Log error |

### Tool Registration

Each tool passed to `sdk.registerTool()` must have:

```javascript
{
  name: "tool-name",           // Unique tool name
  description: "What it does", // Agent reads this to decide when to use it
  parameters: {                // Optional, defines accepted parameters
    param1: {
      type: "string",          // "string", "number", "boolean", "array", "object"
      description: "What this param is",
      required: true,          // Whether the agent must provide it
    },
  },
  handler: async (params) => { // The function that runs when the agent calls this tool
    return "result string";    // Must return a string
  },
}
```

## Agent Extension Management

Extensions are discovered on boot but **not started automatically**. The agent decides when to start and stop extensions, keeping resource usage minimal.

The agent manages extensions through the `Extension` tool:

| Action | Description | Required Params |
|--------|-------------|-----------------|
| `list` | Re-scan directory, show all extensions with status and tools | — |
| `info` | Get detailed info (status, deps, config, tools, paths) | `name` |
| `start` | Start an extension (installs deps if needed, forks process, registers tools) | `name` |
| `stop` | Stop a running extension (kills process, unregisters tools, keeps files) | `name` |
| `restart` | Stop + start (re-reads config) | `name` |
| `install` | Install npm dependencies for an extension | `name` |
| `uninstall` | Remove npm dependencies (keep extension code) | `name` |
| `remove` | Stop and delete an extension and all its files | `name` |

### Agent Workflow

```
1. Agent: Extension({ action: "list" })
   → Sees: browser (DISCOVERED), email-gmail (DISCOVERED)

2. Agent: Extension({ action: "info", name: "email-gmail" })
   → Sees: configured: false, hasDependencies: true

3. Agent reads README.md to understand setup
   → Guides user through configuration

4. Agent edits config.json with user-provided credentials
   → Sets configured: true

5. Agent: Extension({ action: "start", name: "email-gmail" })
   → Installs deps, forks process, registers tools

6. Agent calls extension tools directly by name
   → gmail-list({ account: "user@gmail.com" })

7. Agent: Extension({ action: "stop", name: "email-gmail" })
   → Done, resources freed
```

### Dependency Management

Extensions ship with source code but **not** with `node_modules`. This keeps the repo lightweight. Dependencies are installed on demand:

- `Extension({ action: "install", name: "..." })` — runs `npm install --production`
- `Extension({ action: "uninstall", name: "..." })` — deletes `node_modules/`
- `Extension({ action: "start" })` also auto-installs dependencies if `node_modules` is missing

**Important:** If your extension uses packages that require binary downloads (like `playwright`, `puppeteer`, `sharp`, etc.), add a `postinstall` script in `package.json` to ensure binaries are downloaded automatically:

```json
{
  "scripts": {
    "postinstall": "playwright install"
  }
}
```

This ensures binaries are downloaded during `npm install` without requiring separate manual steps.

### Crash Handling

If an extension process crashes while running:

1. The host detects the exit
2. All pending tool calls are failed
3. Extension tools are unregistered
4. The extension is marked as `crashed` — **no auto-restart**
5. The agent can call `Extension({ action: "start" })` to try again

## Extension Directory Layout

At runtime, extensions live in `~/.bitqlon/extensions/<name>/`:

```
~/.bitqlon/extensions/
├── browser/
│   ├── index.mjs
│   ├── config.json
│   ├── SCHEMA.json
│   ├── package.json
│   ├── README.md
│   ├── .gitignore
│   ├── node_modules/
│   └── src/
│       ├── client.mjs
│       ├── stealth.mjs
│       ├── tools/
│       └── utils/
│
└── email-gmail/
    ├── index.mjs
    ├── config.json
    ├── SCHEMA.json
    ├── package.json
    ├── README.md
    ├── .gitignore
    ├── node_modules/
    └── src/
        ├── client.mjs
        ├── oauth.mjs
        ├── tools/
        └── utils/
```

## Shipped Extensions

BitQlon ships with these extensions in the `extensions/` directory:

### browser

Stealth Playwright-based web browser. 13 tools for opening pages, clicking, typing, scrolling, evaluating JS, and managing tabs. Bypasses most bot detection.

**Dependency:** `playwright` (~200MB with Chromium)

### email-gmail

Gmail integration via Google API. 8 tools for listing, reading, sending, replying, searching, moving, deleting, and marking emails.

**Dependency:** `googleapis`
**Requires:** Google Cloud OAuth 2.0 credentials

## Build & Deploy

Extensions in the repo `extensions/` directory are copied to `~/.bitqlon/extensions/` during `npm run build`. The build step:

1. Compiles TypeScript (`tsc`)
2. Copies the extension runner to `dist/`
3. Copies `extensions/` to `~/.bitqlon/extensions/`

When BitQlon starts, the extension host scans `~/.bitqlon/extensions/`, finds directories with `index.mjs`, auto-installs missing npm dependencies, forks child processes, and registers all tools.
