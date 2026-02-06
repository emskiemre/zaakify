/**
 * Zaakify Event Bus (Kernel)
 *
 * The central nervous system. All modules communicate through events,
 * never by direct import. This gives us:
 *   - Loose coupling: modules don't know about each other
 *   - Testability: mock the bus, test any module in isolation
 *   - Durability: events can be persisted to SQLite WAL for replay
 *   - Traceability: every event has a correlationId for request tracing
 *
 * Design decisions vs OpenClaw:
 *   - OpenClaw uses direct function calls between modules = tight coupling
 *   - We use an event bus = any module can be swapped/restarted independently
 *   - OpenClaw has no message durability = messages lost on crash
 *   - We persist events to a WAL-mode SQLite queue = crash recovery
 */

import { EventEmitter } from "node:events";
import type { EventType, KernelEvent } from "../types/index.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger("kernel");

type EventHandler<T = unknown> = (event: KernelEvent<T>) => void | Promise<void>;
type EventFilter = (event: KernelEvent) => boolean;

interface Subscription {
  id: number;
  type: EventType | "*";
  handler: EventHandler;
  filter?: EventFilter;
  once: boolean;
}

export class EventBus {
  private subscriptions: Map<number, Subscription> = new Map();
  private nextId = 1;
  private emitter = new EventEmitter();
  private eventLog: KernelEvent[] = []; // in-memory ring buffer
  private readonly maxLogSize = 10_000;
  private paused = false;
  private pendingQueue: KernelEvent[] = [];

  constructor() {
    // High water mark -- we're not a traditional EventEmitter user
    this.emitter.setMaxListeners(500);
  }

  /**
   * Publish an event to all matching subscribers.
   * Events are processed asynchronously -- handlers that throw
   * are caught and logged, never crashing the bus.
   */
  async emit<T>(event: KernelEvent<T>): Promise<void> {
    // Add to ring buffer
    this.eventLog.push(event as KernelEvent);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }

    if (this.paused) {
      this.pendingQueue.push(event as KernelEvent);
      return;
    }

    const handlers: Promise<void>[] = [];

    for (const [id, sub] of this.subscriptions) {
      if (sub.type !== "*" && sub.type !== event.type) continue;
      if (sub.filter && !sub.filter(event as KernelEvent)) continue;

      const promise = (async () => {
        try {
          await sub.handler(event as KernelEvent);
        } catch (err) {
          log.error({ err, eventType: event.type, subId: id }, "Event handler threw");
        }
      })();

      handlers.push(promise);

      if (sub.once) {
        this.subscriptions.delete(id);
      }
    }

    // Run all handlers concurrently -- fast parallel processing
    await Promise.allSettled(handlers);
  }

  /**
   * Subscribe to events of a specific type (or "*" for all).
   * Returns an unsubscribe function.
   */
  on<T>(type: EventType | "*", handler: EventHandler<T>, filter?: EventFilter): () => void {
    const id = this.nextId++;
    this.subscriptions.set(id, {
      id,
      type,
      handler: handler as EventHandler,
      filter,
      once: false,
    });

    return () => {
      this.subscriptions.delete(id);
    };
  }

  /**
   * Subscribe to a single event occurrence, then auto-unsubscribe.
   */
  once<T>(type: EventType, handler: EventHandler<T>): () => void {
    const id = this.nextId++;
    this.subscriptions.set(id, {
      id,
      type,
      handler: handler as EventHandler,
      once: true,
    });

    return () => {
      this.subscriptions.delete(id);
    };
  }

  /**
   * Wait for a specific event type, returning a promise.
   * Useful for one-shot flows like "wait for channel connected".
   */
  waitFor<T>(type: EventType, timeout = 30_000): Promise<KernelEvent<T>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`Timeout waiting for event: ${type}`));
      }, timeout);

      const unsub = this.once<T>(type, (event) => {
        clearTimeout(timer);
        resolve(event as KernelEvent<T>);
      });
    });
  }

  /**
   * Pause event delivery. Events are queued and delivered on resume.
   * Useful during config reload or graceful shutdown.
   */
  pause(): void {
    this.paused = true;
    log.info("Event bus paused");
  }

  /**
   * Resume event delivery and flush the pending queue.
   */
  async resume(): Promise<void> {
    this.paused = false;
    log.info(`Event bus resumed, flushing ${this.pendingQueue.length} pending events`);

    const pending = [...this.pendingQueue];
    this.pendingQueue = [];

    for (const event of pending) {
      await this.emit(event);
    }
  }

  /**
   * Get recent events from the ring buffer (for debugging/health).
   */
  getRecentEvents(count = 100): KernelEvent[] {
    return this.eventLog.slice(-count);
  }

  /**
   * Get count of active subscriptions (for health checks).
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Clear all subscriptions. Used during shutdown.
   */
  clear(): void {
    this.subscriptions.clear();
    this.pendingQueue = [];
    log.info("Event bus cleared");
  }
}

// Singleton -- the entire app shares one bus
let instance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!instance) {
    instance = new EventBus();
  }
  return instance;
}

export function resetEventBus(): void {
  instance?.clear();
  instance = null;
}

/**
 * Helper to create a typed event with defaults.
 */
export function createEvent<T>(
  type: EventType,
  payload: T,
  source: string,
  correlationId?: string,
): KernelEvent<T> {
  return {
    type,
    payload,
    source,
    timestamp: Date.now(),
    correlationId,
  };
}
