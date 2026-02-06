/**
 * Session Manager Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SessionManager } from "../../src/sessions/session-manager.js";
import { ChannelId, UserId, AgentId, MessageId } from "../../src/types/index.js";
import type { ChatMessage } from "../../src/types/index.js";

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(50, 0); // small history, no auto-prune
  });

  it("should create a new session", () => {
    const session = manager.getOrCreate(
      {
        channelType: "discord",
        channelId: ChannelId("ch_123"),
        userId: UserId("usr_abc"),
      },
      AgentId("agt_default"),
    );

    expect(session).toBeDefined();
    expect(session.channelType).toBe("discord");
    expect(session.status).toBe("active");
    expect(session.history).toHaveLength(0);
  });

  it("should return existing session for same key", () => {
    const key = {
      channelType: "discord" as const,
      channelId: ChannelId("ch_123"),
      userId: UserId("usr_abc"),
    };

    const s1 = manager.getOrCreate(key, AgentId("agt_default"));
    const s2 = manager.getOrCreate(key, AgentId("agt_default"));

    expect(s1.id).toBe(s2.id);
  });

  it("should create different sessions for different users", () => {
    const s1 = manager.getOrCreate(
      { channelType: "discord", channelId: ChannelId("ch_1"), userId: UserId("usr_a") },
      AgentId("agt_default"),
    );
    const s2 = manager.getOrCreate(
      { channelType: "discord", channelId: ChannelId("ch_1"), userId: UserId("usr_b") },
      AgentId("agt_default"),
    );

    expect(s1.id).not.toBe(s2.id);
  });

  it("should add messages to session history", () => {
    const session = manager.getOrCreate(
      { channelType: "discord", channelId: ChannelId("ch_1"), userId: UserId("usr_a") },
      AgentId("agt_default"),
    );

    const msg: ChatMessage = {
      id: MessageId("msg_1"),
      role: "user",
      content: "Hello",
      attachments: [],
      timestamp: Date.now(),
    };

    manager.addMessage(session.id, msg);
    const history = manager.getHistory(session.id);

    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("Hello");
  });

  it("should enforce max history size", () => {
    const session = manager.getOrCreate(
      { channelType: "discord", channelId: ChannelId("ch_1"), userId: UserId("usr_a") },
      AgentId("agt_default"),
    );

    // Add 60 messages (max is 50)
    for (let i = 0; i < 60; i++) {
      manager.addMessage(session.id, {
        id: MessageId(`msg_${i}`),
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}`,
        attachments: [],
        timestamp: Date.now(),
      });
    }

    const history = manager.getHistory(session.id);
    expect(history.length).toBeLessThanOrEqual(50);
  });

  it("should archive sessions", () => {
    const session = manager.getOrCreate(
      { channelType: "discord", channelId: ChannelId("ch_1"), userId: UserId("usr_a") },
      AgentId("agt_default"),
    );

    manager.archive(session.id);
    const updated = manager.getById(session.id);

    expect(updated?.status).toBe("archived");
  });

  it("should clear session history", () => {
    const session = manager.getOrCreate(
      { channelType: "discord", channelId: ChannelId("ch_1"), userId: UserId("usr_a") },
      AgentId("agt_default"),
    );

    manager.addMessage(session.id, {
      id: MessageId("msg_1"),
      role: "user",
      content: "Hello",
      attachments: [],
      timestamp: Date.now(),
    });

    manager.clearHistory(session.id);
    expect(manager.getHistory(session.id)).toHaveLength(0);
  });

  it("should return correct stats", () => {
    manager.getOrCreate(
      { channelType: "discord", channelId: ChannelId("ch_1"), userId: UserId("usr_a") },
      AgentId("agt_default"),
    );
    manager.getOrCreate(
      { channelType: "telegram", channelId: ChannelId("ch_2"), userId: UserId("usr_b") },
      AgentId("agt_default"),
    );

    const stats = manager.getStats();
    expect(stats.active).toBe(2);
    expect(stats.total).toBe(2);
  });
});
