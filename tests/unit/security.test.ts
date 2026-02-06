/**
 * Security Manager Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SecurityManager } from "../../src/security/security.js";
import type { SecurityConfig } from "../../src/types/index.js";

function createConfig(overrides: Partial<SecurityConfig> = {}): SecurityConfig {
  return {
    pairingEnabled: true,
    pairingTimeout: 300,
    allowedUsers: [],
    rateLimiting: {
      enabled: true,
      maxPerMinute: 5,
      maxPerHour: 100,
    },
    auth: {
      type: "none",
    },
    ...overrides,
  };
}

describe("SecurityManager", () => {
  describe("User Approval", () => {
    it("should allow all users when pairing is disabled", () => {
      const sec = new SecurityManager(createConfig({ pairingEnabled: false }));
      expect(sec.isUserApproved("anyone")).toBe(true);
    });

    it("should allow all users when allowedUsers is empty", () => {
      const sec = new SecurityManager(createConfig({ allowedUsers: [] }));
      expect(sec.isUserApproved("anyone")).toBe(true);
    });

    it("should only allow pre-approved users", () => {
      const sec = new SecurityManager(createConfig({ allowedUsers: ["user1", "user2"] }));
      expect(sec.isUserApproved("user1")).toBe(true);
      expect(sec.isUserApproved("user3")).toBe(false);
    });
  });

  describe("Pairing", () => {
    it("should create and approve pairing requests", () => {
      const sec = new SecurityManager(createConfig({ allowedUsers: ["existing"] }));

      expect(sec.isUserApproved("newuser")).toBe(false);

      sec.requestPairing("newuser", "discord", "New User");
      sec.approvePairing("newuser");

      expect(sec.isUserApproved("newuser")).toBe(true);
    });

    it("should deny pairing requests", () => {
      const sec = new SecurityManager(createConfig({ allowedUsers: ["existing"] }));

      sec.requestPairing("newuser", "discord", "New User");
      sec.denyPairing("newuser");

      expect(sec.isUserApproved("newuser")).toBe(false);
      expect(sec.getPendingPairings()).toHaveLength(0);
    });

    it("should expire pairing requests", () => {
      const sec = new SecurityManager(createConfig({
        allowedUsers: ["existing"],
        pairingTimeout: 0, // instant expiry
      }));

      sec.requestPairing("newuser", "discord", "New User");

      // Wait a tiny bit for expiry
      const result = sec.approvePairing("newuser");
      expect(result).toBe(false);
    });

    it("should revoke user access", () => {
      const sec = new SecurityManager(createConfig({ allowedUsers: ["user1"] }));

      expect(sec.isUserApproved("user1")).toBe(true);
      sec.revokeUser("user1");
      expect(sec.isUserApproved("user1")).toBe(false);
    });
  });

  describe("Rate Limiting", () => {
    it("should allow requests within limit", () => {
      const sec = new SecurityManager(createConfig());

      for (let i = 0; i < 5; i++) {
        expect(sec.checkRateLimit("user1")).toBe(true);
      }
    });

    it("should block requests exceeding per-minute limit", () => {
      const sec = new SecurityManager(createConfig());

      // Use up the limit
      for (let i = 0; i < 5; i++) {
        sec.checkRateLimit("user1");
      }

      // Next should be blocked
      expect(sec.checkRateLimit("user1")).toBe(false);
    });

    it("should not rate limit when disabled", () => {
      const sec = new SecurityManager(
        createConfig({
          rateLimiting: { enabled: false, maxPerMinute: 1, maxPerHour: 1 },
        }),
      );

      for (let i = 0; i < 100; i++) {
        expect(sec.checkRateLimit("user1")).toBe(true);
      }
    });
  });

  describe("Token Auth", () => {
    it("should validate correct token", () => {
      const sec = new SecurityManager(
        createConfig({ auth: { type: "token", token: "secret123" } }),
      );

      expect(sec.validateToken("secret123")).toBe(true);
      expect(sec.validateToken("wrong")).toBe(false);
    });

    it("should allow all tokens when auth is none", () => {
      const sec = new SecurityManager(createConfig({ auth: { type: "none" } }));
      expect(sec.validateToken("anything")).toBe(true);
    });
  });

  describe("Audit Log", () => {
    it("should record security events", () => {
      const sec = new SecurityManager(createConfig({ allowedUsers: ["existing"] }));

      sec.requestPairing("user1", "discord", "User 1");
      sec.approvePairing("user1");
      sec.revokeUser("user1");

      const log = sec.getAuditLog();
      expect(log.length).toBeGreaterThanOrEqual(3);
      expect(log.some((e) => e.event === "pairing_requested")).toBe(true);
      expect(log.some((e) => e.event === "pairing_approved")).toBe(true);
      expect(log.some((e) => e.event === "user_revoked")).toBe(true);
    });
  });
});
