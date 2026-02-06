/**
 * Zaakify Core Types
 *
 * Single source of truth for all shared types across the system.
 * Every module imports from here -- no circular deps, no type drift.
 */

// ─── Identifiers ───────────────────────────────────────────────
export type SessionId = string & { readonly __brand: "SessionId" };
export type ChannelId = string & { readonly __brand: "ChannelId" };
export type UserId = string & { readonly __brand: "UserId" };
export type MessageId = string & { readonly __brand: "MessageId" };
export type AgentId = string & { readonly __brand: "AgentId" };
export type ExtensionId = string & { readonly __brand: "ExtensionId" };
export type ToolId = string & { readonly __brand: "ToolId" };

// Type-safe id constructors
export const SessionId = (v: string) => v as SessionId;
export const ChannelId = (v: string) => v as ChannelId;
export const UserId = (v: string) => v as UserId;
export const MessageId = (v: string) => v as MessageId;
export const AgentId = (v: string) => v as AgentId;
export const ExtensionId = (v: string) => v as ExtensionId;
export const ToolId = (v: string) => v as ToolId;

// ─── Channel Types ─────────────────────────────────────────────
export type ChannelType = "discord" | "telegram" | "whatsapp" | "webchat" | "extension";

export interface ChannelUser {
  id: UserId;
  displayName: string;
  channelType: ChannelType;
  channelSpecificId: string; // platform-native ID
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

// ─── Messages ──────────────────────────────────────────────────
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type ContentType = "text" | "image" | "audio" | "video" | "file" | "embed";

export interface MessageAttachment {
  type: ContentType;
  url?: string;
  data?: Buffer;
  mimeType: string;
  filename?: string;
  size?: number;
}

export interface InboundMessage {
  id: MessageId;
  sessionId: SessionId;
  channelType: ChannelType;
  channelId: ChannelId;
  user: ChannelUser;
  content: string;
  attachments: MessageAttachment[];
  replyToId?: MessageId;
  timestamp: number;
  raw?: unknown; // original platform payload for passthrough
}

export interface OutboundMessage {
  id: MessageId;
  sessionId: SessionId;
  channelType: ChannelType;
  channelId: ChannelId;
  content: string;
  attachments: MessageAttachment[];
  replyToId?: MessageId;
  metadata?: Record<string, unknown>;
}

// ─── Sessions ──────────────────────────────────────────────────
export type SessionStatus = "active" | "idle" | "archived";

export interface Session {
  id: SessionId;
  channelType: ChannelType;
  channelId: ChannelId;
  userId: UserId;
  agentId: AgentId;
  status: SessionStatus;
  history: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface ChatMessage {
  id: MessageId;
  role: MessageRole;
  content: string;
  attachments: MessageAttachment[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  timestamp: number;
}

// ─── Agent / AI ────────────────────────────────────────────────
export type AgentProvider = "zai";

export interface AgentConfig {
  id: AgentId;
  name: string;
  provider: AgentProvider;
  model: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  tools: ToolId[];
  apiKey?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason: "stop" | "tool_use" | "max_tokens" | "error";
}

// ─── Tools / Skills ────────────────────────────────────────────
export interface ToolDefinition {
  id: ToolId;
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  requiredParams: string[];
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

export interface ToolCall {
  id: string;
  toolId: ToolId;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  isError?: boolean;
}

// ─── Events (Event Bus) ───────────────────────────────────────
export type EventType =
  | "message:inbound"
  | "message:outbound"
  | "message:delivered"
  | "message:failed"
  | "message:queued"
  | "session:created"
  | "session:updated"
  | "session:archived"
  | "agent:thinking"
  | "agent:stream_start"
  | "agent:stream_delta"
  | "agent:stream_end"
  | "agent:intermediate"
  | "agent:response"
  | "agent:error"
  | "agent:tool_use"
  | "agent:abort"
  | "agent:aborted"
  | "channel:connected"
  | "channel:disconnected"
  | "channel:error"
  | "extension:loaded"
  | "extension:unloaded"
  | "extension:error"
  | "system:startup"
  | "system:shutdown"
  | "system:config_reload"
  | "system:health_check";

export interface KernelEvent<T = unknown> {
  type: EventType;
  payload: T;
  source: string; // module that emitted
  timestamp: number;
  correlationId?: string; // for tracing message flow
}

// ─── Config ────────────────────────────────────────────────────
export interface ZaakifyConfig {
  version: number;
  timezone: string;
  owner: {
    name: string;
  };
  gateway: {
    host: string;
    port: number;
    wsPath: string;
  };
  agents: AgentConfig[];
  channels: {
    discord?: DiscordChannelConfig;
    telegram?: TelegramChannelConfig;
    whatsapp?: WhatsAppChannelConfig;
  };
  routing: RoutingRule[];
  security: SecurityConfig;
  memory: MemoryConfig;
  logging: LogConfig;
}

export interface DiscordChannelConfig {
  enabled: boolean;
  token: string;
  allowedGuilds?: string[];
  allowedChannels?: string[];
}

export interface TelegramChannelConfig {
  enabled: boolean;
  botToken: string;
  allowedUsers?: string[];
}

export interface WhatsAppChannelConfig {
  enabled: boolean;
  sessionDataPath: string;
}

export interface RoutingRule {
  channelType: ChannelType;
  channelId?: string;
  userId?: string;
  agentId: AgentId;
  priority: number;
}

export interface SecurityConfig {
  pairingEnabled: boolean;
  pairingTimeout: number; // seconds
  allowedUsers: string[];
  rateLimiting: {
    enabled: boolean;
    maxPerMinute: number;
    maxPerHour: number;
  };
  auth: {
    type: "none" | "token" | "password";
    token?: string;
    passwordHash?: string;
  };
}

export interface MemoryConfig {
  enabled: boolean;
  dbPath: string;
  embeddingProvider: "openai" | "ollama" | "none";
  embeddingModel?: string;
  maxResults: number;
  similarityThreshold: number;
}

export interface LogConfig {
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  pretty: boolean;
  file?: string;
}

// ─── Channel Adapter Interface ─────────────────────────────────
export interface ChannelAdapter {
  readonly type: ChannelType;
  readonly name: string;

  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  isConnected(): boolean;

  // Event callbacks set by the router
  onMessage?: (message: InboundMessage) => void;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

// ─── Health ────────────────────────────────────────────────────
export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  channels: Record<string, { connected: boolean; lastActivity: number }>;
  sessions: { active: number; total: number };
  memory: { heapUsed: number; heapTotal: number; rss: number };
  version: string;
}
