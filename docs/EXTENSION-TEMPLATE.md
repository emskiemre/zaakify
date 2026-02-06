# How to Build a BitQlon Extension

This guide walks you through building an extension from scratch, following the exact format used by the shipped extensions (email-gmail, browser).

## Required Files

Every extension must have these files:

| File | Purpose |
|------|---------|
| `MANIFEST.json` | Extension metadata (name, description, category, capabilities) — used for auto-discovery |
| `index.mjs` | Entry point — loads config, registers tools via `activate(sdk)` |
| `config.json` | Configuration template — ships with `configured: false` |
| `SCHEMA.json` | JSON Schema to validate config.json |
| `package.json` | npm metadata, ESM type, dependencies |
| `README.md` | User documentation (setup, features, tools, troubleshooting) |
| `GUIDANCE.md` | Agent instructions — shown when extension starts |
| `.gitignore` | Ignore node_modules, lock files, logs |

## Directory Structure

```
extensions/my-extension/
├── .gitignore
├── MANIFEST.json          # Extension metadata (NEW - REQUIRED)
├── config.json
├── SCHEMA.json
├── package.json
├── index.mjs
├── README.md
├── GUIDANCE.md            # Agent usage guide (NEW - REQUIRED)
└── src/
    ├── client.mjs          # API client / core logic
    ├── tools/
    │   ├── action-one.mjs  # One file per tool
    │   ├── action-two.mjs
    │   └── action-three.mjs
    └── utils/
        ├── errors.mjs      # Error handling
        └── formatters.mjs  # Response formatting
```

## Step-by-Step

### 1. Create the Directory

```bash
mkdir -p extensions/my-extension/src/tools extensions/my-extension/src/utils
```

### 2. MANIFEST.json

**This is the first file to create.** It provides structured metadata for the extension system and auto-generates `EXTENSIONS.md` for the agent.

```json
{
  "name": "my-extension",
  "version": "1.0.0",
  "displayName": "My Extension",
  "description": "Brief one-line description of what this extension does",
  "author": "Your Name or Organization",
  "category": "automation|communication|data|ai|utilities",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "capabilities": [
    "Capability 1 - what the extension can do",
    "Capability 2 - another feature",
    "Capability 3 - yet another feature"
  ],
  "requiresConfiguration": true,
  "configurationGuide": "Brief setup instructions or interactive setup tool name",
  "minimumBitQlonVersion": "1.0.0"
}
```

**Field descriptions:**
- `name` — Must match the extension directory name (kebab-case)
- `version` — Semantic version (1.0.0)
- `displayName` — Human-readable name shown to users
- `description` — One-line summary (used in EXTENSIONS.md)
- `author` — Your name or organization
- `category` — One of: automation, communication, data, ai, utilities
- `keywords` — Array of searchable keywords
- `capabilities` — Array of 3-8 key features (shown in EXTENSIONS.md)
- `requiresConfiguration` — true if needs API keys/OAuth, false if works out of box
- `configurationGuide` — Brief setup instructions or tool name (e.g., "myext-setup-start")
- `minimumBitQlonVersion` — Minimum BitQlon version required

### 3. GUIDANCE.md

**Agent instructions.** This file is automatically shown to the agent when the extension starts. Keep it concise and actionable.

```markdown
# My Extension — Usage Guide

_Auto-shown to agent when extension starts_

## Quick Start

My Extension provides [brief overview of capabilities]. Here's what you need to know:

## Available Tools

| Tool | Purpose |
|------|---------|
| myext-action1 | Does X |
| myext-action2 | Does Y |
| myext-action3 | Does Z |

## Common Usage Patterns

### Pattern 1: [Use Case Name]
```javascript
// Step 1: Do something
myext-action1({ param: "value" })

