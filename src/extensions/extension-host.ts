/**
 * Zaakify Extension Host
 *
 * Lazy-load extension system. Extensions are discovered on boot but
 * NOT started — the agent decides when to start/stop them via the
 * Extension tool.
 *
 * Each extension:
 *   - Lives in its own directory: ~/.zaakify/extensions/<name>/
 *   - Has an index.mjs entry point
 *   - Can optionally have a package.json with npm dependencies
 *   - Runs in its own child process (crash isolation)
 *
 * Extension format:
 *   export default { name, description, activate(sdk) }
 *
 * Agent actions: list, info, start, stop, restart, install, uninstall, remove
 */

import { fork, type ChildProcess, execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { ToolId as makeToolId } from "../types/index.js";
import { getEventBus, createEvent } from "../kernel/event-bus.js";
import { getLogger } from "../utils/logger.js";
import { EXTENSIONS_DIR } from "../paths.js";

const log = getLogger("extensions");

// ─── Types ──────────────────────────────────────────────────────

interface ExtensionToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface ExtensionEntry {
  name: string;
  description: string;
  tools: ExtensionToolInfo[];
  dirPath: string;
  entryPath: string;
  process: ChildProcess | null;
  status: "discovered" | "starting" | "running" | "stopped" | "crashed" | "installing";
  lastError: string;
  hasDependencies: boolean;
}

interface IPCReadyMessage {
  type: "ready";
  tools: ExtensionToolInfo[];
}

interface IPCResultMessage {
  type: "result";
  id: number;
  output: string;
  isError?: boolean;
}

interface IPCErrorMessage {
  type: "error";
  message: string;
}

interface IPCRegisterToolMessage {
  type: "register_tool";
  tool: ExtensionToolInfo;
}

interface IPCEmitEventMessage {
  type: "emit_event";
  eventType: string;
  payload: unknown;
}

type IPCMessage =
  | IPCReadyMessage
  | IPCResultMessage
  | IPCErrorMessage
  | IPCRegisterToolMessage
  | IPCEmitEventMessage;

// ─── Extension Host ─────────────────────────────────────────────

export class ExtensionHost {
  private extensions: Map<string, ExtensionEntry> = new Map();
  private pendingCalls: Map<
    number,
    { resolve: (v: ToolResult) => void; timer: ReturnType<typeof setTimeout> }
  > = new Map();
  private callId = 0;
  private extensionsDir: string;
  private runnerPath: string;
  private registry: {
    register: (tool: ToolDefinition) => void;
    unregister: (name: string) => boolean;
  };

  constructor(
    _workspace: string,
    registry: {
      register: (tool: ToolDefinition) => void;
      unregister: (name: string) => boolean;
    },
  ) {
    this.extensionsDir = EXTENSIONS_DIR;
    this.registry = registry;

    // Runner lives alongside this file as plain .js
    this.runnerPath = resolve(
      import.meta.dirname || ".",
      "extension-runner.js",
    );
  }

  // ─── Discovery (no processes started) ───────────────────────────

  /**
   * Scan the extensions directory and register metadata.
   * Does NOT start any processes — the agent decides when to start.
   */
  discoverAll(): void {
    if (!existsSync(this.extensionsDir)) {
      mkdirSync(this.extensionsDir, { recursive: true });
      log.info({ dir: this.extensionsDir }, "Created extensions directory");
    }

    const entries = readdirSync(this.extensionsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());

    // Track which extensions are on disk
    const onDisk = new Set<string>();

    for (const dir of dirs) {
      const dirPath = join(this.extensionsDir, dir.name);
      const entryPath = join(dirPath, "index.mjs");

      if (!existsSync(entryPath)) {
        log.warn({ name: dir.name }, "Extension has no index.mjs, skipping");
        continue;
      }

      onDisk.add(dir.name);

      // Skip if already known (running or otherwise)
      if (this.extensions.has(dir.name)) continue;

      const pkgPath = join(dirPath, "package.json");
      const hasDeps = existsSync(pkgPath);

      const ext: ExtensionEntry = {
        name: dir.name,
        description: "",
        tools: [],
        dirPath,
        entryPath,
        process: null,
        status: "discovered",
        lastError: "",
        hasDependencies: hasDeps,
      };

      this.extensions.set(dir.name, ext);
    }

    // Remove entries that no longer exist on disk (and aren't running)
    for (const [name, ext] of this.extensions) {
      if (!onDisk.has(name) && ext.status !== "running") {
        this.extensions.delete(name);
      }
    }

    const discovered = [...this.extensions.values()].filter(e => e.status === "discovered").length;
    const running = [...this.extensions.values()].filter(e => e.status === "running").length;
    log.info({ total: this.extensions.size, discovered, running }, "Extensions discovered");
  }

  // ─── Start / Stop / Restart ─────────────────────────────────────

  /**
   * Start an extension: install deps if needed, fork process, register tools.
   */
  async startExtension(name: string): Promise<{ ok: boolean; message: string }> {
    let ext = this.extensions.get(name);
    if (!ext) {
      // Try discovery in case it was just added
      this.discoverAll();
      ext = this.extensions.get(name);
    }
    if (!ext) {
      return { ok: false, message: `Extension "${name}" not found.` };
    }

    if (ext.status === "running") {
      return { ok: true, message: `Extension "${name}" is already running.` };
    }

    // Check if another extension is already running — only one at a time
    const running = Array.from(this.extensions.values())
      .filter((e) => e.status === "running" && e.name !== name);
    if (running.length > 0) {
      const names = running.map((e) => e.name).join(", ");
      return {
        ok: false,
        message: `Cannot start "${name}" — only one extension can run at a time, and "${names}" is still running. Stop it first with Extension({ action: "stop", name: "${running[0].name}" }), then try again.`,
      };
    }

    // Install npm dependencies if needed
    if (ext.hasDependencies) {
      const nodeModules = join(ext.dirPath, "node_modules");
      if (!existsSync(nodeModules)) {
        ext.status = "installing";
        log.info({ name }, "Installing extension dependencies...");
        try {
          execSync("npm install --production --no-audit --no-fund", {
            cwd: ext.dirPath,
            encoding: "utf-8",
            timeout: 600_000, // 10 minutes for large dependencies (e.g., Playwright)
            stdio: "pipe",
          });
          log.info({ name }, "Dependencies installed");
        } catch (err) {
          const msg = (err as { stderr?: string }).stderr || (err as Error).message;
          ext.status = "crashed";
          ext.lastError = `npm install failed: ${msg.slice(0, 500)}`;
          log.error({ name, error: ext.lastError }, "npm install failed");
          return { ok: false, message: ext.lastError };
        }
      }
    }

    // Fork the child process
    await this.forkProcess(ext);

    if ((ext.status as string) === "running") {
      for (const tool of ext.tools) {
        this.registerToolProxy(ext, tool);
      }
      log.info(
        { name, tools: ext.tools.map((t) => t.name) },
        "Extension started",
      );

      // Load GUIDANCE.md if it exists — inject usage tips into the response
      let guidance = "";
      const guidancePath = join(ext.dirPath, "GUIDANCE.md");
      if (existsSync(guidancePath)) {
        try {
          const content = readFileSync(guidancePath, "utf-8").trim();
          if (content) {
            guidance = `\n\n--- Extension Guidance ---\n${content}`;
          }
        } catch { /* skip unreadable */ }
      }

      return {
        ok: true,
        message: `Extension "${name}" started with ${ext.tools.length} tool(s): ${ext.tools.map(t => t.name).join(", ") || "none"}${guidance}`,
      };
    } else {
      return {
        ok: false,
        message: `Extension "${name}" failed to start: ${ext.lastError}`,
      };
    }
  }

  /**
   * Stop an extension: kill process, unregister tools. Keeps files.
   */
  stopExtension(name: string): { ok: boolean; message: string } {
    const ext = this.extensions.get(name);
    if (!ext) {
      return { ok: false, message: `Extension "${name}" not found.` };
    }

    const status = ext.status as string;
    if (status !== "running" && status !== "starting") {
      return { ok: true, message: `Extension "${name}" is not running.` };
    }

    // Kill process
    if (ext.process) {
      try { ext.process.kill("SIGTERM"); } catch {}
      ext.process = null;
    }

    // Unregister all tools
    for (const tool of ext.tools) {
      this.registry.unregister(tool.name);
    }

    ext.status = "stopped";
    ext.tools = [];
    ext.lastError = "";
    log.info({ name }, "Extension stopped");

    return { ok: true, message: `Extension "${name}" stopped.` };
  }

  /**
   * Restart an extension: stop + start (re-reads config).
   */
  async restartExtension(name: string): Promise<{ ok: boolean; message: string }> {
    const ext = this.extensions.get(name);
    if (!ext) {
      return { ok: false, message: `Extension "${name}" not found.` };
    }

    log.info({ name }, "Restarting extension...");
    this.stopExtension(name);
    return this.startExtension(name);
  }

  // ─── Process Management ─────────────────────────────────────────

  /**
   * Fork the child process and wait for the "ready" message.
   * No auto-restart — the agent decides when to start again.
   */
  private forkProcess(ext: ExtensionEntry): Promise<void> {
    return new Promise((resolveStart) => {
      ext.status = "starting";
      ext.tools = [];
      ext.lastError = "";

      const child = fork(this.runnerPath, [ext.entryPath], {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        cwd: ext.dirPath,
        env: { ...process.env },
      });

      ext.process = child;

      let resolved = false;
      const stderrChunks: string[] = [];

      const readyTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          ext.status = "crashed";
          ext.lastError = `Timed out during startup (10s). stderr: ${stderrChunks.join("").slice(0, 500)}`;
          log.error({ name: ext.name, stderr: stderrChunks.join("") }, "Extension timed out");
          try { child.kill("SIGKILL"); } catch {}
          resolveStart();
        }
      }, 10_000);

      child.on("message", (msg: IPCMessage) => {
        if (msg.type === "ready" && !resolved) {
          resolved = true;
          clearTimeout(readyTimeout);
          const ready = msg as IPCReadyMessage;
          ext.tools = ready.tools;
          if (ready.tools.length > 0) {
            ext.description = ready.tools[0].description;
          }
          ext.status = "running";
          ext.lastError = "";
          resolveStart();
        } else if (msg.type === "result") {
          this.handleResult(msg as IPCResultMessage);
        } else if (msg.type === "register_tool") {
          const regMsg = msg as IPCRegisterToolMessage;
          ext.tools.push(regMsg.tool);
          this.registerToolProxy(ext, regMsg.tool);
          log.info({ ext: ext.name, tool: regMsg.tool.name }, "Extension registered tool");
        } else if (msg.type === "emit_event") {
          const evMsg = msg as IPCEmitEventMessage;
          const bus = getEventBus();
          bus.emit(
            createEvent(
              evMsg.eventType as never,
              evMsg.payload,
              `ext:${ext.name}`,
            ),
          );
        } else if (msg.type === "error" && !resolved) {
          resolved = true;
          clearTimeout(readyTimeout);
          ext.status = "crashed";
          ext.lastError = (msg as IPCErrorMessage).message;
          log.error({ name: ext.name, error: ext.lastError }, "Extension failed to load");
          resolveStart();
        }
      });

      child.stdout?.on("data", (data: Buffer) => {
        log.info({ ext: ext.name }, `[ext] ${data.toString().trim()}`);
      });

      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        stderrChunks.push(text);
        log.warn({ ext: ext.name }, `[ext:err] ${text}`);
      });

      child.on("exit", (code, signal) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(readyTimeout);
          ext.status = "crashed";
          ext.lastError = `Process exited with code ${code}, signal ${signal}. stderr: ${stderrChunks.join("").slice(0, 500)}`;
          resolveStart();
        }

        // Mark as crashed, no auto-restart
        if (ext.status === "running") {
          ext.status = "crashed";
          ext.lastError = `Process exited unexpectedly (code ${code}, signal ${signal})`;
          log.error({ name: ext.name, code, signal }, "Extension process exited");

          // Fail all pending calls for this extension
          for (const [id, pending] of this.pendingCalls) {
            pending.resolve({
              toolCallId: "",
              output: `Extension "${ext.name}" process crashed`,
              isError: true,
            });
            clearTimeout(pending.timer);
            this.pendingCalls.delete(id);
          }

          // Unregister tools since process is dead
          for (const tool of ext.tools) {
            this.registry.unregister(tool.name);
          }
        }
      });
    });
  }

  /**
   * Handle a result message from a child process.
   */
  private handleResult(msg: IPCResultMessage): void {
    const pending = this.pendingCalls.get(msg.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingCalls.delete(msg.id);
      pending.resolve({
        toolCallId: "",
        output: msg.output,
        isError: msg.isError,
      });
    }
  }

  /**
   * Register a proxy ToolDefinition that forwards calls to the child process.
   */
  private registerToolProxy(
    ext: ExtensionEntry,
    toolInfo: ExtensionToolInfo,
  ): void {
    const self = this;
    const tool: ToolDefinition = {
      id: makeToolId(toolInfo.name),
      name: toolInfo.name,
      description: `[Extension: ${ext.name}] ${toolInfo.description}`,
      parameters: toolInfo.parameters as ToolDefinition["parameters"],
      requiredParams: Object.entries(toolInfo.parameters)
        .filter(([_, v]) => (v as Record<string, unknown>).required)
        .map(([k]) => k),
      handler: async (params): Promise<ToolResult> => {
        if (!ext.process || ext.status !== "running") {
          return {
            toolCallId: "",
            output: `Extension "${ext.name}" is not running (status: ${ext.status}). Use Extension({ action: "start", name: "${ext.name}" }) to start it.`,
            isError: true,
          };
        }

        const id = ++self.callId;

        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            self.pendingCalls.delete(id);
            resolve({
              toolCallId: "",
              output: `Extension tool "${toolInfo.name}" timed out (30s)`,
              isError: true,
            });
          }, 30_000);

          self.pendingCalls.set(id, { resolve, timer });
          ext.process!.send({
            type: "execute",
            id,
            toolName: toolInfo.name,
            params,
          });
        });
      },
    };

    this.registry.register(tool);
  }

  // ─── Extension Management ───────────────────────────────────────

  /**
   * Remove an extension. Stops process, deletes all files.
   */
  removeExtension(name: string): { ok: boolean; message: string } {
    const ext = this.extensions.get(name);
    if (!ext) {
      return { ok: false, message: `Extension "${name}" not found.` };
    }

    // Stop if running
    if (ext.status === "running" || ext.status === "starting") {
      this.stopExtension(name);
    }

    // Delete directory
    if (existsSync(ext.dirPath)) {
      rmSync(ext.dirPath, { recursive: true, force: true });
    }

    this.extensions.delete(name);
    log.info({ name }, "Extension removed");

    return { ok: true, message: `Extension "${name}" removed.` };
  }

  /**
   * List all extensions with their status.
   * Re-scans the directory to pick up newly added extensions.
   */
  listExtensions(): Array<{
    name: string;
    description: string;
    status: string;
    tools: string[];
    hasDependencies: boolean;
    dirPath: string;
  }> {
    // Re-scan to pick up new extensions
    this.discoverAll();

    const result: Array<{
      name: string;
      description: string;
      status: string;
      tools: string[];
      hasDependencies: boolean;
      dirPath: string;
    }> = [];

    for (const [name, ext] of this.extensions) {
      result.push({
        name,
        description: ext.description,
        status: ext.status,
        tools: ext.tools.map((t) => t.name),
        hasDependencies: ext.hasDependencies,
        dirPath: ext.dirPath,
      });
    }

    return result;
  }

  /**
   * Get detailed info about an extension.
   */
  getExtensionInfo(name: string): {
    ok: boolean;
    info?: {
      name: string;
      description: string;
      status: string;
      tools: Array<{ name: string; description: string }>;
      hasDependencies: boolean;
      dependenciesInstalled: boolean;
      packageJson?: Record<string, unknown>;
      configured: boolean;
      lastError: string;
      dirPath: string;
      configPath: string;
      readmePath: string;
      schemaPath: string;
    };
    message?: string;
  } {
    const ext = this.extensions.get(name);
    if (!ext) {
      return { ok: false, message: `Extension "${name}" not found.` };
    }

    const dirPath = ext.dirPath;
    const configPath = join(dirPath, "config.json");
    const readmePath = join(dirPath, "README.md");
    const schemaPath = join(dirPath, "SCHEMA.json");
    const pkgPath = join(dirPath, "package.json");
    const nodeModulesPath = join(dirPath, "node_modules");

    let packageJson: Record<string, unknown> | undefined;
    let configured = false;

    if (existsSync(pkgPath)) {
      try {
        packageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
      } catch {}
    }

    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        configured = config.configured !== false;
      } catch {}
    }

    return {
      ok: true,
      info: {
        name: ext.name,
        description: ext.description,
        status: ext.status,
        tools: ext.tools.map(t => ({
          name: t.name,
          description: t.description,
        })),
        hasDependencies: ext.hasDependencies,
        dependenciesInstalled: existsSync(nodeModulesPath),
        packageJson,
        configured,
        lastError: ext.lastError,
        dirPath,
        configPath: existsSync(configPath) ? configPath : "",
        readmePath: existsSync(readmePath) ? readmePath : "",
        schemaPath: existsSync(schemaPath) ? schemaPath : "",
      },
    };
  }

  /**
   * Install dependencies for an extension.
   */
  async installDependencies(name: string): Promise<{ ok: boolean; message: string }> {
    const ext = this.extensions.get(name);
    if (!ext) {
      return { ok: false, message: `Extension "${name}" not found.` };
    }

    const pkgPath = join(ext.dirPath, "package.json");
    if (!existsSync(pkgPath)) {
      return {
        ok: false,
        message: `Extension "${name}" has no package.json.`,
      };
    }

    const nodeModules = join(ext.dirPath, "node_modules");
    if (existsSync(nodeModules)) {
      return {
        ok: true,
        message: `Extension "${name}" dependencies are already installed.`,
      };
    }

    log.info({ name }, "Installing extension dependencies...");

    try {
      const output = execSync("npm install --production --no-audit --no-fund", {
        cwd: ext.dirPath,
        encoding: "utf-8",
        timeout: 600_000, // 10 minutes for large dependencies (e.g., Playwright)
        stdio: "pipe",
      });

      log.info({ name }, "Dependencies installed successfully");
      return {
        ok: true,
        message: `Dependencies installed for extension "${name}". ${output.trim().slice(-200)}`,
      };
    } catch (err) {
      const msg = (err as { stderr?: string }).stderr || (err as Error).message;
      log.error({ name, error: msg }, "npm install failed");
      return {
        ok: false,
        message: `Failed to install dependencies for "${name}": ${msg.slice(0, 500)}`,
      };
    }
  }

  /**
   * Uninstall dependencies for an extension (remove node_modules).
   */
  uninstallDependencies(name: string): { ok: boolean; message: string } {
    const ext = this.extensions.get(name);
    if (!ext) {
      return { ok: false, message: `Extension "${name}" not found.` };
    }

    const nodeModules = join(ext.dirPath, "node_modules");
    if (!existsSync(nodeModules)) {
      return {
        ok: true,
        message: `Extension "${name}" has no dependencies installed.`,
      };
    }

    try {
      rmSync(nodeModules, { recursive: true, force: true });
      log.info({ name }, "Dependencies uninstalled");
      return {
        ok: true,
        message: `Dependencies removed for extension "${name}".`,
      };
    } catch (err) {
      log.error({ name, err }, "Failed to uninstall dependencies");
      return {
        ok: false,
        message: `Failed to remove dependencies: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Stop all extension processes (used during shutdown).
   */
  async stopAll(): Promise<void> {
    const killPromises: Promise<void>[] = [];
    
    for (const [_, ext] of this.extensions) {
      if (ext.process) {
        const killPromise = new Promise<void>((resolve) => {
          try { 
            ext.process!.kill("SIGTERM"); 
          } catch {}
          
          const proc = ext.process!;
          const timer = setTimeout(() => {
            try { 
              if (!proc.killed) {
                proc.kill("SIGKILL"); 
              }
            } catch {}
            resolve();
          }, 2000); // Reduced from 5s to 2s
          
          // If process exits early, resolve immediately
          proc.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        killPromises.push(killPromise);
      }
    }
    
    // Wait for all extension processes to be killed (max 2s each)
    await Promise.all(killPromises);
    this.extensions.clear();
    log.info("All extensions stopped");
  }
}

// Re-export createExtensionTool from its dedicated module
export { createExtensionTool } from "./extension-tool.js";
