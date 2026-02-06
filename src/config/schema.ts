/**
 * Zaakify Config Schema
 *
 * Single Zod schema -- no migration files, no legacy generations.
 * The config version is embedded in the file. On load, if the version
 * is old, a single migrate() pass brings it to current.
 *
 * Improvement over OpenClaw:
 *   - OpenClaw has 3 generations of migration files = unmaintainable
 *   - We have ONE schema with a version number and a linear migrate()
 */

import { z } from "zod";

export const CURRENT_CONFIG_VERSION = 1;

const DiscordChannelSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().min(1),
  allowedGuilds: z.array(z.string()).optional(),
  allowedChannels: z.array(z.string()).optional(),
});

const TelegramChannelSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().min(1),
  allowedUsers: z.array(z.string()).optional(),
});

const WhatsAppChannelSchema = z.object({
  enabled: z.boolean().default(false),
  sessionDataPath: z.string().default("./data/whatsapp"),
});

const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(["zai"]).default("zai"),
  model: z.string().default("glm-4.7"),
  systemPrompt: z.string().default(""),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  tools: z.array(z.string()).default([]),
  apiKey: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const RoutingRuleSchema = z.object({
  channelType: z.enum(["discord", "telegram", "whatsapp", "webchat", "extension"]),
  channelId: z.string().optional(),
  userId: z.string().optional(),
  agentId: z.string(),
  priority: z.number().int().default(0),
});

const SecurityConfigSchema = z.object({
  pairingEnabled: z.boolean().default(true),
  pairingTimeout: z.number().default(300),
  allowedUsers: z.array(z.string()).default([]),
  rateLimiting: z
    .object({
      enabled: z.boolean().default(true),
      maxPerMinute: z.number().default(30),
      maxPerHour: z.number().default(300),
    })
    .default({}),
  auth: z
    .object({
      type: z.enum(["none", "token", "password"]).default("none"),
      token: z.string().optional(),
      passwordHash: z.string().optional(),
    })
    .default({}),
});

const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  dbPath: z.string().default("./data/memory.db"),
  embeddingProvider: z.enum(["openai", "ollama", "none"]).default("none"),
  embeddingModel: z.string().optional(),
  maxResults: z.number().default(10),
  similarityThreshold: z.number().default(0.7),
});

const LogConfigSchema = z.object({
  level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  pretty: z.boolean().default(true),
  file: z.string().optional(),
});

/**
 * Detect the system's IANA timezone.
 * Falls back to "UTC" if detection fails (e.g. on some minimal containers).
 */
function detectSystemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

const OwnerSchema = z.object({
  name: z.string().default("Owner"),
});

export const ZaakifyConfigSchema = z.object({
  version: z.number().int().default(CURRENT_CONFIG_VERSION),
  timezone: z.string().default(detectSystemTimezone()),
  owner: OwnerSchema.default({}),
  gateway: z
    .object({
      host: z.string().default("127.0.0.1"),
      port: z.number().default(18800),
      wsPath: z.string().default("/ws"),
    })
    .default({}),
  agents: z.array(AgentConfigSchema).default([]),
  channels: z
    .object({
      discord: DiscordChannelSchema.optional(),
      telegram: TelegramChannelSchema.optional(),
      whatsapp: WhatsAppChannelSchema.optional(),
    })
    .default({}),
  routing: z.array(RoutingRuleSchema).default([]),
  security: SecurityConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  logging: LogConfigSchema.default({}),
});

export type ParsedConfig = z.infer<typeof ZaakifyConfigSchema>;
