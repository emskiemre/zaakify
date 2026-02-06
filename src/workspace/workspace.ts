/**
 * Zaakify Workspace Manager
 *
 * Manages the agent's workspace directory and bootstrap files.
 * On first run, seeds template files that guide the agent through
 * self-discovery. The agent fills these in and deletes BOOTSTRAP.md
 * when done — no hard-coded personality.
 *
 * Templates live in ./templates.ts, prompt building in ./prompt-builder.ts.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { getLogger } from "../utils/logger.js";
import {
  PERSONA_DIR,
  JOURNAL_DIR,
  EXTENSIONS_DIR,
  PERSISTENT_DIR,
  WORKSPACE_DIR,
  DRIVE_DIR,
  DOWNLOADS_DIR,
  SESSIONS_DIR,
  LOGS_DIR,
} from "../paths.js";
import { TEMPLATES } from "./templates.js";
import { WORKSPACE_FILES } from "./prompt-builder.js";

// Re-export prompt-builder functions so existing imports from workspace.ts still work
export { WORKSPACE_FILES, loadWorkspaceFiles, buildWorkspaceContext } from "./prompt-builder.js";

const log = getLogger("workspace");

// ─── Default persona path ───────────────────────────────────────
export const DEFAULT_WORKSPACE = PERSONA_DIR;

// ─── Functions ──────────────────────────────────────────────────

/**
 * Ensure the workspace directory exists and seed template files
 * if this is a brand-new workspace.
 */
