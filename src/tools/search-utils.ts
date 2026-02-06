/**
 * Search Utilities — glob and grep implementations for agent tools.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Recursively glob files matching a pattern.
 */
export function globFiles(dir: string, pattern: string, results: string[] = []): string[] {
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "§DOUBLESTAR§")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/§DOUBLESTAR§/g, ".*")
    .replace(/\?/g, ".");
  const regex = new RegExp(`^${regexStr}$`, "i");

  function walk(current: string, base: string): void {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && !pattern.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      const fullPath = join(current, entry.name);
      const relPath = relative(base, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(fullPath, base);
      } else if (regex.test(relPath)) {
        results.push(relPath);
      }
    }
  }

  walk(dir, dir);
  return results;
}

/**
 * Search file contents for a regex pattern.
 */
export function grepFiles(
  dir: string,
  pattern: string,
  include?: string,
  maxResults = 50,
): Array<{ file: string; line: number; text: string }> {
  const regex = new RegExp(pattern, "gi");
  const includeRegex = include
    ? new RegExp(
        include
          .replace(/\./g, "\\.")
          .replace(/\*/g, ".*")
          .replace(/\{([^}]+)\}/g, "($1)")
          .replace(/,/g, "|"),
      )
    : null;
  const results: Array<{ file: string; line: number; text: string }> = [];

  function walk(current: string): void {
    if (results.length >= maxResults) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const relPath = relative(dir, fullPath).replace(/\\/g, "/");
        if (includeRegex && !includeRegex.test(relPath)) continue;
        try {
          const content = readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push({ file: relPath, line: i + 1, text: lines[i].trim().slice(0, 200) });
              if (results.length >= maxResults) return;
            }
            regex.lastIndex = 0;
          }
        } catch { /* binary file or unreadable */ }
      }
    }
  }

  walk(dir);
  return results;
}
