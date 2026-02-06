/**
 * Zaakify Channel Router
 *
 * Routes inbound messages from any channel to the correct AI agent,
 * and outbound responses back to the originating channel.
 *
 * Improvements over OpenClaw:
 *   - Decoupled from gateway (OpenClaw bakes routing into the gateway process)
 *   - Priority-based routing rules with fallback
 *   - Per-user agent overrides
 *   - Rate limiting at the router level
 *   - Event-driven: listens on the bus, never imported directly
 */

import type {
  ChannelAdapter,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  RoutingRule,
  AgentId,
  ZaakifyConfig,
} from "../types/index.js";
import { getEventBus, createEvent } from "../kernel/event-bus.js";
import { genCorrelationId } from "../utils/ids.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger("router");

interface RateLimit {
  count: number;
  windowStart: number;
}

export class ChannelRouter {
  private adapters: Map<ChannelType, ChannelAdapter> = new Map();
  private routes: RoutingRule[] = [];
  private rateLimits: Map<string, RateLimit> = new Map();
  private config: ZaakifyConfig;

  constructor(config: ZaakifyConfig) {
    this.config = config;
    this.routes = [...config.routing].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Register a channel adapter. The router will start it and wire events.
   */
  registerAdapter(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.type)) {
      log.warn({ type: adapter.type }, "Adapter already registered, replacing");
    }

    adapter.onMessage = (message: InboundMessage) => {
      this.handleInbound(message);
    };

    adapter.onError = (error: Error) => {
      const bus = getEventBus();
      bus.emit(
        createEvent(
          "channel:error",
          { channelType: adapter.type, error: error.message },
          "router",
        ),
      );
    };

    adapter.onConnected = () => {
      const bus = getEventBus();
      bus.emit(
        createEvent("channel:connected", { channelType: adapter.type }, "router"),
      );
    };

    adapter.onDisconnected = () => {
      const bus = getEventBus();
      bus.emit(
        createEvent("channel:disconnected", { channelType: adapter.type }, "router"),
      );
    };

    this.adapters.set(adapter.type, adapter);
    log.info({ type: adapter.type, name: adapter.name }, "Channel adapter registered");
  }

  /**
   * Start all registered adapters.
   */
  async startAll(): Promise<void> {
    const bus = getEventBus();

    // Listen for outbound messages to route back to channels
    bus.on<OutboundMessage>("message:outbound", async (event) => {
      const msg = event.payload as OutboundMessage;
      await this.handleOutbound(msg);
    });

    // Start all adapters concurrently
    const startPromises = Array.from(this.adapters.entries()).map(
      async ([type, adapter]) => {
        try {
          await adapter.start();
          log.info({ type }, "Channel adapter started");
        } catch (err) {
          log.error({ type, err }, "Failed to start channel adapter");
        }
      },
    );

    await Promise.allSettled(startPromises);
    log.info(`${this.adapters.size} channel adapter(s) started`);
  }

  /**
   * Stop all adapters.
   */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.adapters.values()).map((adapter) =>
      adapter.stop().catch((err) => {
        log.error({ type: adapter.type, err }, "Error stopping adapter");
      }),
    );

    await Promise.allSettled(stopPromises);
    log.info("All channel adapters stopped");
  }

  /**
   * Handle an inbound message from a channel adapter.
   */
  private handleInbound(message: InboundMessage): void {
    // Rate limiting
    if (this.isRateLimited(message.user.id)) {
      log.warn(
        { userId: message.user.id, channel: message.channelType },
        "Message rate-limited",
      );
      return;
    }

    // Resolve which agent should handle this
    const agentId = this.resolveAgent(message.channelType, message.channelId, message.user.id);

    if (!agentId) {
      log.warn(
        { channel: message.channelType, user: message.user.id },
        "No routing rule matched, dropping message",
      );
      return;
    }

    const correlationId = genCorrelationId();
    const bus = getEventBus();

    bus.emit(
      createEvent(
        "message:inbound",
        {
          message,
          agentId,
        },
        "router",
        correlationId,
      ),
    );

    log.debug(
      { channel: message.channelType, user: message.user.displayName, agentId },
      "Inbound message routed",
    );
  }

  /**
   * Handle an outbound message by sending it through the correct adapter.
   */
  private async handleOutbound(message: OutboundMessage): Promise<void> {
    const adapter = this.adapters.get(message.channelType);

    if (!adapter) {
      log.error({ channelType: message.channelType }, "No adapter for outbound message");
      return;
    }

    if (!adapter.isConnected()) {
      log.warn({ channelType: message.channelType }, "Adapter not connected, queuing failed");

      const bus = getEventBus();
      bus.emit(
        createEvent(
          "message:failed",
          { message, reason: "adapter_disconnected" },
          "router",
        ),
      );
      return;
    }

    try {
      await adapter.send(message);
      const bus = getEventBus();
      bus.emit(createEvent("message:delivered", { messageId: message.id }, "router"));
    } catch (err) {
      log.error({ channelType: message.channelType, err }, "Failed to send outbound message");

      const bus = getEventBus();
      bus.emit(
        createEvent(
          "message:failed",
          { message, reason: (err as Error).message },
          "router",
        ),
      );
    }
  }

  /**
   * Resolve which agent should handle a message based on routing rules.
   * Rules are sorted by priority (highest first). First match wins.
   */
  private resolveAgent(
    channelType: ChannelType,
    channelId: string,
    userId: string,
  ): AgentId | null {
    for (const rule of this.routes) {
      // Channel type must match
      if (rule.channelType !== channelType) continue;

      // If rule specifies channelId, it must match
      if (rule.channelId && rule.channelId !== channelId) continue;

      // If rule specifies userId, it must match
      if (rule.userId && rule.userId !== userId) continue;

      return rule.agentId;
    }

    // Fallback: first agent in config
    if (this.config.agents.length > 0) {
      return this.config.agents[0].id as AgentId;
    }

    return null;
  }

  /**
   * Check if a user is rate-limited.
   */
  private isRateLimited(userId: string): boolean {
    if (!this.config.security.rateLimiting.enabled) return false;

    const now = Date.now();
    const key = userId;
    const limit = this.rateLimits.get(key);

    if (!limit || now - limit.windowStart > 60_000) {
      this.rateLimits.set(key, { count: 1, windowStart: now });
      return false;
    }

    limit.count++;
    if (limit.count > this.config.security.rateLimiting.maxPerMinute) {
      return true;
    }

    return false;
  }

  /**
   * Get status of all adapters.
   */
  getAdapterStatus(): Record<string, { connected: boolean; name: string }> {
    const status: Record<string, { connected: boolean; name: string }> = {};
    for (const [type, adapter] of this.adapters) {
      status[type] = {
        connected: adapter.isConnected(),
        name: adapter.name,
      };
    }
    return status;
  }
}
