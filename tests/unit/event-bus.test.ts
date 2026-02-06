/**
 * Event Bus Tests
 *
 * Tests the core kernel -- if this breaks, everything breaks.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventBus, createEvent } from "../../src/kernel/event-bus.js";
import type { KernelEvent } from "../../src/types/index.js";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it("should emit and receive events", async () => {
    const handler = vi.fn();
    bus.on("message:inbound", handler);

    const event = createEvent("message:inbound", { text: "hello" }, "test");
    await bus.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("should support wildcard subscriptions", async () => {
    const handler = vi.fn();
    bus.on("*", handler);

    await bus.emit(createEvent("message:inbound", {}, "test"));
    await bus.emit(createEvent("session:created", {}, "test"));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("should support once subscriptions", async () => {
    const handler = vi.fn();
    bus.once("message:inbound", handler);

    await bus.emit(createEvent("message:inbound", {}, "test"));
    await bus.emit(createEvent("message:inbound", {}, "test"));

    expect(handler).toHaveBeenCalledOnce();
  });

  it("should support unsubscribe", async () => {
    const handler = vi.fn();
    const unsub = bus.on("message:inbound", handler);

    await bus.emit(createEvent("message:inbound", {}, "test"));
    expect(handler).toHaveBeenCalledOnce();

    unsub();
    await bus.emit(createEvent("message:inbound", {}, "test"));
    expect(handler).toHaveBeenCalledOnce(); // still 1
  });

  it("should support event filters", async () => {
    const handler = vi.fn();
    bus.on(
      "message:inbound",
      handler,
      (event) => (event.payload as Record<string, string>).channel === "discord",
    );

    await bus.emit(createEvent("message:inbound", { channel: "telegram" }, "test"));
    expect(handler).not.toHaveBeenCalled();

    await bus.emit(createEvent("message:inbound", { channel: "discord" }, "test"));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("should handle handler errors without crashing", async () => {
    const badHandler = vi.fn(() => {
      throw new Error("boom");
    });
    const goodHandler = vi.fn();

    bus.on("message:inbound", badHandler);
    bus.on("message:inbound", goodHandler);

    await bus.emit(createEvent("message:inbound", {}, "test"));

    expect(badHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled(); // should still run
  });

  it("should pause and resume event delivery", async () => {
    const handler = vi.fn();
    bus.on("message:inbound", handler);

    bus.pause();
    await bus.emit(createEvent("message:inbound", {}, "test"));
    expect(handler).not.toHaveBeenCalled();

    await bus.resume();
    expect(handler).toHaveBeenCalledOnce(); // flushed
  });

  it("should waitFor an event with timeout", async () => {
    const promise = bus.waitFor("channel:connected", 1000);

    // Emit after a short delay
    setTimeout(() => {
      bus.emit(createEvent("channel:connected", { type: "discord" }, "test"));
    }, 50);

    const event = await promise;
    expect((event.payload as Record<string, string>).type).toBe("discord");
  });

  it("should timeout waitFor if event never comes", async () => {
    await expect(bus.waitFor("channel:connected", 100)).rejects.toThrow("Timeout");
  });

  it("should maintain a ring buffer of recent events", async () => {
    for (let i = 0; i < 5; i++) {
      await bus.emit(createEvent("message:inbound", { i }, "test"));
    }

    const recent = bus.getRecentEvents(3);
    expect(recent).toHaveLength(3);
    expect((recent[0].payload as Record<string, number>).i).toBe(2);
  });

  it("should report subscription count", () => {
    bus.on("message:inbound", () => {});
    bus.on("message:outbound", () => {});
    bus.on("*", () => {});

    expect(bus.getSubscriptionCount()).toBe(3);
  });

  it("should clear all subscriptions", async () => {
    const handler = vi.fn();
    bus.on("message:inbound", handler);
    bus.clear();

    await bus.emit(createEvent("message:inbound", {}, "test"));
    expect(handler).not.toHaveBeenCalled();
    expect(bus.getSubscriptionCount()).toBe(0);
  });
});
