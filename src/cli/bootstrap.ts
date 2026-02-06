/**
 * Zaakify Bootstrap
 *
 * Wires everything together. This is the only file that knows about
 * all modules. Each module is independently testable -- bootstrap
 * is just the glue.
 *
 * Startup order:
 *   1. Event bus (kernel)
 *   2. Workspace (ensure + seed templates)
 *   3. Security manager
 *   4. Session manager
 *   5. Tool registry + built-in tools + file tools
 *   6. Scheduler + cron tool
 *   7. Extensions (process-isolated, agent-manageable)
 *   8. Memory store
 *   9. Agent runner (with workspace context injected)
 *  10. Channel adapters + router
 *  11. Gateway server
 */

import type { ZaakifyConfig } from "../types/index.js";
import { getEventBus, createEvent } from "../kernel/event-bus.js";
import { GatewayServer } from "../gateway/server.js";
import { SessionManager } from "../sessions/session-manager.js";
import { ChannelRouter } from "../channels/router.js";
import { DiscordAdapter } from "../channels/discord/adapter.js";
import { TelegramAdapter } from "../channels/telegram/adapter.js";
import { WhatsAppAdapter } from "../channels/whatsapp/adapter.js";
import { AgentRunner } from "../agents/agent-runner.js";
import { ToolRegistry, registerBuiltinTools } from "../tools/registry.js";
import { registerFileTools } from "../tools/file-tools.js";
import { MemoryStore } from "../memory/memory-store.js";
import { SecurityManager } from "../security/security.js";
import { ExtensionHost, createExtensionTool } from "../extensions/extension-host.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { createCronTool } from "../scheduler/cron-tool.js";
import { ensureWorkspace, buildWorkspaceContext, isBootstrapPending, generateExtensionsDoc } from "../workspace/workspace.js";
import { DailyLog } from "../workspace/daily-log.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger("bootstrap");

export interface App {
  gateway: GatewayServer;
  sessions: SessionManager;
  router: ChannelRouter;
  agents: AgentRunner;
  tools: ToolRegistry;
  memory: MemoryStore;
  security: SecurityManager;
  extensions: ExtensionHost;
  scheduler: Scheduler;
  dailyLog: DailyLog;
  workspace: string;
  stop: () => Promise<void>;
}

export async function bootstrap(config: ZaakifyConfig): Promise<App> {
  log.info("Bootstrapping Zaakify...");
  const startTime = Date.now();

  // 1. Event bus is already a singleton -- just ensure it exists
  const bus = getEventBus();

  // 2. Workspace -- ensure directory exists, seed templates on first run
  const workspace = ensureWorkspace();
  const bootstrapPending = isBootstrapPending(workspace);
  log.info({ workspace, bootstrapPending }, "Workspace initialized");

  // Resolve timezone: config value (or auto-detected default from schema)
  const timezone = config.timezone;
  log.info({ timezone }, "Resolved timezone");

  // Build workspace context to inject into agent system prompt
  const ownerName = config.owner.name;
  log.info({ owner: ownerName }, "Owner configured");
  const workspaceContext = buildWorkspaceContext(workspace, timezone, ownerName);

  // Patch agent configs: inject workspace context into system prompt
  const patchedAgents = config.agents.map((agent) => ({
    ...agent,
    // Minimal base prompt + workspace files — no hard-coded personality
    systemPrompt: workspaceContext,
  }));

  // 3. Security manager
  const security = new SecurityManager(config.security);

  // 4. Session manager
  const sessions = new SessionManager();
  sessions.start();

  // 5. Tool registry + built-in tools + file tools
  const tools = new ToolRegistry();
  registerBuiltinTools(tools);
  registerFileTools(tools, workspace);

  // 6. Scheduler + cron tool
  const defaultAgentId = config.agents[0]?.id || "default";
  const scheduler = new Scheduler(workspace, defaultAgentId);
  tools.register(createCronTool(scheduler));
  scheduler.start();

  // 7. Extensions (lazy-load: discover on boot, agent starts on demand)
  const extensions = new ExtensionHost(workspace, tools);
  extensions.discoverAll();
  tools.register(createExtensionTool(extensions, workspace));

  // 7b. Generate EXTENSIONS.md with discovered extensions
  const extensionsList = extensions.listExtensions();
  generateExtensionsDoc(workspace, extensionsList);

  // 8. Memory store
  const memory = new MemoryStore(config.memory);
  memory.init();

  // 9. Agent runner (uses patched configs with workspace context)
  const agents = new AgentRunner(patchedAgents, tools, sessions);
  agents.start();

  // 9b. Daily log — auto-records all conversations to memory/YYYY-MM-DD.md
  const dailyLog = new DailyLog(workspace, timezone);
  dailyLog.start();

  // 10. Channel adapters + router
  const router = new ChannelRouter(config);

  if (config.channels.discord?.enabled) {
    router.registerAdapter(new DiscordAdapter(config.channels.discord));
  }

  if (config.channels.telegram?.enabled) {
    router.registerAdapter(new TelegramAdapter(config.channels.telegram));
  }

  if (config.channels.whatsapp?.enabled) {
    router.registerAdapter(new WhatsAppAdapter(config.channels.whatsapp));
  }

  await router.startAll();

  // 11. Gateway server (pass session stats getter for health endpoint)
  const gateway = new GatewayServer(config, () => sessions.getStats());
  await gateway.start();

  const elapsed = Date.now() - startTime;
  log.info(`Zaakify bootstrapped in ${elapsed}ms`);

  if (bootstrapPending) {
    log.info("BOOTSTRAP.md detected — first-run ritual will begin on first message");
  }

  bus.emit(createEvent("system:startup", { elapsed }, "bootstrap"));

  const app: App = {
    gateway,
    sessions,
    router,
    agents,
    tools,
    memory,
    security,
    extensions,
    scheduler,
    dailyLog,
    workspace,
    stop: async () => {
      log.info("Stopping Zaakify...");
      await gateway.stop();
      await router.stopAll();
      await extensions.stopAll();
      dailyLog.stop();
      scheduler.stop();
      sessions.stop();
      memory.close();
      bus.clear();
      log.info("Zaakify stopped");
    },
  };

  return app;
}
