/**
 * Job Store — persistence for cron jobs.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getLogger } from "../utils/logger.js";

const log = getLogger("job-store");

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  message: string;
  agentId?: string;
  timezone?: string;
  oneShot?: boolean;
  enabled: boolean;
  createdAt: number;
  lastRunAt: number;
  runCount: number;
}

export interface JobStoreData {
  jobs: CronJob[];
}

/**
 * Load jobs from a JSON file on disk.
 */
export function loadJobs(storePath: string): CronJob[] {
  if (!existsSync(storePath)) {
    return [];
  }

  try {
    const raw = readFileSync(storePath, "utf-8");
    const store: JobStoreData = JSON.parse(raw);
    log.info({ loaded: store.jobs?.length || 0 }, "Job store loaded");
    return store.jobs || [];
  } catch (err) {
    log.error({ err }, "Failed to load job store, starting fresh");
    return [];
  }
}

/**
 * Save jobs to a JSON file on disk.
 */
export function saveJobs(storePath: string, jobs: CronJob[]): void {
  try {
    const dir = dirname(storePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const store: JobStoreData = { jobs };
    writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    log.error({ err }, "Failed to save job store");
  }
}
