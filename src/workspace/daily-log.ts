/**
 * Zaakify Daily Log
 *
 * System-level conversation logger. Listens on the event bus and
 * writes human-readable markdown to memory/journal/YYYY-MM-DD.md.
 *
 * Every exchange is captured automatically:
 *   - User messages (with channel and timestamp)
 *   - Tool calls the agent made (name + brief args)
 *   - Agent responses
 *
 * All dates and times use the user's configured timezone (from config),
 * not the server's OS timezone. This ensures logs make sense even when
 * Zaakify runs on a cloud VPS in UTC.
 *
 * The agent doesn't need to write these — the system does it.
 * The agent can still read them (today + yesterday are auto-loaded
 * into context), and can search older ones via Glob/Read.
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { getEventBus } from "../kernel/event-bus.js";
import { getLogger } from "../utils/logger.js";
import { JOURNAL_DIR } from "../paths.js";
import type { KernelEvent } from "../types/index.js";

const log = getLogger("daily-log");

// ─── Types for event payloads ────────────────────────────────────

interface InboundPayload {
  message?: {
    content: string;
    channelType: string;
    user: { displayName: string };
  };
}

interface ToolUsePayload {
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

interface AgentResponsePayload {
  content?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Truncate a string to maxLen, appending "..." if truncated. */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "...";
}

/** Summarize tool arguments into a short readable string. */
function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(args)) {
    if (val === undefined || val === null) continue;
    const str = typeof val === "string" ? val : JSON.stringify(val);
    parts.push(`${key}=${truncate(str, 80)}`);
  }
  return parts.join(", ") || "(no args)";
}

// ─── Daily Log ───────────────────────────────────────────────────

export class DailyLog {
  private memoryDir: string;
  private timezone: string;
  private unsubscribers: Array<() => void> = [];

  // Buffer tool calls between agent:tool_use and agent:response
  // so we can group them in the same log entry as the response.
  private pendingToolCalls: Map<string, string[]> = new Map();

  constructor(_workspace: string, timezone: string) {
    this.memoryDir = JOURNAL_DIR;
    this.timezone = timezone;
  }

  /**
   * Get today's date string (YYYY-MM-DD) in the user's timezone.
   */
  private todayStr(): string {
    const d = new Date();
    // Use Intl to get date parts in the user's timezone
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: this.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d); // en-CA gives YYYY-MM-DD format
    return parts;
  }

  /**
   * Get current time (HH:MM) in the user's timezone.
   */
  private timeStr(): string {
    const d = new Date();
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: this.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  }

  /**
   * Start listening on the event bus.
   */
  start(): void {
    if (!existsSync(this.memoryDir)) {
      mkdirSync(this.memoryDir, { recursive: true });
    }

    const bus = getEventBus();

    // Listen to inbound user messages
    const unsub1 = bus.on("message:inbound", (event: KernelEvent) => {
      const payload = event.payload as InboundPayload;
      if (!payload.message) return;

      const { content, channelType, user } = payload.message;
      if (!content?.trim()) return;

      const correlationId = event.correlationId || "unknown";

      this.append([
        `### ${this.timeStr()} — ${user.displayName} (${channelType})`,
        "",
        `> ${truncate(content.replace(/\n/g, "\n> "), 1000)}`,
        "",
      ]);

      // Reset pending tool calls for this conversation turn
      this.pendingToolCalls.set(correlationId, []);
    });

    // Listen to tool use events — buffer them
    const unsub2 = bus.on("agent:tool_use", (event: KernelEvent) => {
      const payload = event.payload as ToolUsePayload;
      if (!payload.toolCalls?.length) return;

      const correlationId = event.correlationId || "unknown";
      const pending = this.pendingToolCalls.get(correlationId) || [];

      for (const tc of payload.toolCalls) {
        pending.push(`- **${tc.name}**(${summarizeArgs(tc.arguments)})`);
      }

      this.pendingToolCalls.set(correlationId, pending);
    });

    // Listen to intermediate messages — agent said something before running tools
    const unsub3 = bus.on("agent:intermediate", (event: KernelEvent) => {
      const payload = event.payload as AgentResponsePayload;
      if (!payload.content?.trim()) return;

      this.append([
        `**Agent:** ${truncate(payload.content, 2000)}`,
        "",
      ]);
    });

    // Listen to agent responses — write the full turn
    const unsub4 = bus.on("agent:response", (event: KernelEvent) => {
      const payload = event.payload as AgentResponsePayload;
      if (!payload.content?.trim()) return;

      const correlationId = event.correlationId || "unknown";
      const toolLines = this.pendingToolCalls.get(correlationId) || [];
      this.pendingToolCalls.delete(correlationId);

      const lines: string[] = [];

      // Tool calls summary (if any)
      if (toolLines.length > 0) {
        lines.push("**Tools used:**");
        lines.push(...toolLines);
        lines.push("");
      }

      // Agent response
      lines.push(`**Agent:** ${truncate(payload.content, 2000)}`);
      lines.push("");
      lines.push("---");
      lines.push("");

      this.append(lines);
    });

    this.unsubscribers.push(unsub1, unsub2, unsub3, unsub4);
    log.info({ memoryDir: this.memoryDir, timezone: this.timezone }, "Daily log started");
  }

  /**
   * Stop listening.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.pendingToolCalls.clear();
    log.info("Daily log stopped");
  }

  /**
   * Append lines to today's daily log file.
   * Creates the file with a header if it doesn't exist yet.
   */
  private append(lines: string[]): void {
    try {
      const date = this.todayStr();
      const filePath = join(this.memoryDir, `${date}.md`);

      // Create file with header if new
      if (!existsSync(filePath)) {
        const header = `# Daily Log — ${date}\n\n`;
        appendFileSync(filePath, header, "utf-8");
        log.info({ date }, "Created daily log file");
      }

      appendFileSync(filePath, lines.join("\n") + "\n", "utf-8");
    } catch (err) {
      log.debug({ err }, "Failed to write daily log entry");
    }
  }
}
