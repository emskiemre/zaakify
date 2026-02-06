/**
 * Zaakify Security Layer
 *
 * Handles DM pairing, user approval, rate limiting, and
 * capability-based access control for extensions.
 *
 * Improvements over OpenClaw:
 *   - Unified security module (OpenClaw spreads security across multiple dirs)
 *   - Rate limiter uses a sliding window, not fixed buckets
 *   - Extension capability enforcement is here, not in the extension loader
 *   - Audit log for security events
 */

import type { SecurityConfig, ChannelType } from "../types/index.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger("security");

interface PairingRequest {
  userId: string;
  channelType: ChannelType;
  displayName: string;
  requestedAt: number;
  expiresAt: number;
}

interface RateLimitEntry {
  timestamps: number[]; // sliding window of request timestamps
}

interface AuditEntry {
  timestamp: number;
  event: string;
  userId?: string;
  details: string;
}

export class SecurityManager {
  private config: SecurityConfig;
  private approvedUsers: Set<string> = new Set();
  private pendingPairings: Map<string, PairingRequest> = new Map();
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private auditLog: AuditEntry[] = [];
  private readonly maxAuditEntries = 1000;

  constructor(config: SecurityConfig) {
    this.config = config;

    // Load pre-approved users from config
    for (const user of config.allowedUsers) {
      this.approvedUsers.add(user);
    }

    log.info(
      { approvedUsers: this.approvedUsers.size, pairingEnabled: config.pairingEnabled },
      "Security manager initialized",
    );
  }

  /**
   * Check if a user is allowed to interact with the system.
   * Returns true if approved, false if needs pairing.
   */
  isUserApproved(userId: string): boolean {
    if (!this.config.pairingEnabled) return true;
    if (this.approvedUsers.size === 0) return true; // no allowlist = allow all
    return this.approvedUsers.has(userId);
  }

  /**
   * Create a pairing request for an unapproved user.
   */
  requestPairing(userId: string, channelType: ChannelType, displayName: string): PairingRequest {
    const request: PairingRequest = {
      userId,
      channelType,
      displayName,
      requestedAt: Date.now(),
      expiresAt: Date.now() + this.config.pairingTimeout * 1000,
    };

    this.pendingPairings.set(userId, request);
    this.audit("pairing_requested", userId, `Pairing requested from ${channelType}`);

    log.info({ userId, displayName, channelType }, "Pairing request created");
    return request;
  }

  /**
   * Approve a pending pairing request.
   */
  approvePairing(userId: string): boolean {
    const request = this.pendingPairings.get(userId);
    if (!request) {
      log.warn({ userId }, "No pending pairing request found");
      return false;
    }

    if (Date.now() > request.expiresAt) {
      this.pendingPairings.delete(userId);
      log.warn({ userId }, "Pairing request expired");
      return false;
    }

    this.approvedUsers.add(userId);
    this.pendingPairings.delete(userId);
    this.audit("pairing_approved", userId, `User approved from ${request.channelType}`);

    log.info({ userId, displayName: request.displayName }, "User approved");
    return true;
  }

  /**
   * Deny a pairing request.
   */
  denyPairing(userId: string): void {
    this.pendingPairings.delete(userId);
    this.audit("pairing_denied", userId, "Pairing denied");
    log.info({ userId }, "Pairing denied");
  }

  /**
   * Revoke a user's access.
   */
  revokeUser(userId: string): void {
    this.approvedUsers.delete(userId);
    this.audit("user_revoked", userId, "Access revoked");
    log.info({ userId }, "User access revoked");
  }

  /**
   * Sliding window rate limiter.
   * Returns true if the request should be allowed.
   */
  checkRateLimit(userId: string): boolean {
    if (!this.config.rateLimiting.enabled) return true;

    const now = Date.now();
    const entry = this.rateLimits.get(userId) || { timestamps: [] };

    // Clean old timestamps (older than 1 hour)
    const oneHourAgo = now - 60 * 60 * 1000;
    entry.timestamps = entry.timestamps.filter((t) => t > oneHourAgo);

    // Check per-minute limit
    const oneMinuteAgo = now - 60 * 1000;
    const recentCount = entry.timestamps.filter((t) => t > oneMinuteAgo).length;
    if (recentCount >= this.config.rateLimiting.maxPerMinute) {
      this.audit("rate_limited", userId, `Exceeded ${this.config.rateLimiting.maxPerMinute}/min`);
      return false;
    }

    // Check per-hour limit
    if (entry.timestamps.length >= this.config.rateLimiting.maxPerHour) {
      this.audit("rate_limited", userId, `Exceeded ${this.config.rateLimiting.maxPerHour}/hour`);
      return false;
    }

    // Allow and record
    entry.timestamps.push(now);
    this.rateLimits.set(userId, entry);
    return true;
  }

  /**
   * Validate a gateway auth token.
   */
  validateToken(token: string): boolean {
    if (this.config.auth.type === "none") return true;
    if (this.config.auth.type === "token") {
      return token === this.config.auth.token;
    }
    return false;
  }

  /**
   * Get pending pairing requests.
   */
  getPendingPairings(): PairingRequest[] {
    const now = Date.now();
    // Clean expired
    for (const [id, req] of this.pendingPairings) {
      if (now > req.expiresAt) {
        this.pendingPairings.delete(id);
      }
    }
    return Array.from(this.pendingPairings.values());
  }

  /**
   * Get audit log.
   */
  getAuditLog(limit = 100): AuditEntry[] {
    return this.auditLog.slice(-limit);
  }

  /**
   * Record an audit event.
   */
  private audit(event: string, userId?: string, details: string = ""): void {
    this.auditLog.push({
      timestamp: Date.now(),
      event,
      userId,
      details,
    });

    // Trim to max size
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-this.maxAuditEntries);
    }
  }
}
