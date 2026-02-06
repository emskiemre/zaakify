/**
 * Zaakify Tool Registry
 *
 * Central registry for all tools the AI agent can use.
 * Tools are registered with typed schemas and handlers.
 *
 * Built-in tools:
 *   - current_time: get current date/time
 *
 * File tools (registered separately via registerFileTools):
 *   - Read, Write, Edit, Delete, Bash, Glob, Grep, List, WebFetch
 */

import type { ToolDefinition, ToolId, ToolResult } from "../types/index.js";
import { ToolId as makeToolId } from "../types/index.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger("tools");

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    log.debug({ tool: tool.name }, "Tool registered");
  }

  unregister(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) log.info({ tool: name }, "Tool unregistered");
    return removed;
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getToolsForAgent(toolIds: (string | ToolId)[]): ToolDefinition[] {
    if (toolIds.length === 0) return this.getAllTools();
    const idSet = new Set(toolIds.map(String));
    return this.getAllTools().filter(
      (t) => idSet.has(t.name) || idSet.has(String(t.id)),
    );
  }

  get count(): number {
    return this.tools.size;
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }
}

/**
 * Register minimal built-in tools.
 * File/code tools are registered separately via registerFileTools().
 */
export function registerBuiltinTools(registry: ToolRegistry): void {
  // --- Current Time ---
  registry.register({
    id: makeToolId("Time"),
    name: "Time",
    description: "Get the current date and time in the specified timezone. Use the user's timezone from PERSONA.md when available.",
    parameters: {
      timezone: {
        type: "string",
        description: "IANA timezone (e.g., America/New_York). Defaults to UTC.",
        default: "UTC",
      },
    },
    requiredParams: [],
    handler: async (params): Promise<ToolResult> => {
      const tz = (params.timezone as string) || "UTC";
      try {
        const now = new Date();
        const formatted = now.toLocaleString("en-US", { timeZone: tz });
        return {
          toolCallId: "",
          output: JSON.stringify({ iso: now.toISOString(), formatted, timezone: tz, unix: now.getTime() }),
        };
      } catch {
        return { toolCallId: "", output: `Invalid timezone: ${tz}`, isError: true };
      }
    },
  });

  log.info({ count: registry.count }, "Built-in tools registered");
}
