/**
 * Prompt Builder — builds the workspace context section of the system prompt.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { JOURNAL_DIR } from "../paths.js";

/** Files loaded into the system prompt. */
export const WORKSPACE_FILES = [
  "AGENT.md",
  "PERSONA.md",
  "EXTENSIONS.md",
  "CONTEXT.md",
  "MEMORY.md",
  "BOOTSTRAP.md",
];

/**
 * Load all workspace files for injection into the system prompt.
 * Returns a map of filename -> content (only existing files).
 */
export function loadWorkspaceFiles(workspace: string): Map<string, string> {
  const files = new Map<string, string>();

  const limits: Record<string, number> = {
    "MEMORY.md": 15000,
    "CONTEXT.md": 10000,
    "PERSONA.md": 5000,
  };
  const defaultLimit = 5000;

  for (const filename of WORKSPACE_FILES) {
    const filePath = join(workspace, filename);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const limit = limits[filename] || defaultLimit;
        const trimmed = content.slice(0, limit);
        const wasTrimmed = content.length > limit;
        if (wasTrimmed) {
          files.set(filename, trimmed + `\n\n_(truncated — full file is ${content.length} chars, use Read tool to see more)_`);
        } else {
          files.set(filename, trimmed);
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return files;
}

/**
 * Get today's YYYY-MM-DD in the given timezone.
 */
function dateInTimezone(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Load daily memory logs (today + yesterday) from journal directory.
 */
function loadDailyLogs(timezone: string): Map<string, string> {
  const logs = new Map<string, string>();

  if (!existsSync(JOURNAL_DIR)) return logs;

  const now = new Date();
  const todayStr = dateInTimezone(now, timezone);
  const yesterday = new Date(now.getTime() - 86_400_000);
  const yesterdayStr = dateInTimezone(yesterday, timezone);

  for (const date of [todayStr, yesterdayStr]) {
    const filePath = join(JOURNAL_DIR, `${date}.md`);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        if (content.trim().length > 0) {
          logs.set(`memory/journal/${date}.md`, content.slice(0, 8000));
        }
      } catch { /* skip */ }
    }
  }

  return logs;
}

/**
 * Build the context section of the system prompt from workspace files.
 */
export function buildWorkspaceContext(
  workspace: string,
  timezone: string = "UTC",
  ownerName: string = "Owner",
): string {
  const files = loadWorkspaceFiles(workspace);
  if (files.size === 0) return "";

  const sections: string[] = ["\n# Workspace Context\n"];
  sections.push(`Your workspace directory is: ${workspace}\n`);
  sections.push(`Your owner is: ${ownerName}\n`);
  sections.push(`Your timezone is: ${timezone}\n`);

  for (const [filename, content] of files) {
    sections.push(`## ${filename}\n\n${content}\n`);
  }

  const dailyLogs = loadDailyLogs(timezone);
  if (dailyLogs.size > 0) {
    sections.push("\n# Recent Daily Logs\n");
    for (const [filename, content] of dailyLogs) {
      sections.push(`## ${filename}\n\n${content}\n`);
    }
  }

  return sections.join("\n");
}
