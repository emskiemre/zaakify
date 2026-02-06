/**
 * Port Utilities — kill existing processes on a port for clean restarts.
 */

import { getLogger } from "../utils/logger.js";

const log = getLogger("port-utils");

/**
 * Kill any existing process on the target port so we can take over.
 * This lets `npm run dev -- gateway` restart cleanly without EADDRINUSE.
 */
export async function killExistingOnPort(host: string, port: number): Promise<void> {
  try {
    const net = await import("node:net");
    const inUse = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection({ host, port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on("error", () => resolve(false));
      sock.setTimeout(1000, () => { sock.destroy(); resolve(false); });
    });

    if (!inUse) return;

    log.info({ host, port }, "Port in use, killing existing process...");

    if (process.platform === "win32") {
      const { execSync } = await import("node:child_process");
      const output = execSync(`netstat -ano | findstr ":${port}"`, { encoding: "utf-8" }).trim();
      const pids = new Set(
        output.split("\n")
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((pid) => pid && /^\d+$/.test(pid)),
      );
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
          log.info({ pid }, "Killed existing gateway process");
        } catch { /* Process may have already exited */ }
      }
    } else {
      const { execSync } = await import("node:child_process");
      try {
        const output = execSync(`lsof -ti :${port}`, { encoding: "utf-8" }).trim();
        if (output) {
          execSync(`kill -9 ${output}`, { stdio: "ignore" });
          log.info({ pids: output }, "Killed existing gateway process");
        }
      } catch { /* No process on port or lsof not available */ }
    }

    await new Promise((r) => setTimeout(r, 500));
  } catch (err) {
    log.debug({ err }, "Port check failed, proceeding anyway");
  }
}
