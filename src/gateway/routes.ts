/**
 * Gateway HTTP Routes — REST API endpoints.
 */

import type { Hono } from "hono";
import type { ZaakifyConfig, InboundMessage, AgentId, HealthStatus } from "../types/index.js";
import { ChannelId, UserId } from "../types/index.js";
import { getEventBus, createEvent } from "../kernel/event-bus.js";
import { genCorrelationId, genMessageId } from "../utils/ids.js";

/**
 * Register all HTTP routes on the Hono app.
 */
export function setupRoutes(
  app: Hono,
  config: ZaakifyConfig,
  getUiHtml: () => string,
  getHealth: () => HealthStatus,
  getClientCount: () => number,
  startTime: () => number,
): void {
  // Serve the Web UI at root
  app.get("/", (c) => {
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    return c.html(getUiHtml());
  });

  // Health check
  app.get("/health", (c) => {
    const status = getHealth();
    const code = status.status === "healthy" ? 200 : status.status === "degraded" ? 200 : 503;
    return c.json(status, code);
  });

  // OpenAI-compatible chat completions endpoint
  app.post("/v1/chat/completions", async (c) => {
    const body = await c.req.json();
    const bus = getEventBus();
    const correlationId = genCorrelationId();

    const message: InboundMessage = {
      id: genMessageId(),
      sessionId: "" as never,
      channelType: "webchat",
      channelId: ChannelId("api"),
      user: {
        id: UserId("api:user"),
        displayName: config.owner.name,
        channelType: "webchat",
        channelSpecificId: "api",
      },
      content: body.messages?.[body.messages.length - 1]?.content || "",
      attachments: [],
      timestamp: Date.now(),
    };

    const defaultAgent = config.agents[0]?.id || "default";

    const responsePromise = bus.waitFor("agent:response", 300_000);

    bus.emit(
      createEvent(
        "message:inbound",
        { message, agentId: defaultAgent as AgentId },
        "gateway",
        correlationId,
      ),
    );

    try {
      const response = await responsePromise;
      return c.json({
        id: correlationId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model || "zaakify",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: (response.payload as { content: string }).content,
            },
            finish_reason: "stop",
          },
        ],
      });
    } catch {
      return c.json({ error: { message: "Agent timeout", type: "timeout" } }, 504);
    }
  });

  // Session list
  app.get("/api/sessions", (c) => {
    return c.json({ sessions: [] });
  });

  // Config status (non-sensitive)
  app.get("/api/status", (c) => {
    return c.json({
      version: "1.0.0",
      uptime: Date.now() - startTime(),
      channels: {
        discord: config.channels.discord?.enabled ?? false,
        telegram: config.channels.telegram?.enabled ?? false,
        whatsapp: config.channels.whatsapp?.enabled ?? false,
      },
      wsClients: getClientCount(),
    });
  });
}
