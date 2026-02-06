/**
 * Zaakify Cron Tool
 *
 * Gives the agent the ability to manage its own schedule.
 * Actions: add, remove, list, toggle.
 *
 * The agent can say "remind me every morning at 7am to check my email"
 * and it will create a cron job that fires a message to itself.
 */

import type { ToolDefinition, ToolResult } from "../types/index.js";
import { ToolId as makeToolId } from "../types/index.js";
import type { Scheduler } from "./scheduler.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger("cron-tool");

export function createCronTool(scheduler: Scheduler): ToolDefinition {
  return {
    id: makeToolId("Cron"),
    name: "Cron",
    description: [
      "Manage scheduled tasks. You can create recurring jobs (cron expressions) or one-shot reminders.",
      "When a job fires, you receive its message as if the user sent it — you can then act on it.",
      "",
      "Actions:",
      '  add — Create a job. Requires: name, schedule (cron expr like "0 7 * * *" or "in 20m"), message.',
      "  remove — Delete a job by ID.",
      "  list — Show all jobs with their status, next run time, and run count.",
      "  toggle — Enable or disable a job by ID.",
      "",
      "Schedule formats:",
      '  Cron: "0 7 * * *" (7am daily), "*/5 * * * *" (every 5 min), "0 9 * * 1" (Mon 9am)',
      '  Exact time: "30 1 * * *" = exactly 1:30 AM. ALWAYS use cron expressions for specific times the user requests.',
      '  Relative: "in 20m", "in 2h", "in 1d" — ONLY for vague requests like "in a few minutes". These are approximate.',
      "",
      "IMPORTANT: When the user says a specific time like \"at 1:30\", use a cron expression (\"30 1 * * *\") with one_shot=true, NOT \"in Xm\".",
      "Always set the timezone parameter to the user's timezone from PERSONA.md.",
      "",
      "Examples:",
      '  { action: "add", name: "Morning brief", schedule: "0 7 * * *", message: "Summarize what happened overnight.", timezone: "Europe/Amsterdam" }',
      '  { action: "add", name: "Check at 1:30", schedule: "30 1 * * *", message: "Do the check.", timezone: "Europe/Amsterdam", one_shot: true }',
      '  { action: "add", name: "Reminder", schedule: "in 30m", message: "Remind user about the meeting.", one_shot: true }',
      '  { action: "list" }',
      '  { action: "remove", job_id: "cron_abc123" }',
    ].join("\n"),
    parameters: {
      action: {
        type: "string",
        description: 'One of: "add", "remove", "list", "toggle"',
        required: true,
        enum: ["add", "remove", "list", "toggle"],
      },
      name: {
        type: "string",
        description: "Job name (for add)",
      },
      schedule: {
        type: "string",
        description: 'Cron expression or relative time like "in 20m" (for add)',
      },
      message: {
        type: "string",
        description: "Message/prompt sent to you when the job fires (for add)",
      },
      timezone: {
        type: "string",
        description: 'IANA timezone like "Europe/Amsterdam" (for add, optional)',
      },
      one_shot: {
        type: "boolean",
        description: "If true, job is deleted after running once (for add)",
      },
      job_id: {
        type: "string",
        description: "Job ID (for remove/toggle)",
      },
      enabled: {
        type: "boolean",
        description: "Enable or disable (for toggle)",
      },
    },
    requiredParams: ["action"],
    handler: async (params): Promise<ToolResult> => {
      const action = params.action as string;

      try {
        switch (action) {
          case "add":
            return handleAdd(scheduler, params);
          case "remove":
            return handleRemove(scheduler, params);
          case "list":
            return handleList(scheduler);
          case "toggle":
            return handleToggle(scheduler, params);
          default:
            return { toolCallId: "", output: `Unknown action: ${action}. Use add, remove, list, or toggle.`, isError: true };
        }
      } catch (err) {
        log.error({ err, action }, "Cron tool error");
        return { toolCallId: "", output: `Cron error: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

// ─── Action handlers ────────────────────────────────────────────

function handleAdd(scheduler: Scheduler, params: Record<string, unknown>): ToolResult {
  const name = params.name as string;
  const schedule = params.schedule as string;
  const message = params.message as string;

  if (!name || !schedule || !message) {
    return { toolCallId: "", output: "Missing required fields: name, schedule, message", isError: true };
  }

  // Handle relative time ("in 20m", "in 2h", "in 1d")
  let resolvedSchedule = schedule;
  let oneShot = (params.one_shot as boolean) || false;

  const relativeMatch = schedule.match(/^in\s+(\d+)\s*(m|min|h|hr|hour|d|day)s?$/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    const ms =
      unit.startsWith("m") ? amount * 60_000 :
      unit.startsWith("h") ? amount * 3_600_000 :
      amount * 86_400_000;

    const fireAt = new Date(Date.now() + ms);
    resolvedSchedule = fireAt.toISOString();
    oneShot = true; // relative times are always one-shot
  }

  const job = scheduler.addJob({
    name,
    schedule: resolvedSchedule,
    message,
    timezone: params.timezone as string | undefined,
    oneShot,
  });

  return {
    toolCallId: "",
    output: [
      `Job created:`,
      `  ID: ${job.id}`,
      `  Name: ${job.name}`,
      `  Schedule: ${job.schedule}`,
      `  One-shot: ${job.oneShot ? "yes" : "no"}`,
      `  Timezone: ${job.timezone || "system default"}`,
    ].join("\n"),
  };
}

function handleRemove(scheduler: Scheduler, params: Record<string, unknown>): ToolResult {
  const jobId = params.job_id as string;
  if (!jobId) {
    return { toolCallId: "", output: "Missing job_id", isError: true };
  }

  const removed = scheduler.removeJob(jobId);
  if (!removed) {
    return { toolCallId: "", output: `Job not found: ${jobId}`, isError: true };
  }

  return { toolCallId: "", output: `Job ${jobId} removed.` };
}

function handleList(scheduler: Scheduler): ToolResult {
  const jobs = scheduler.listJobs();
  if (jobs.length === 0) {
    return { toolCallId: "", output: "No scheduled jobs." };
  }

  const lines = jobs.map((j) => {
    const status = j.enabled ? "ACTIVE" : "PAUSED";
    const lastRun = j.lastRunAt ? new Date(j.lastRunAt).toISOString() : "never";
    return [
      `[${status}] ${j.name} (${j.id})`,
      `  Schedule: ${j.schedule}${j.oneShot ? " (one-shot)" : ""}`,
      `  Timezone: ${j.timezone || "system default"}`,
      `  Message: ${j.message.slice(0, 80)}${j.message.length > 80 ? "..." : ""}`,
      `  Runs: ${j.runCount} | Last: ${lastRun}`,
    ].join("\n");
  });

  return { toolCallId: "", output: lines.join("\n\n") };
}

function handleToggle(scheduler: Scheduler, params: Record<string, unknown>): ToolResult {
  const jobId = params.job_id as string;
  const enabled = params.enabled as boolean;

  if (!jobId || enabled === undefined) {
    return { toolCallId: "", output: "Missing job_id or enabled", isError: true };
  }

  const toggled = scheduler.toggleJob(jobId, enabled);
  if (!toggled) {
    return { toolCallId: "", output: `Job not found: ${jobId}`, isError: true };
  }

  return { toolCallId: "", output: `Job ${jobId} ${enabled ? "enabled" : "disabled"}.` };
}