export function ensureWorkspace(workspacePath?: string): string {
  const workspace = workspacePath || DEFAULT_WORKSPACE;

  if (!existsSync(workspace)) {
    mkdirSync(workspace, { recursive: true });
    log.info({ workspace }, "Created persona directory");
  }

  // Ensure all directories in the ~/.zaakify tree exist
  for (const dir of [EXTENSIONS_DIR, JOURNAL_DIR, PERSISTENT_DIR, WORKSPACE_DIR, DRIVE_DIR, DOWNLOADS_DIR, SESSIONS_DIR, LOGS_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Check if this is a brand-new workspace (no identity files exist)
  const isNew = !WORKSPACE_FILES
    .filter((f) => f !== "BOOTSTRAP.md")
    .some((f) => {
      if (!existsSync(join(workspace, f))) return false;
      // File exists but check if it's been filled in (not just template)
      const content = readFileSync(join(workspace, f), "utf-8");
      return !content.includes("_(not yet");
    });

  if (isNew) {
    // Seed all templates
    for (const [filename, content] of Object.entries(TEMPLATES)) {
      const filePath = join(workspace, filename);
      if (!existsSync(filePath)) {
        writeFileSync(filePath, content, "utf-8");
        log.info({ file: filename }, "Seeded template file");
      }
    }
  }

  return workspace;
}

/**
 * Check if the bootstrap ritual is still pending (BOOTSTRAP.md exists).
 */
export function isBootstrapPending(workspace: string): boolean {
  return existsSync(join(workspace, "BOOTSTRAP.md"));
}

/**
 * Load extension manifest (MANIFEST.json)
 */
function loadManifest(dirPath: string): {
  description?: string;
  displayName?: string;
  category?: string;
  capabilities?: string[];
  requiresConfiguration?: boolean;
  configurationGuide?: string;
} | null {
  const manifestPath = join(dirPath, "MANIFEST.json");
  if (!existsSync(manifestPath)) return null;
  
  try {
    return JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Extract description from README.md (line 3 typically contains description)
 * FALLBACK: Only used if MANIFEST.json is missing
 */
function extractReadmeDescription(dirPath: string): string {
  const readmePath = join(dirPath, "README.md");
  if (!existsSync(readmePath)) return "";
  
  try {
    const content = readFileSync(readmePath, "utf-8");
    const lines = content.split("\n");
    
    // Look for first non-empty line after the title (usually line 3)
    for (let i = 1; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].trim();
      // Skip empty lines and lines that are just markdown formatting
      if (line && !line.startsWith("#") && !line.startsWith("---") && line.length > 10) {
        return line;
      }
    }
  } catch {
    // Ignore read errors
  }
  
  return "";
}

/**
 * Extract features list from README.md
 * FALLBACK: Only used if MANIFEST.json is missing
 */
function extractReadmeFeatures(dirPath: string): string[] {
  const readmePath = join(dirPath, "README.md");
  if (!existsSync(readmePath)) return [];
  
  try {
    const content = readFileSync(readmePath, "utf-8");
    const lines = content.split("\n");
    const features: string[] = [];
    
    let inFeaturesSection = false;
    for (const line of lines) {
      if (line.includes("## Features")) {
        inFeaturesSection = true;
        continue;
      }
      if (inFeaturesSection) {
        if (line.startsWith("##")) break; // End of features section
        if (line.trim().startsWith("-")) {
          // Extract feature: "- **Feature name** - description"
          const match = line.match(/\*\*(.+?)\*\*/);
          if (match) {
            features.push(match[1]);
          }
        }
      }
    }
    
    return features.slice(0, 5); // Max 5 features
  } catch {
    return [];
  }
}

/**
 * Generate EXTENSIONS.md with discovered extensions metadata.
 * This file is auto-generated on boot and updated when extensions change.
 * All metadata is extracted dynamically from extension files - no hardcoding.
 */
export function generateExtensionsDoc(
  workspace: string,
  extensions: Array<{
    name: string;
    description: string;
    status: string;
    tools: string[];
    hasDependencies: boolean;
    dirPath?: string;
  }>
): void {
  const lines: string[] = [
    "# EXTENSIONS.md — Available Capabilities",
    "",
    "_This file is auto-generated on boot. Do not edit manually._",
    "",
    "Extensions add specialized tools for specific tasks. They run in isolated processes",
    "and must be started before use with: `Extension({ action: \"start\", name: \"extension-name\" })`",
    "",
    "**Only one extension can run at a time.** Always stop the current one before starting another.",
    "",
  ];

  if (extensions.length === 0) {
    lines.push("## No Extensions Available");
    lines.push("");
    lines.push("No extensions are currently installed.");
    lines.push("");
  } else {
    lines.push("## Available Extensions");
    lines.push("");

    for (const ext of extensions) {
      if (!ext.dirPath) continue;

      // Extract metadata dynamically from extension files
      let description = ext.description || "";
      let displayName = ext.name;
      let category = "";
      let capabilities: string[] = [];
      let configured = true;
      let setupGuide = "";
      
      // PRIORITY 1: Try MANIFEST.json (structured, reliable)
      const manifest = loadManifest(ext.dirPath);
      if (manifest) {
        description = manifest.description || description;
        displayName = manifest.displayName || displayName;
        category = manifest.category || "";
        capabilities = manifest.capabilities || [];
        setupGuide = manifest.configurationGuide || "";
        // Override configured if manifest specifies requiresConfiguration
        if (manifest.requiresConfiguration !== undefined) {
          // Will check actual config.json below
        }
      }

      // PRIORITY 2: Try package.json description (if manifest missing)
      if (!description) {
        const pkgPath = join(ext.dirPath, "package.json");
        if (existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            if (pkg.description) {
              description = pkg.description;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // PRIORITY 3: Try README.md description (fallback)
      if (!description) {
        description = extractReadmeDescription(ext.dirPath);
      }

      // PRIORITY 4: Try README.md features (if manifest missing capabilities)
      if (capabilities.length === 0) {
        capabilities = extractReadmeFeatures(ext.dirPath);
      }

      // Check configuration status from config.json
      const configPath = join(ext.dirPath, "config.json");
      if (existsSync(configPath)) {
        try {
          const config = JSON.parse(readFileSync(configPath, "utf-8"));
          configured = config.configured !== false;
        } catch {
          // Ignore parse errors
        }
      }

      // Determine status display
      let statusDisplay = ext.status;
      if (ext.status === "discovered" && !configured) {
        statusDisplay = "Discovered (not configured)";
      } else if (ext.status === "discovered") {
        statusDisplay = "Discovered (ready to start)";
      }

      // Write extension section
      lines.push(`### ${displayName}`);
      
      if (category) {
        lines.push(`**Category:** ${category.charAt(0).toUpperCase() + category.slice(1)}`);
      }
      
      lines.push(`**Status:** ${statusDisplay}`);
      
      if (ext.tools.length > 0) {
        lines.push(`**Tools:** ${ext.tools.join(", ")}`);
      } else {
        lines.push("**Tools:** (available after start)");
      }

      if (description) {
        lines.push(`**Description:** ${description}`);
      }

      if (capabilities.length > 0) {
        lines.push(`**Capabilities:** ${capabilities.join(", ")}`);
      }

      // Setup requirements
      if (setupGuide) {
        lines.push(`**Setup:** ${setupGuide}`);
      } else if (existsSync(configPath) && !configured) {
        lines.push("**Setup:** Requires configuration - guide user through interactive setup if available");
      } else if (ext.hasDependencies) {
        lines.push("**Setup:** Has dependencies - auto-installed on first start");
      } else {
        lines.push("**Setup:** No configuration needed");
      }

      lines.push("");
    }
  }

  // Add usage instructions
  lines.push("## How to Use Extensions");
  lines.push("");
  lines.push("1. **List available:** `Extension({ action: \"list\" })`");
  lines.push("2. **Get details:** `Extension({ action: \"info\", name: \"extension-name\" })`");
  lines.push("3. **Start when needed:** `Extension({ action: \"start\", name: \"extension-name\" })`");
  lines.push("4. **Use the tools** provided by the extension");
  lines.push("5. **Stop when done:** `Extension({ action: \"stop\", name: \"extension-name\" })`");
  lines.push("");
  lines.push("When you start an extension, you'll receive its GUIDANCE.md with detailed usage instructions.");
  lines.push("");
  lines.push("## Important Notes");
  lines.push("");
  lines.push("- Extensions are isolated processes - they don't share state");
  lines.push("- Only ONE extension can run at a time - stop before starting another");
  lines.push("- Dependencies auto-install on first start (may take a minute)");
  lines.push("- Some extensions require configuration before use");
  lines.push("- When user asks for capability an extension provides, start it proactively");
  lines.push("");

  const filePath = join(workspace, "EXTENSIONS.md");
  writeFileSync(filePath, lines.join("\n"), "utf-8");
  log.info({ file: "EXTENSIONS.md", count: extensions.length }, "Generated extensions documentation");
}
