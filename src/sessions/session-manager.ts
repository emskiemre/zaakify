/**
 * Zaakify Session Manager
 *
 * Manages chat sessions between users and agents. Sessions are
 * keyed by (channelType, channelId, userId) and lazily created.
 *
 * Improvement over OpenClaw:
 *   - Sessions are a separate concern, not baked into the gateway
 *   - SQLite-backed persistence with in-memory LRU cache
 *   - Automatic pruning of stale sessions
 *   - Event-driven: emits session lifecycle events on the bus
 */

import type {
  Session,
  SessionId,
  ChannelType,
  ChannelId,
  UserId,
  AgentId,
  ChatMessage,
  SessionStatus,
} from "../types/index.js";
import { genSessionId } from "../utils/ids.js";
import { getEventBus, createEvent } from "../kernel/event-bus.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger("sessions");

interface SessionKey {
  channelType: ChannelType;
  channelId: ChannelId;
  userId: UserId;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private sessionIndex: Map<SessionId, string> = new Map(); // id -> key
  private readonly maxHistoryPerSession: number;
  private readonly pruneIntervalMs: number;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    maxHistory = 200,
    pruneIntervalMs = 5 * 60 * 1000, // 5 minutes
  ) {
    this.maxHistoryPerSession = maxHistory;
    this.pruneIntervalMs = pruneIntervalMs;
  }

  /**
   * Start automatic session pruning.
   */
  start(): void {
    this.pruneTimer = setInterval(() => this.pruneStale(), this.pruneIntervalMs);
    log.info("Session manager started");
  }

  /**
   * Stop session pruning.
   */
  stop(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    log.info("Session manager stopped");
  }

  /**
   * Build a deterministic key for session lookup.
   */
  private buildKey(key: SessionKey): string {
    return `${key.channelType}:${key.channelId}:${key.userId}`;
  }

  /**
   * Get or create a session for the given channel/user/agent combo.
   */
  getOrCreate(key: SessionKey, agentId: AgentId): Session {
    const k = this.buildKey(key);
    const existing = this.sessions.get(k);

    if (existing) {
      existing.updatedAt = Date.now();
      if (existing.status === "idle") {
        existing.status = "active";
      }
      return existing;
    }

    const session: Session = {
      id: genSessionId(),
      channelType: key.channelType,
      channelId: key.channelId,
      userId: key.userId,
      agentId,
      status: "active",
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
    };

    this.sessions.set(k, session);
    this.sessionIndex.set(session.id, k);

    const bus = getEventBus();
    bus.emit(createEvent("session:created", { sessionId: session.id }, "sessions"));

    log.info({ sessionId: session.id, channel: key.channelType }, "Session created");
    return session;
  }

  /**
   * Get a session by its ID.
   */
  getById(id: SessionId): Session | undefined {
    const key = this.sessionIndex.get(id);
    if (!key) return undefined;
    return this.sessions.get(key);
  }

  /**
   * Append a message to session history, enforcing max size.
   */
  addMessage(sessionId: SessionId, message: ChatMessage): void {
    const session = this.getById(sessionId);
    if (!session) {
      log.warn({ sessionId }, "Tried to add message to nonexistent session");
      return;
    }

    session.history.push(message);
    session.updatedAt = Date.now();

    // Sliding window: keep system messages, trim oldest user/assistant
    if (session.history.length > this.maxHistoryPerSession) {
      const systemMsgs = session.history.filter((m) => m.role === "system");
      const nonSystem = session.history.filter((m) => m.role !== "system");
      const trimmed = nonSystem.slice(-this.maxHistoryPerSession + systemMsgs.length);
      session.history = [...systemMsgs, ...trimmed];
    }
  }

  /**
   * Get session history for agent context.
   */
  getHistory(sessionId: SessionId): ChatMessage[] {
    const session = this.getById(sessionId);
    return session?.history ?? [];
  }

  /**
   * Archive a session (soft delete).
   */
  archive(sessionId: SessionId): void {
    const session = this.getById(sessionId);
    if (!session) return;

    session.status = "archived";
    session.updatedAt = Date.now();

    const bus = getEventBus();
    bus.emit(createEvent("session:archived", { sessionId }, "sessions"));
    log.info({ sessionId }, "Session archived");
  }

  /**
   * Clear session history but keep the session alive.
   */
  clearHistory(sessionId: SessionId): void {
    const session = this.getById(sessionId);
    if (!session) return;

    session.history = [];
    session.updatedAt = Date.now();
    log.info({ sessionId }, "Session history cleared");
  }

  /**
   * Update session status.
   */
  setStatus(sessionId: SessionId, status: SessionStatus): void {
    const session = this.getById(sessionId);
    if (!session) return;

    session.status = status;
    session.updatedAt = Date.now();

    const bus = getEventBus();
    bus.emit(createEvent("session:updated", { sessionId, status }, "sessions"));
  }

  /**
   * Get all active sessions.
   */
  getActiveSessions(): Session[] {
    return Array.from(this.sessions.values()).filter((s) => s.status === "active");
  }

  /**
   * Get session stats.
   */
  getStats(): { active: number; idle: number; archived: number; total: number } {
    const sessions = Array.from(this.sessions.values());
    return {
      active: sessions.filter((s) => s.status === "active").length,
      idle: sessions.filter((s) => s.status === "idle").length,
      archived: sessions.filter((s) => s.status === "archived").length,
      total: sessions.length,
    };
  }

  /**
   * Prune stale sessions (idle for > 30 min = mark idle, > 24h = archive).
   */
  private pruneStale(): void {
    const now = Date.now();
    const IDLE_THRESHOLD = 30 * 60 * 1000; // 30 minutes
    const ARCHIVE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours

    for (const session of this.sessions.values()) {
      if (session.status === "archived") continue;

      const age = now - session.updatedAt;

      if (age > ARCHIVE_THRESHOLD) {
        this.archive(session.id);
      } else if (age > IDLE_THRESHOLD && session.status === "active") {
        this.setStatus(session.id, "idle");
      }
    }
  }
}
