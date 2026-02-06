/**
 * Zaakify Logger
 *
 * Structured logging via pino. Every module gets a child logger
 * with its own name for easy filtering in production.
 *
 * Logs go to:
 *   - stdout (pretty-printed if configured)
 *   - ~/.zaakify/logs/zaakify.log (JSON, always)
 *
 * Log rotation: on startup, if log file exceeds 10MB, it's rotated
 * to zaakify.log.1 (keeping only 1 backup).
 */

import pino from "pino";
import { existsSync, mkdirSync, statSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { LogConfig } from "../types/index.js";
import { LOG_FILE } from "../paths.js";

let rootLogger: pino.Logger | null = null;

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const BACKUP_LOG_FILE = `${LOG_FILE}.1`;

function ensureLogDir(): void {
  const logDir = dirname(LOG_FILE);
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Rotate log file if it exceeds MAX_LOG_SIZE.
 * Keeps only 1 backup (zaakify.log.1).
 */
function rotateLogIfNeeded(): void {
  try {
    if (!existsSync(LOG_FILE)) return;
    
    const stats = statSync(LOG_FILE);
    if (stats.size < MAX_LOG_SIZE) return;
    
    // Delete old backup if exists
    if (existsSync(BACKUP_LOG_FILE)) {
      unlinkSync(BACKUP_LOG_FILE);
    }
    
    // Rotate current log to backup
    renameSync(LOG_FILE, BACKUP_LOG_FILE);
  } catch {
    // Ignore rotation errors - logging should still work
  }
}

export function initLogger(config: LogConfig): pino.Logger {
  ensureLogDir();
  rotateLogIfNeeded();

  // Multi-transport: pretty stdout + JSON file
  rootLogger = pino({
    level: config.level,
    transport: {
      targets: [
        // Always log JSON to file
        {
          target: "pino/file",
          level: config.level,
          options: { destination: config.file || LOG_FILE, mkdir: true },
        },
        // Pretty stdout if configured
        ...(config.pretty
          ? [
              {
                target: "pino-pretty" as const,
                level: config.level,
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: "SYS:HH:MM:ss",
                  ignore: "pid,hostname,module",
                  messageFormat: "[{module}] {msg}",
                },
              },
            ]
          : [
              {
                target: "pino/file" as const,
                level: config.level,
                options: { destination: 1 }, // fd 1 = stdout, raw JSON
              },
            ]),
      ],
    },
  });

  return rootLogger;
}

export function getLogger(name: string): pino.Logger {
  if (!rootLogger) {
    // Fallback if called before init (e.g., during import-time)
    ensureLogDir();
    rootLogger = pino({
      level: "info",
      transport: {
        targets: [
          {
            target: "pino/file",
            level: "info",
            options: { destination: LOG_FILE, mkdir: true },
          },
          {
            target: "pino-pretty",
            level: "info",
            options: { colorize: true, singleLine: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname,module", messageFormat: "[{module}] {msg}" },
          },
        ],
      },
    });
  }
  return rootLogger.child({ module: name });
}

export { LOG_FILE };