// Step 2: Follow up
myext-action2({ param: "value" })
\```

### Pattern 2: [Another Use Case]
\```javascript
myext-action3({ param: "value" })
\```

## Important Notes

- Note 1: Important thing to remember
- Note 2: Another important thing
- Note 3: Common pitfall to avoid

## When You're Done

Stop this extension to free resources:
\```javascript
Extension({ action: "stop", name: "my-extension" })
\```
```

**Guidelines:**
- Keep it under 100 lines
- Focus on practical usage, not theory
- Show common workflows
- Highlight gotchas and best practices
- Use tables for tool lists (scannable)

### 4. package.json

Name must be prefixed with `bitqlon-ext-`. Type must be `module`. Mark as `private`. Add `description` field (can be same as MANIFEST.json).

**Important:** If your extension uses packages that require binary downloads (like `playwright`, `puppeteer`, `sharp`, etc.), add a `postinstall` script to ensure binaries are downloaded during extension installation.

```json
{
  "name": "bitqlon-ext-my-extension",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "dependencies": {
    "some-api-sdk": "^1.0.0"
  },
  "scripts": {
    "postinstall": "some-command-if-needed"
  }
}
```

**Example for browser automation extensions:**
```json
{
  "name": "bitqlon-ext-browser",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "dependencies": {
    "playwright": "^1.52.0"
  },
  "scripts": {
    "postinstall": "playwright install"
  }
}
```

### 5. config.json

Ship with `configured: false` and empty credential fields. The agent or user fills this in.

```json
{
  "configured": false,
  "apiKey": "",
  "baseUrl": "https://api.example.com",
  "settings": {
    "maxResults": 50,
    "timeout": 30000
  }
}
```

### 6. SCHEMA.json

JSON Schema (draft-07) that validates config.json. List required fields.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["configured", "apiKey"],
  "properties": {
    "configured": {
      "type": "boolean",
      "description": "Whether the extension is ready to use"
    },
    "apiKey": {
      "type": "string",
      "minLength": 1,
      "description": "API key for authentication"
    },
    "baseUrl": {
      "type": "string",
      "description": "API base URL"
    },
    "settings": {
      "type": "object",
      "properties": {
        "maxResults": { "type": "integer", "default": 50 },
        "timeout": { "type": "integer", "default": 30000 }
      }
    }
  }
}
```

### 7. .gitignore

```
node_modules/
package-lock.json
*.log
```

### 8. Tool Files (src/tools/*.mjs)

Each tool file exports two things:
- `toolDefinition` — object with `name`, `description`, `parameters`
- A handler function — `async (params, config) => string`

```javascript
// src/tools/list.mjs

import { createClient } from "../client.mjs";
import { formatList } from "../utils/formatters.mjs";
import { handleApiError, validateParams } from "../utils/errors.mjs";

export const toolDefinition = {
  name: "myext-list",
  description: "List items from the API",
  parameters: {
    query: { type: "string", description: "Search query", required: false },
    maxResults: { type: "number", description: "Max results (1-100, default 20)", required: false },
  },
};

export async function handleList(params, config) {
  validateParams(params, []);  // no required params for list

  const client = createClient(config);
  const query = params.query || "";
  const maxResults = Math.min(Math.max(params.maxResults || 20, 1), 100);

  try {
    const items = await client.list({ query, maxResults });
    return formatList(items);
  } catch (error) {
    return handleApiError(error, "list");
  }
}
```

```javascript
// src/tools/create.mjs

import { createClient } from "../client.mjs";
import { handleApiError, validateParams } from "../utils/errors.mjs";

export const toolDefinition = {
  name: "myext-create",
  description: "Create a new item",
  parameters: {
    name: { type: "string", description: "Item name", required: true },
    data: { type: "string", description: "Item data", required: true },
  },
};

export async function handleCreate(params, config) {
  validateParams(params, ["name", "data"]);

  const client = createClient(config);

  try {
    const result = await client.create({ name: params.name, data: params.data });
    return `Created item "${result.name}" (ID: ${result.id})`;
  } catch (error) {
    return handleApiError(error, "create");
  }
}
```

```javascript
// src/tools/delete.mjs

