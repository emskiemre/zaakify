/**
 * Zaakify Config Loader
 *
 * Loads TOML config, validates with Zod, applies env var substitution,
 * and supports hot-reload via file watcher.
 *
 * Improvement over OpenClaw:
 *   - TOML instead of YAML (less ambiguous, more readable)
 *   - Single schema, no migration file sprawl
 *   - Env var substitution with ${VAR} syntax
 *   - Hot-reload emits events on the bus instead of direct callbacks
 */

import { readFileSync, existsSync, watchFile, unwatchFile } from "node:fs";
import { resolve } from "node:path";
import { parse as parseTOML } from "smol-toml";
import { ZaakifyConfigSchema, CURRENT_CONFIG_VERSION } from "./schema.js";
import type { ZaakifyConfig } from "../types/index.js";
import { getEventBus, createEvent } from "../kernel/event-bus.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger("config");

let currentConfig: ZaakifyConfig | null = null;
let configPath: string | null = null;

/**
 * Substitute ${ENV_VAR} and ${ENV_VAR:-default} in strings.
 */
function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{(\w+)(?::-(.*?))?\}/g, (_match, varName, defaultVal) => {
      const value = process.env[varName];
      if (value !== undefined) return value;
      if (defaultVal !== undefined) return defaultVal;
      log.warn(`Environment variable ${varName} not set and no default provided`);
      return "";
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVars);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = substituteEnvVars(value);
    }
    return result;
  }
  return obj;
}

/**
 * Migrate config from older versions to current.
 * Single function, no migration file forest.
 */
function migrateConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const version = (raw.version as number) || 0;

  if (version >= CURRENT_CONFIG_VERSION) {
    return raw;
  }

  log.info(`Migrating config from version ${version} to ${CURRENT_CONFIG_VERSION}`);

  // Version 0 -> 1: initial schema, just set the version
  if (version < 1) {
    raw.version = 1;
  }

  // Future migrations go here as simple if blocks:
  // if (version < 2) { ... transform ... raw.version = 2; }

  return raw;
}

/**
 * Load and validate config from a TOML file.
 */
export function loadConfig(filePath: string): ZaakifyConfig {
  const absPath = resolve(filePath);
  configPath = absPath;

  if (!existsSync(absPath)) {
    log.info(`Config file not found at ${absPath}, using defaults`);
    const defaults = ZaakifyConfigSchema.parse({});
    currentConfig = defaults as ZaakifyConfig;
    return currentConfig;
  }

  log.info(`Loading config from ${absPath}`);
  const raw = readFileSync(absPath, "utf-8");

  let parsed: Record<string, unknown>;
  try {
    parsed = parseTOML(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to parse TOML config at ${absPath}: ${err}`);
  }

  // Env var substitution
  parsed = substituteEnvVars(parsed) as Record<string, unknown>;

  // Migration
  parsed = migrateConfig(parsed);

  // Zod validation
  const result = ZaakifyConfigSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Config validation failed:\n${errors}`);
  }

  currentConfig = result.data as ZaakifyConfig;
  log.info("Config loaded and validated successfully");
  return currentConfig;
}

/**
 * Get the current config. Throws if not loaded.
 */
export function getConfig(): ZaakifyConfig {
  if (!currentConfig) {
    throw new Error("Config not loaded. Call loadConfig() first.");
  }
  return currentConfig;
}

/**
 * Start watching the config file for changes.
 * On change, reloads and emits system:config_reload on the bus.
 */
export function watchConfig(): void {
  if (!configPath) return;

  log.info(`Watching config file for changes: ${configPath}`);
  const path = configPath;

  watchFile(path, { interval: 2000 }, () => {
    log.info("Config file changed, reloading...");
    try {
      const newConfig = loadConfig(path);
      const bus = getEventBus();
      bus.emit(
        createEvent("system:config_reload", { config: newConfig }, "config"),
      );
    } catch (err) {
      log.error({ err }, "Failed to reload config");
    }
  });
}

/**
 * Stop watching the config file.
 */
export function unwatchConfig(): void {
  if (configPath) {
    unwatchFile(configPath);
  }
}

/**
 * Generate a default config TOML string for the onboarding wizard.
 */
export function generateDefaultConfig(): string {
  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `# Zaakify Configuration
# Location: ~/.zaakify/zaakify.toml
# Docs: https://zaakify.dev/docs/config

version = 1
timezone = "${detectedTz}"  # Auto-detected from system. Change if deploying to a different timezone.

[owner]
name = "Owner"  # Your name — used by webchat/API and injected into the agent's context

[gateway]
host = "127.0.0.1"
port = 18800
wsPath = "/ws"

# ─── AI Agent (Z.AI GLM) ────────────────────────────────
[[agents]]
id = "default"
name = "Zaakify Agent"
provider = "zai"
model = "glm-4.7"
systemPrompt = ""
tools = []
apiKey = "\${ZAI_API_KEY}"

# ─── Channels ───────────────────────────────────────────
# Uncomment and configure the channels you want to use.

# [channels.discord]
# enabled = true
# token = "\${DISCORD_BOT_TOKEN}"
# allowedGuilds = []
# allowedChannels = []

# [channels.telegram]
# enabled = true
# botToken = "\${TELEGRAM_BOT_TOKEN}"
# allowedUsers = []

# [channels.whatsapp]
# enabled = true
# sessionDataPath = "./data/whatsapp"

# ─── Routing ────────────────────────────────────────────
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

# ─── Security ───────────────────────────────────────────
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

# ─── Memory ─────────────────────────────────────────────
[memory]
enabled = true
dbPath = "./data/memory.db"
embeddingProvider = "none"
maxResults = 10
similarityThreshold = 0.7

# ─── Logging ────────────────────────────────────────────
[logging]
level = "info"
pretty = true
`;
}
