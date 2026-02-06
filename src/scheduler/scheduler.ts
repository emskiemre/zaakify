/**
 * Zaakify Scheduler
 *
 * Lightweight cron system — one file, does everything.
 *
 * Jobs are stored as JSON in the workspace (agent can inspect them).
 * Execution sends a message through the event bus as if a user sent it,
 * reusing the entire agent pipeline. No separate runner, no RPC, no Ajv.
 *
 * OpenClaw does this in 27 files. We do it in one.
 */

import { Cron } from "croner";
import { getEventBus, createEvent } from "../kernel/event-bus.js";
import { genCorrelationId, genMessageId } from "../utils/ids.js";
import { ChannelId, UserId } from "../types/index.js";
import type { InboundMessage, AgentId } from "../types/index.js";
import { getLogger } from "../utils/logger.js";
import { CRON_FILE } from "../paths.js";
import { type CronJob, loadJobs, saveJobs } from "./job-store.js";

// Re-export CronJob so existing imports from scheduler.ts still work
export type { CronJob } from "./job-store.js";

const log = getLogger("scheduler");

// ─── Scheduler ──────────────────────────────────────────────────

export class Scheduler {
  private storePath: string;
  private jobs: CronJob[] = [];
  private timers: Map<string, Cron> = new Map();
  private defaultAgentId: string;

  constructor(_workspace: string, defaultAgentId = "default") {
    this.storePath = CRON_FILE;
    this.defaultAgentId = defaultAgentId;
  }

  /**
   * Load jobs from disk and arm all enabled timers.
   */
  start(): void {
    this.jobs = loadJobs(this.storePath);
    log.info({ jobCount: this.jobs.length, storePath: this.storePath }, "Scheduler started");

    for (const job of this.jobs) {
      if (job.enabled) {
        this.arm(job);
      }
    }

    const armed = this.timers.size;
    if (armed > 0) {
      log.info({ armed }, "Cron jobs armed");
    }
  }

  /**
   * Stop all timers.
   */
  stop(): void {
    for (const [id, cron] of this.timers) {
      cron.stop();
      this.timers.delete(id);
    }
    log.info("Scheduler stopped");
  }

  /**
   * Add a new job. Returns the created job.
   */
  addJob(params: {
    name: string;
    schedule: string;
    message: string;
    agentId?: string;
    timezone?: string;
    oneShot?: boolean;
  }): CronJob {
    const job: CronJob = {
      id: `cron_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: params.name,
      schedule: params.schedule,
      message: params.message,
      agentId: params.agentId || this.defaultAgentId,
      timezone: params.timezone,
      oneShot: params.oneShot || false,
      enabled: true,
      createdAt: Date.now(),
      lastRunAt: 0,
      runCount: 0,
    };

    this.jobs.push(job);
    saveJobs(this.storePath, this.jobs);
    this.arm(job);

    log.info({ jobId: job.id, name: job.name, schedule: job.schedule }, "Job added");
    return job;
  }

  /**
   * Remove a job by ID.
   */
  removeJob(jobId: string): boolean {
    const idx = this.jobs.findIndex((j) => j.id === jobId);
    if (idx === -1) return false;

    const job = this.jobs[idx];
    this.disarm(job.id);
    this.jobs.splice(idx, 1);
    saveJobs(this.storePath, this.jobs);

    log.info({ jobId, name: job.name }, "Job removed");
    return true;
  }

  /**
   * Enable or disable a job.
   */
  toggleJob(jobId: string, enabled: boolean): boolean {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return false;

    job.enabled = enabled;
    if (enabled) {
      this.arm(job);
    } else {
      this.disarm(jobId);
    }
    saveJobs(this.storePath, this.jobs);

    log.info({ jobId, name: job.name, enabled }, "Job toggled");
    return true;
  }

  /**
   * List all jobs.
   */
  listJobs(): CronJob[] {
    return [...this.jobs];
  }

  /**
   * Get a specific job by ID.
   */
  getJob(jobId: string): CronJob | undefined {
    return this.jobs.find((j) => j.id === jobId);
  }

  // ─── Internal ───────────────────────────────────────────────

  /**
   * Arm a cron timer for a job.
   */
  private arm(job: CronJob): void {
    // Disarm existing timer if any
    this.disarm(job.id);

    try {
      const cron = new Cron(job.schedule, {
        timezone: job.timezone,
        paused: false,
      }, () => {
        this.fire(job);
      });

      this.timers.set(job.id, cron);

      const next = cron.nextRun();
      log.info({ jobId: job.id, name: job.name, nextRun: next?.toISOString() }, "Job armed");
    } catch (err) {
      log.error({ err, jobId: job.id, schedule: job.schedule }, "Failed to arm job — invalid schedule?");
    }
  }

  /**
   * Disarm (cancel) a timer.
   */
  private disarm(jobId: string): void {
    const timer = this.timers.get(jobId);
    if (timer) {
      timer.stop();
      this.timers.delete(jobId);
    }
  }

  /**
   * Fire a job — send its message through the event bus as if a user sent it.
   */
  private fire(job: CronJob): void {
    log.info({ jobId: job.id, name: job.name }, "Firing cron job");

    const bus = getEventBus();
    const correlationId = genCorrelationId();

    const message: InboundMessage = {
      id: genMessageId(),
      sessionId: "" as never,
      channelType: "webchat",
      channelId: ChannelId(`cron:${job.id}`),
      user: {
        id: UserId("cron:scheduler"),
        displayName: `Cron: ${job.name}`,
        channelType: "webchat",
        channelSpecificId: `cron:${job.id}`,
      },
      content: `[Scheduled task: ${job.name}]\n\n${job.message}`,
      attachments: [],
      timestamp: Date.now(),
    };

    bus.emit(
      createEvent(
        "message:inbound",
        {
          message,
          agentId: (job.agentId || this.defaultAgentId) as AgentId,
        },
        "scheduler",
        correlationId,
      ),
    );

    // Update job stats
    job.lastRunAt = Date.now();
    job.runCount++;

    // One-shot: remove after firing
    if (job.oneShot) {
      log.info({ jobId: job.id, name: job.name }, "One-shot job completed, removing");
      this.removeJob(job.id);
    } else {
      saveJobs(this.storePath, this.jobs);
    }
  }
}