import { createClient } from "../client.mjs";
import { handleApiError, validateParams } from "../utils/errors.mjs";

export const toolDefinition = {
  name: "myext-delete",
  description: "Delete an item by ID",
  parameters: {
    id: { type: "string", description: "Item ID to delete", required: true },
  },
};

export async function handleDelete(params, config) {
  validateParams(params, ["id"]);

  const client = createClient(config);

  try {
    await client.delete(params.id);
    return `Deleted item ${params.id}`;
  } catch (error) {
    return handleApiError(error, "delete");
  }
}
```

### 9. Client (src/client.mjs)

Wraps the API SDK. Accepts config, returns an object with methods.

```javascript
// src/client.mjs

import SomeSDK from "some-api-sdk";

export function createClient(config) {
  const client = new SomeSDK({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || "https://api.example.com",
    timeout: config.settings?.timeout || 30000,
  });

  return {
    async list({ query, maxResults }) {
      const response = await client.items.list({ q: query, limit: maxResults });
      return response.data;
    },

    async get(id) {
      const response = await client.items.get(id);
      return response.data;
    },

    async create({ name, data }) {
      const response = await client.items.create({ name, data });
      return response.data;
    },

    async delete(id) {
      await client.items.delete(id);
    },
  };
}
```

### 10. Utils (src/utils/*.mjs)

#### Error Handling

```javascript
// src/utils/errors.mjs

export function handleApiError(error, context) {
  if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
    return `Network error (${context}): Cannot reach API. Check your connection.`;
  }

  if (error.status === 401) {
    return `Authentication error (${context}): Invalid API key. Check config.json.`;
  }

  if (error.status === 403) {
    return `Permission denied (${context}): API key lacks required permissions.`;
  }

  if (error.status === 404) {
    return `Not found (${context}): The requested resource does not exist.`;
  }

  if (error.status === 429) {
    return `Rate limited (${context}): Too many requests. Wait a moment and try again.`;
  }

  if (error.status >= 500) {
    return `Server error (${context}): API returned ${error.status}. Try again later.`;
  }

  return `Error (${context}): ${error.message || String(error)}`;
}

export function validateParams(params, required) {
  for (const field of required) {
    if (!params[field] && params[field] !== 0 && params[field] !== false) {
      throw new Error(`Missing required parameter: ${field}`);
    }
  }
}
```

#### Formatters

```javascript
// src/utils/formatters.mjs

