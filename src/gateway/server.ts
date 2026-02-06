/**
 * Zaakify Gateway Server
 *
 * HTTP + WebSocket server. Serves the web UI, handles WebSocket chat,
 * routes webchat messages to the AI agent, and returns responses.
 *
 * Route handling, WebSocket logic, and port utilities are delegated
 * to focused modules (routes.ts, ws-handler.ts, port-utils.ts).
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { ZaakifyConfig, HealthStatus } from "../types/index.js";
import { getEventBus, createEvent } from "../kernel/event-bus.js";
import { getLogger } from "../utils/logger.js";
import { setupRoutes } from "./routes.js";
import { handleConnection, broadcastToClients, type WsClient } from "./ws-handler.js";
import { killExistingOnPort } from "./port-utils.js";

const log = getLogger("gateway");

export interface SessionStats {
  active: number;
  idle: number;
  archived: number;
  total: number;
}

export class GatewayServer {
  private app: Hono;
  private wss: WebSocketServer | null = null;
  private httpServer: Server | null = null;
  private clients: Map<string, WsClient> = new Map();
  private config: ZaakifyConfig;
  private startTime: number = 0;
  private getSessionStats: () => SessionStats;

  // Cache the UI html on startup so we don't read disk per request
  private uiHtml: string | null = null;

  constructor(config: ZaakifyConfig, getSessionStats?: () => SessionStats) {
    this.config = config;
    this.getSessionStats = getSessionStats || (() => ({ active: 0, idle: 0, archived: 0, total: 0 }));
    this.app = new Hono();
    this.loadUI();
    setupRoutes(
      this.app,
      this.config,
      () => this.uiHtml!,
      () => this.getHealth(),
      () => this.clients.size,
      () => this.startTime,
    );
  }

  /**
   * Find and cache ui/index.html at startup.
   */
  private loadUI(): void {
    // Try multiple locations to find ui/index.html
    const thisDir = resolve(fileURLToPath(import.meta.url), "..");
    const candidates = [
      resolve(process.cwd(), "ui", "index.html"),
      resolve(thisDir, "..", "..", "ui", "index.html"),
      resolve(thisDir, "..", "..", "..", "ui", "index.html"),
    ];

    for (const uiPath of candidates) {
      if (existsSync(uiPath)) {
        this.uiHtml = readFileSync(uiPath, "utf-8");
        log.info({ path: uiPath }, "UI loaded");
        return;
      }
    }

    log.warn({ tried: candidates }, "ui/index.html not found, using fallback");
    this.uiHtml = `<!DOCTYPE html>
<html><head><title>Zaakify</title></head>
<body style="background:#0a0a0f;color:#e4e4ef;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="text-align:center">
    <h1>Zaakify</h1>
    <p style="color:#8888aa">Gateway running. ui/index.html not found.</p>
  </div>
</body></html>`;
  }

  /**
   * Start the HTTP + WebSocket server.
   */
  async start(): Promise<void> {
    const { host, port, wsPath } = this.config.gateway;
    this.startTime = Date.now();

    // Kill any existing gateway on this port
    await killExistingOnPort(host, port);

    // Start HTTP server -- bind fetch to the Hono app instance
    this.httpServer = serve({
      fetch: this.app.fetch.bind(this.app),
      hostname: host,
      port,
    }) as Server;

    // Attach WebSocket server
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: wsPath,
    });

    this.wss.on("connection", (ws, req) => {
      handleConnection(ws, req.url ?? "", this.clients, this.config);
    });

    // Listen for agent responses and send them back to WS clients
    const bus = getEventBus();

    // Stream start — tell the UI a new message is being generated
    bus.on("agent:stream_start", () => {
      broadcastToClients(this.clients, { type: "stream_start", content: "" });
    });

    // Stream deltas — real-time token-by-token text
    bus.on("agent:stream_delta", (event) => {
      const payload = event.payload as { content: string };
      broadcastToClients(this.clients, { type: "stream_delta", content: payload.content });
    });

    // Stream end — the current generation is done (may be intermediate or final)
    bus.on("agent:stream_end", () => {
      broadcastToClients(this.clients, { type: "stream_end", content: "" });
    });

    // Intermediate messages — agent said something before running tools
    // (e.g. "let me check that"). Sent to the UI but doesn't unlock input.
    bus.on("agent:intermediate", (event) => {
      const payload = event.payload as { content: string };
      broadcastToClients(this.clients, { type: "intermediate", content: payload.content });
    });

    // Final response — the complete answer after all tool iterations.
    // This unlocks the input on the frontend.
    bus.on("agent:response", (event) => {
      const payload = event.payload as { content: string; sessionId: string };
      broadcastToClients(this.clients, { type: "message", content: payload.content });
    });

    // Message queued — tell the UI a message is waiting in line
    bus.on("message:queued", (event) => {
      const payload = event.payload as { sessionId: string; queueDepth: number };
      broadcastToClients(this.clients, { type: "queued", content: String(payload.queueDepth) });
    });

    // Agent aborted — tell the UI the request was cancelled
    bus.on("agent:aborted", (event) => {
      const payload = event.payload as { sessionId: string; reason: string };
      broadcastToClients(this.clients, { type: "aborted", content: payload.reason });
    });

    // Note: message:outbound is handled by the ChannelRouter for
    // Discord/Telegram/WhatsApp. We do NOT listen for it here —
    // agent:response + agent:intermediate cover webchat delivery to WS clients.
    // Listening to both caused duplicate messages in the UI.

    bus.emit(createEvent("system:startup", { host, port }, "gateway"));
    log.info(`Gateway listening on http://${host}:${port} (WS: ${wsPath})`);
  }

  /**
   * Build health status.
   */
  private getHealth(): HealthStatus {
    const mem = process.memoryUsage();
    const sessionStats = this.getSessionStats();
    return {
      status: "healthy",
      uptime: Date.now() - this.startTime,
      channels: {},
      sessions: { active: sessionStats.active, total: sessionStats.total },
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
      },
      version: "1.0.0",
    };
  }

  /**
   * Gracefully stop the server.
   */
  async stop(): Promise<void> {
    log.info("Shutting down gateway...");

    const bus = getEventBus();
    await bus.emit(createEvent("system:shutdown", {}, "gateway"));

    for (const client of this.clients.values()) {
      client.ws.close(1001, "Server shutting down");
    }
    this.clients.clear();

    this.wss?.close();
    this.httpServer?.close();

    log.info("Gateway shut down");
  }
}
