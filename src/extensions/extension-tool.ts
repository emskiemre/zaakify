/**
 * Extension Tool — Agent-facing tool for managing extensions.
 *
 * Delegates all logic to the ExtensionHost. This file only handles
 * parameter parsing, action routing, and output formatting.
 */

import type { ToolDefinition, ToolResult } from "../types/index.js";
import { ToolId as makeToolId } from "../types/index.js";
import { getLogger } from "../utils/logger.js";
import type { ExtensionHost } from "./extension-host.js";
import { generateExtensionsDoc } from "../workspace/workspace.js";
import { PERSONA_DIR } from "../paths.js";

const log = getLogger("extension-tool");

/**
 * Creates the Extension tool that the agent uses to manage extensions.
 */
export function createExtensionTool(host: ExtensionHost, workspacePath?: string): ToolDefinition {
  const workspace = workspacePath || PERSONA_DIR;
  return {
    id: makeToolId("Extension"),
    name: "Extension",
    description: [
      "Manage extensions. Extensions are discovered on boot but not started automatically.",
      "Use 'list' to see available extensions, then 'start' to launch the ones you need.",
      "",
      "Actions:",
      "  list      — Scan directory and show all extensions with status and tools.",
      "  info      — Get detailed info about an extension. Requires: name.",
      "  start     — Start an extension (installs deps if needed, forks process, registers tools). Requires: name.",
      "  stop      — Stop a running extension (kills process, unregisters tools, keeps files). Requires: name.",
      "  restart   — Stop + start an extension (re-reads config). Requires: name.",
      "  install   — Install npm dependencies for an extension. Requires: name.",
      "  uninstall — Remove npm dependencies (keep extension code). Requires: name.",
      "  remove    — Stop and delete an extension and all its files. Requires: name.",
      "",
      "Typical workflow:",
      '  1. Extension({ action: "list" })           — see what\'s available',
      '  2. Extension({ action: "info", name: "browser" }) — check if configured',
      '  3. Extension({ action: "start", name: "browser" }) — launch it',
      '  4. Use extension tools directly: browser-open({ url: "..." })',
      '  5. Extension({ action: "stop", name: "browser" }) — done, free resources',
    ].join("\n"),
    parameters: {
      action: {
        type: "string",
        description: 'One of: "list", "info", "start", "stop", "restart", "install", "uninstall", "remove"',
        required: true,
        enum: ["list", "info", "start", "stop", "restart", "install", "uninstall", "remove"],
      },
      name: {
        type: "string",
        description: "Extension name (required for all actions except list)",
      },
    },
    requiredParams: ["action"],
    handler: async (params): Promise<ToolResult> => {
      const action = params.action as string;

      try {
        switch (action) {
          case "list":
            return handleList(host, workspace);
          case "info":
            return handleInfo(host, params.name as string);
          case "start":
            return await handleStart(host, params.name as string, workspace);
          case "stop":
            return handleStop(host, params.name as string);
          case "restart":
            return await handleRestart(host, params.name as string, workspace);
          case "install":
            return await handleInstall(host, params.name as string, workspace);
          case "uninstall":
            return handleUninstall(host, params.name as string);
          case "remove":
            return handleRemove(host, params.name as string, workspace);
          default:
            return {
              toolCallId: "",
              output: `Unknown action: ${action}. Use: list, info, start, stop, restart, install, uninstall, remove.`,
              isError: true,
            };
        }
      } catch (err) {
        log.error({ err, action }, "Extension tool error");
        return {
          toolCallId: "",
          output: `Extension error: ${(err as Error).message}`,
          isError: true,
        };
      }
    },
  };
}

// ─── Action handlers ──────────────────────────────────────────────

function requireName(name: string | undefined): ToolResult | null {
  if (!name) {
    return { toolCallId: "", output: "Missing required field: name", isError: true };
  }
  return null;
}

function handleList(host: ExtensionHost, workspace: string): ToolResult {
  const exts = host.listExtensions(); // Already calls discoverAll() to re-scan directory
  
  // Regenerate EXTENSIONS.md to catch newly added extensions
  try {
    generateExtensionsDoc(workspace, exts);
    log.info("Regenerated EXTENSIONS.md after listing extensions");
  } catch (genErr) {
    log.warn({ err: genErr }, "Failed to regenerate EXTENSIONS.md");
  }
  
  if (exts.length === 0) {
    return { toolCallId: "", output: "No extensions found in ~/.zaakify/extensions/." };
  }
  const lines = exts.map((e) => {
    const status = e.status.toUpperCase();
    return [
      `[${status}] ${e.name}`,
      `  ${e.description || "Not started yet"}`,
      `  Tools: ${e.tools.join(", ") || "none (start to discover)"}`,
      ...(e.hasDependencies ? ["  Has npm dependencies"] : []),
    ].join("\n");
  });
  return { toolCallId: "", output: lines.join("\n\n") };
}

