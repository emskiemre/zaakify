/**
 * Zaakify Directory Structure
 *
 * Central definition of all paths under ~/.zaakify/.
 * Every module imports from here — no scattered homedir() calls.
 *
 * Structure:
 *   ~/.zaakify/
 *   ├── zaakify.toml      # Main configuration file
 *   ├── persona/          # Agent identity & behavior files
 *   │   ├── AGENT.md        # How to work (rules, tools, memory)
 *   │   ├── PERSONA.md      # Who you are (identity, personality, user info)
 *   │   ├── CONTEXT.md      # Project context
 *   │   ├── MEMORY.md       # Long-term memory
 *   │   └── BOOTSTRAP.md    # First-run onboarding (deleted after)
 *   ├── extensions/       # Extensions (each in own subdirectory)
 *   ├── memory/
 *   │   ├── journal/      # Daily conversation logs (YYYY-MM-DD.md)
 *   │   ├── persistent/   # Future: sqlite, vector db, etc.
 *   │   └── cron.json     # Scheduled jobs
 *   ├── workspace/        # Agent scratch pad / working directory
 *   ├── drive/            # Persistent file storage
 *   │   └── downloads/    # Downloaded files (email attachments, web content, etc.)
 *   ├── sessions/         # Session transcripts (.jsonl)
 *   └── logs/
 *       └── zaakify.log   # Log file
 */

import { join } from "node:path";
import { homedir } from "node:os";

// ─── Root ────────────────────────────────────────────────────────

export const ZAAKIFY_HOME = join(homedir(), ".zaakify");

// ─── Top-level directories ───────────────────────────────────────

export const PERSONA_DIR = join(ZAAKIFY_HOME, "persona");
export const EXTENSIONS_DIR = join(ZAAKIFY_HOME, "extensions");
export const MEMORY_DIR = join(ZAAKIFY_HOME, "memory");
export const JOURNAL_DIR = join(MEMORY_DIR, "journal");
export const PERSISTENT_DIR = join(MEMORY_DIR, "persistent");
export const WORKSPACE_DIR = join(ZAAKIFY_HOME, "workspace");
export const DRIVE_DIR = join(ZAAKIFY_HOME, "drive");
export const DOWNLOADS_DIR = join(DRIVE_DIR, "downloads");
export const SESSIONS_DIR = join(ZAAKIFY_HOME, "sessions");
export const LOGS_DIR = join(ZAAKIFY_HOME, "logs");

// ─── Files ───────────────────────────────────────────────────────

export const CONFIG_FILE = join(ZAAKIFY_HOME, "zaakify.toml");
export const LOG_FILE = join(LOGS_DIR, "zaakify.log");
export const CRON_FILE = join(MEMORY_DIR, "cron.json");