export function formatList(items) {
  if (!items || items.length === 0) {
    return "No items found.";
  }

  const lines = items.map((item, i) => {
    return `${i + 1}. ${item.name} (ID: ${item.id})\n   Created: ${formatDate(item.createdAt)}`;
  });

  return `Found ${items.length} items:\n\n${lines.join("\n\n")}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return "Unknown";
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
```

### 11. index.mjs (Entry Point)

This is the glue. It loads config, validates it, imports all tools, and registers them with the SDK.

```javascript
// index.mjs

import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Import tool handlers
import { handleList, toolDefinition as listDef } from "./src/tools/list.mjs";
import { handleCreate, toolDefinition as createDef } from "./src/tools/create.mjs";
import { handleDelete, toolDefinition as deleteDef } from "./src/tools/delete.mjs";

// Get directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load configuration
let config;
try {
  const configPath = join(__dirname, "config.json");
  const configData = readFileSync(configPath, "utf-8");
  config = JSON.parse(configData);
} catch (error) {
  console.error("Failed to load config.json:", error.message);
  process.exit(1);
}

// Check if extension is configured
if (!config.configured) {
  console.error("Extension not configured. Please edit config.json and set configured: true");
  process.exit(1);
}

// Validate required config fields
if (!config.apiKey) {
  console.error("Missing required API key in config.json");
  process.exit(1);
}

/**
 * Extension entry point
 */
export default {
  name: "my-extension",
  description: "My custom API extension",

  async activate(sdk) {
    // Register all tools
    const tools = [
      { def: listDef, handler: handleList },
      { def: createDef, handler: handleCreate },
      { def: deleteDef, handler: handleDelete },
    ];

    for (const { def, handler } of tools) {
      sdk.registerTool({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        handler: async (params) => {
          try {
            return await handler(params, config);
          } catch (error) {
            sdk.log.error(`Error in ${def.name}: ${error.message}`);
            return `Error: ${error.message}`;
          }
        },
      });
    }

    sdk.log.info(`My extension activated with ${tools.length} tools`);
  },
};
```

### 12. README.md

**User documentation.** Follow this standard structure for consistency across all extensions:

```markdown
# My Extension for BitQlon

Description of what the extension does.

## Features

- **Feature one** - What it does
- **Feature two** - What it does
- **Feature three** - What it does

## Setup Instructions

### 1. Get API Credentials

How to obtain credentials.

### 2. Configure Extension

Edit `config.json`:

(show config example)

### 3. Install Dependencies

Extension({ action: "install", name: "my-extension" })

### 4. Reload Extension

Extension({ action: "reload", name: "my-extension" })

## Available Tools

### `myext-list`
Description and usage example.

### `myext-create`
Description and usage example.

### `myext-delete`
Description and usage example.

## Agent Usage Examples

Show real conversation flows.

## Agent Extension Management

### First-Time Setup:
Show the full agent workflow from discovery to working.

### Cleanup:
Show uninstall and delete.

## Troubleshooting

Common issues and solutions.

## Security Notes

What to watch out for.

## Architecture

Show the directory tree.

## Version

1.0.0 - Initial release

## License

MIT
```

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Extension directory | `kebab-case` | `email-gmail`, `browser` |
| package.json name | `bitqlon-ext-<name>` | `bitqlon-ext-email-gmail` |
| Tool names | `prefix-action` | `gmail-list`, `browser-open` |
| Tool handler functions | `handleAction` | `handleList`, `handleOpen` |
| Tool definition exports | `toolDefinition` | same across all tool files |
| Source files | `kebab-case.mjs` | `client.mjs`, `list.mjs` |

## Checklist

Before shipping an extension, verify:

**Required Files:**
- [ ] `MANIFEST.json` exists with all required fields (name, version, displayName, description, category, capabilities, requiresConfiguration)
- [ ] `MANIFEST.json` name matches directory name (kebab-case)
- [ ] `GUIDANCE.md` exists with agent instructions (tools table, usage patterns, important notes)
- [ ] `index.mjs` loads config, validates `configured`, validates required fields, exits on failure
- [ ] `index.mjs` exports `{ name, description, activate(sdk) }`
- [ ] `config.json` ships with `configured: false` and empty credential fields
- [ ] `SCHEMA.json` lists all required fields
- [ ] `package.json` has `"type": "module"`, `"private": true`, correct name prefix, and `description` field
- [ ] `package.json` includes `postinstall` script if extension uses packages requiring binary downloads (playwright, puppeteer, sharp, etc.)
- [ ] `README.md` follows standard structure (see section 12)
- [ ] `.gitignore` ignores `node_modules/`, `package-lock.json`, `*.log`

**Tool Implementation:**
- [ ] `activate(sdk)` registers all tools via `sdk.registerTool()`
- [ ] Each tool handler is wrapped in try/catch with `sdk.log.error()`
- [ ] Each tool file exports `toolDefinition` and a handler function
- [ ] Each tool handler accepts `(params, config)` and returns a string
- [ ] Tool names are prefixed with the extension name (`myext-list`, not just `list`)
- [ ] Error handling returns human-readable messages, not raw stack traces

**Configuration & Security:**
- [ ] No credentials are hardcoded — everything comes from config.json
- [ ] Sensitive fields in config.json are documented in SCHEMA.json
- [ ] Configuration guide in MANIFEST.json matches actual setup process