function handleInfo(host: ExtensionHost, name: string): ToolResult {
  const err = requireName(name);
  if (err) return err;

  const result = host.getExtensionInfo(name);
  if (!result.ok) {
    return { toolCallId: "", output: result.message || "Unknown error", isError: true };
  }
  const info = result.info!;
  const output = [
    `Extension: ${info.name}`,
    `Description: ${info.description || "Not started yet"}`,
    `Status: ${info.status.toUpperCase()}`,
    `Configured: ${info.configured ? "Yes" : "No"}`,
    ``,
    `Dependencies:`,
    `  Has dependencies: ${info.hasDependencies ? "Yes" : "No"}`,
    ...(info.hasDependencies ? [
      `  Installed: ${info.dependenciesInstalled ? "Yes" : "No"}`,
      ...(info.packageJson?.dependencies ? [
        `  Packages: ${Object.keys(info.packageJson.dependencies as object).join(", ")}`,
      ] : []),
    ] : []),
    ``,
    `Tools (${info.tools.length}):`,
    ...(info.tools.length > 0 ? info.tools.map(t => `  - ${t.name}: ${t.description}`) : ["  (none — start the extension to discover tools)"]),
    ``,
    `Files:`,
    `  Directory: ${info.dirPath}`,
    `  Config: ${info.configPath || "Not found"}`,
    `  README: ${info.readmePath || "Not found"}`,
    `  Schema: ${info.schemaPath || "Not found"}`,
    ...(info.lastError ? [``, `Last error: ${info.lastError}`] : []),
  ].join("\n");
  return { toolCallId: "", output };
}

async function handleStart(host: ExtensionHost, name: string, workspace: string): Promise<ToolResult> {
  const err = requireName(name);
  if (err) return err;
  const result = await host.startExtension(name); // Discovers, installs deps, starts
  
  // Regenerate EXTENSIONS.md after starting extension (now has actual tool names)
  if (result.ok) {
    try {
      const extensionsList = host.listExtensions();
      generateExtensionsDoc(workspace, extensionsList);
      log.info({ name }, "Regenerated EXTENSIONS.md after starting extension");
    } catch (genErr) {
      log.warn({ err: genErr }, "Failed to regenerate EXTENSIONS.md");
    }
  }
  
  return { toolCallId: "", output: result.message, isError: !result.ok };
}

function handleStop(host: ExtensionHost, name: string): ToolResult {
  const err = requireName(name);
  if (err) return err;
  const result = host.stopExtension(name);
  return { toolCallId: "", output: result.message, isError: !result.ok };
}

async function handleRestart(host: ExtensionHost, name: string, workspace: string): Promise<ToolResult> {
  const err = requireName(name);
  if (err) return err;
  const result = await host.restartExtension(name); // Stop + start
  
  // Regenerate EXTENSIONS.md after restarting (in case config changed)
  if (result.ok) {
    try {
      const extensionsList = host.listExtensions();
      generateExtensionsDoc(workspace, extensionsList);
      log.info({ name }, "Regenerated EXTENSIONS.md after restarting extension");
    } catch (genErr) {
      log.warn({ err: genErr }, "Failed to regenerate EXTENSIONS.md");
    }
  }
  
  return { toolCallId: "", output: result.message, isError: !result.ok };
}

async function handleInstall(host: ExtensionHost, name: string, workspace: string): Promise<ToolResult> {
  const err = requireName(name);
  if (err) return err;
  const result = await host.installDependencies(name);
  
  // Regenerate EXTENSIONS.md after installing a new extension
  if (result.ok) {
    try {
      const extensionsList = host.listExtensions();
      generateExtensionsDoc(workspace, extensionsList);
    } catch (genErr) {
      log.warn({ err: genErr }, "Failed to regenerate EXTENSIONS.md");
    }
  }
  
  return { toolCallId: "", output: result.message, isError: !result.ok };
}

function handleUninstall(host: ExtensionHost, name: string): ToolResult {
  const err = requireName(name);
  if (err) return err;
  const result = host.uninstallDependencies(name);
  return { toolCallId: "", output: result.message, isError: !result.ok };
}

function handleRemove(host: ExtensionHost, name: string, workspace: string): ToolResult {
  const err = requireName(name);
  if (err) return err;
  const result = host.removeExtension(name);
  
  // Regenerate EXTENSIONS.md after removing an extension
  if (result.ok) {
    try {
      const extensionsList = host.listExtensions();
      generateExtensionsDoc(workspace, extensionsList);
    } catch (genErr) {
      log.warn({ err: genErr }, "Failed to regenerate EXTENSIONS.md");
    }
  }
  
  return { toolCallId: "", output: result.message, isError: !result.ok };
}
