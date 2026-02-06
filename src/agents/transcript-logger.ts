/**
 * Transcript Logger — writes JSONL conversation logs to disk.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SESSIONS_DIR } from "../paths.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger("transcript");

function ensureSessionsDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

/**
 * Append a JSONL entry to a session transcript file.
 */
export function logTranscript(sessionId: string, entry: Record<string, unknown>): void {
  try {
    ensureSessionsDir();
    const line = JSON.stringify({ ...entry, timestamp: Date.now() }) + "\n";
    appendFileSync(join(SESSIONS_DIR, `${sessionId}.jsonl`), line, "utf-8");
  } catch (err) {
    log.debug({ err }, "Failed to write transcript");
  }
}
