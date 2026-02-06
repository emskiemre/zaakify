/**
 * WebSocket Handler — manages WS connections and message routing.
 */

import { WebSocket } from "ws";
import type { ZaakifyConfig, InboundMessage, AgentId } from "../types/index.js";
import { ChannelId, UserId } from "../types/index.js";
import { getEventBus, createEvent } from "../kernel/event-bus.js";
import { genCorrelationId, genMessageId } from "../utils/ids.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger("ws");

export interface WsClient {
  id: string;
  ws: WebSocket;
  authenticated: boolean;
  connectedAt: number;
}

/**
 * Handle a new WebSocket connection.
 */
export function handleConnection(
  ws: WebSocket,
  _url: string,
  clients: Map<string, WsClient>,
  config: ZaakifyConfig,
): void {
  const clientId = genCorrelationId();
  const client: WsClient = {
    id: clientId,
    ws,
    authenticated: config.security.auth.type === "none",
    connectedAt: Date.now(),
  };

  clients.set(clientId, client);
  log.info({ clientId }, "WebSocket client connected");

  ws.on("message", (data) => {
    handleWsMessage(client, data.toString(), config);
  });

  ws.on("close", () => {
    clients.delete(clientId);
    log.info({ clientId }, "WebSocket client disconnected");
  });

  ws.on("error", (err) => {
    log.error({ clientId, err }, "WebSocket error");
    clients.delete(clientId);
  });

  // Send welcome
  ws.send(
    JSON.stringify({
      type: "connected",
      clientId,
      authenticated: client.authenticated,
    }),
  );
}

/**
 * Handle incoming WebSocket message.
 */
function handleWsMessage(client: WsClient, raw: string, config: ZaakifyConfig): void {
  try {
    const msg = JSON.parse(raw);

    // Auth check
    if (!client.authenticated) {
      if (msg.type === "auth" && authenticate(msg.token, config)) {
        client.authenticated = true;
        client.ws.send(JSON.stringify({ type: "auth:success" }));
      } else {
        client.ws.send(JSON.stringify({ type: "auth:required" }));
      }
      return;
    }

    // Handle chat messages from the web UI
    if (msg.type === "chat" && msg.content) {
      const correlationId = genCorrelationId();

      const inbound: InboundMessage = {
        id: genMessageId(),
        sessionId: "" as never,
        channelType: "webchat",
        channelId: ChannelId(`webchat:${client.id}`),
        user: {
          id: UserId(`webchat:${client.id}`),
          displayName: config.owner.name,
          channelType: "webchat",
          channelSpecificId: client.id,
        },
        content: msg.content,
        attachments: [],
        timestamp: Date.now(),
      };

      const defaultAgent = config.agents[0]?.id || "default";

      const bus = getEventBus();
      bus.emit(
        createEvent(
          "message:inbound",
          { message: inbound, agentId: defaultAgent as AgentId },
          "gateway",
          correlationId,
        ),
      );

      log.info({ clientId: client.id, content: msg.content.slice(0, 80) }, "Webchat message received");
      return;
    }

    // Other message types
    const bus = getEventBus();
    bus.emit(
      createEvent(
        "message:inbound",
        { source: "webchat", clientId: client.id, ...msg },
        "gateway",
      ),
    );
  } catch {
    log.warn("Received invalid WebSocket message");
  }
}

/**
 * Authenticate a client token.
 */
function authenticate(token: string | undefined, config: ZaakifyConfig): boolean {
  if (config.security.auth.type === "none") return true;
  if (config.security.auth.type === "token") {
    return token === config.security.auth.token;
  }
  return false;
}

/**
 * Broadcast a message to all authenticated WS clients.
 */
export function broadcastToClients(
  clients: Map<string, WsClient>,
  data: { type: string; content: string },
): void {
  const payload = JSON.stringify({ type: data.type, data: { content: data.content } });

  for (const client of clients.values()) {
    if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}
