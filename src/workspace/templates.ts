/**
 * Workspace Templates — seed files for new workspaces.
 *
 * Templates are loaded from boot_templates/ folder at runtime.
 * This keeps the code clean and templates easy to edit.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getLogger } from "../utils/logger.js";

const log = getLogger("templates");

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "boot_templates");

const TEMPLATE_FILES = [
  "AGENT.md",
  "PERSONA.md",
  "BOOTSTRAP.md",
  "CONTEXT.md",
  "MEMORY.md",
];

/**
 * Load all templates from boot_templates/ folder.
 */
function loadTemplates(): Record<string, string> {
  const templates: Record<string, string> = {};

  for (const filename of TEMPLATE_FILES) {
    try {
      const filePath = join(TEMPLATES_DIR, filename);
      templates[filename] = readFileSync(filePath, "utf-8");
    } catch (err) {
      log.warn({ filename, err }, "Failed to load template, using fallback");
      templates[filename] = `# ${filename}\n\n_(template not found)_\n`;
    }
  }

  return templates;
}

export const TEMPLATES: Record<string, string> = loadTemplates();
