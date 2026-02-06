/**
 * Zaakify Message Queue
 *
 * Handles message queuing when a session is busy processing.
 * Features:
 *   - Per-session message queues
 *   - Deduplication (ignores duplicate messages within 2 seconds)
 *   - Queue cap with drop policy (oldest dropped first)
 *   - FIFO processing (first in, first out)
 */

import type { InboundMessage, AgentId, SessionId } from "../types/index.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger("message-queue");

const MAX_QUEUE_SIZE = 20;
const DEDUPE_WINDOW_MS = 2000; // 2 seconds

export interface QueuedMessage {
  id: string;
  message: InboundMessage;
  agentId: AgentId;
  correlationId?: string;
  enqueuedAt: number;
}

interface SessionQueue {
  items: QueuedMessage[];
  lastEnqueuedAt: number;
}

export class MessageQueue {
  private queues = new Map<SessionId, SessionQueue>();

  /**
   * Add a message to the session's queue.
   * Returns false if message was rejected (duplicate or queue full with "new" drop policy).
   */
  enqueue(
    sessionId: SessionId,
    message: InboundMessage,
    agentId: AgentId,
    correlationId?: string,
  ): boolean {
    let queue = this.queues.get(sessionId);

    if (!queue) {
      queue = { items: [], lastEnqueuedAt: 0 };
      this.queues.set(sessionId, queue);
    }

    // Deduplication: check if same message was sent recently
    if (this.isDuplicate(queue, message)) {
      log.debug(
        { sessionId, messageId: message.id, content: message.content.slice(0, 50) },
        "Duplicate message ignored",
      );
      return false;
    }

    // Apply queue cap - drop oldest if full
    if (queue.items.length >= MAX_QUEUE_SIZE) {
      const dropped = queue.items.shift();
      log.warn(
        { sessionId, droppedId: dropped?.id, queueSize: MAX_QUEUE_SIZE },
        "Queue full, dropped oldest message",
      );
    }

    const queuedMessage: QueuedMessage = {
      id: message.id,
      message,
      agentId,
      correlationId,
      enqueuedAt: Date.now(),
    };

    queue.items.push(queuedMessage);
    queue.lastEnqueuedAt = Date.now();

    log.info(
      { sessionId, messageId: message.id, queueDepth: queue.items.length },
      "Message queued",
    );

    return true;
  }

  /**
   * Take the next message from the queue.
   * Returns undefined if queue is empty.
   */
  dequeue(sessionId: SessionId): QueuedMessage | undefined {
    const queue = this.queues.get(sessionId);
    if (!queue || queue.items.length === 0) {
      return undefined;
    }

    const next = queue.items.shift();

    // Clean up empty queues
    if (queue.items.length === 0) {
      this.queues.delete(sessionId);
    }

    if (next) {
      log.debug(
        { sessionId, messageId: next.id, remainingInQueue: queue.items.length },
        "Message dequeued",
      );
    }

    return next;
  }

  /**
   * Get the number of messages waiting in a session's queue.
   */
  getDepth(sessionId: SessionId): number {
    const queue = this.queues.get(sessionId);
    return queue?.items.length ?? 0;
  }

  /**
   * Check if a session has messages waiting.
   */
  hasMessages(sessionId: SessionId): boolean {
    return this.getDepth(sessionId) > 0;
  }

  /**
   * Clear all messages in a session's queue.
   */
  clear(sessionId: SessionId): number {
    const queue = this.queues.get(sessionId);
    const count = queue?.items.length ?? 0;

    if (count > 0) {
      this.queues.delete(sessionId);
      log.info({ sessionId, clearedCount: count }, "Queue cleared");
    }

    return count;
  }

  /**
   * Get all queued messages for a session (without removing them).
   */
  peek(sessionId: SessionId): QueuedMessage[] {
    const queue = this.queues.get(sessionId);
    return queue?.items ?? [];
  }

  /**
   * Check if a message is a duplicate (same content within dedupe window).
   */
  private isDuplicate(queue: SessionQueue, message: InboundMessage): boolean {
    const now = Date.now();

    return queue.items.some((queued) => {
      // Same message ID
      if (queued.message.id === message.id) {
        return true;
      }

      // Same content within time window
      const withinWindow = now - queued.enqueuedAt < DEDUPE_WINDOW_MS;
      const sameContent = queued.message.content.trim() === message.content.trim();

      return withinWindow && sameContent;
    });
  }

  /**
   * Get stats for all queues.
   */
  getStats(): { totalQueues: number; totalMessages: number; queues: Record<string, number> } {
    const queues: Record<string, number> = {};
    let totalMessages = 0;

    for (const [sessionId, queue] of this.queues) {
      queues[sessionId] = queue.items.length;
      totalMessages += queue.items.length;
    }

    return {
      totalQueues: this.queues.size,
      totalMessages,
      queues,
    };
  }
}

// Singleton instance
let instance: MessageQueue | null = null;

export function getMessageQueue(): MessageQueue {
  if (!instance) {
    instance = new MessageQueue();
  }
  return instance;
}

export function resetMessageQueue(): void {
  instance = null;
}
