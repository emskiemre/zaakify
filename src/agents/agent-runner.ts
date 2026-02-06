/**
 * Zaakify Agent Runner
 *
 * Orchestrates the AI agent loop: receives messages, sends to provider,
 * handles tool calls, and returns responses. This is the brain.
 *
 * Improvement over OpenClaw:
 *   - Clean separation: runner doesn't know about channels or sessions
 *   - Tool call loop with max iterations (prevents runaway agents)
 *   - Event-driven: listens on bus for inbound messages, emits responses
 *   - Pluggable provider: swap Anthropic for OpenAI with one config change
 *   - Message queue: handles concurrent messages gracefully
 *   - Abort support: users can cancel in-flight requests with "stop"
 *   - Deduplication: ignores duplicate messages
 */

import type {
  AgentConfig,
  InboundMessage,
  ChatMessage,
  AgentId,
  SessionId,
  ToolCall,
  ToolResult,
} from "../types/index.js";
import { genMessageId } from "../utils/ids.js";
import { createProvider, type AIProvider } from "./provider.js";
import { type ToolRegistry } from "../tools/registry.js";
import { SessionManager } from "../sessions/session-manager.js";
import { getEventBus, createEvent } from "../kernel/event-bus.js";
import { getLogger } from "../utils/logger.js";
import { logTranscript } from "./transcript-logger.js";
import { trimHistory } from "./history-manager.js";
import { getMessageQueue } from "../sessions/message-queue.js";

const log = getLogger("agent-runner");

const MAX_TOOL_ITERATIONS = 1000;

/** Tracks an active run with its abort controller */
interface ActiveRun {
  controller: AbortController;
  agentId: AgentId;
  startedAt: number;
  correlationId?: string;
}

export class AgentRunner {
  private providers: Map<AgentId, AIProvider> = new Map();
  private configs: Map<AgentId, AgentConfig> = new Map();
  private toolRegistry: ToolRegistry;
  private sessionManager: SessionManager;

  /** Tracks which sessions are currently processing */
  private activeRuns: Map<SessionId, ActiveRun> = new Map();

  constructor(
    agentConfigs: AgentConfig[],
    toolRegistry: ToolRegistry,
    sessionManager: SessionManager,
  ) {
    this.toolRegistry = toolRegistry;
    this.sessionManager = sessionManager;

    // Initialize providers for each configured agent
    for (const config of agentConfigs) {
      const agentId = config.id as AgentId;
      this.configs.set(agentId, config);
      this.providers.set(agentId, createProvider(config.provider, { apiKey: config.apiKey }));
      log.info(
        { agentId: config.id, provider: config.provider, model: config.model },
        "Agent provider initialized",
      );
    }
  }

  /**
   * Start listening for inbound messages on the event bus.
   */
  start(): void {
    const bus = getEventBus();
    const messageQueue = getMessageQueue();

    // Listen for abort requests
    bus.on("agent:abort", (event) => {
      const payload = event.payload as { sessionId?: SessionId };
      if (payload.sessionId) {
        this.abortSession(payload.sessionId);
      }
    });

    bus.on("message:inbound", async (event) => {
      const payload = event.payload as {
        message?: InboundMessage;
        agentId?: string;
      };

      if (!payload.message || !payload.agentId) {
        log.debug({ hasMessage: !!payload.message, hasAgent: !!payload.agentId, source: event.source }, "Skipping event -- missing message or agentId");
        return;
      }

      // Resolve the agent ID -- try exact match first, then match by raw string
      let resolvedAgentId = payload.agentId as AgentId;
      if (!this.providers.has(resolvedAgentId)) {
        // The config stores IDs as plain strings, so find by value
        for (const [id] of this.providers) {
          if (String(id) === String(payload.agentId)) {
            resolvedAgentId = id;
            break;
          }
        }
      }

      // Get session to check if busy
      const session = this.sessionManager.getOrCreate(
        {
          channelType: payload.message.channelType,
          channelId: payload.message.channelId,
          userId: payload.message.user.id,
        },
        resolvedAgentId,
      );

      // Check if this is a stop command
      if (this.isStopCommand(payload.message.content)) {
        const aborted = this.abortSession(session.id);
        if (aborted) {
          log.info({ sessionId: session.id }, "Session aborted by user stop command");
          bus.emit(
            createEvent(
              "agent:aborted",
              { sessionId: session.id, reason: "user_requested" },
              "agent-runner",
              event.correlationId,
            ),
          );
          // Clear any queued messages for this session
          messageQueue.clear(session.id);
        } else {
          log.debug({ sessionId: session.id }, "Stop command received but no active run");
        }
        return;
      }

      log.info({ agentId: payload.agentId, content: payload.message.content?.slice(0, 80), channel: payload.message.channelType }, "Processing inbound message");

      // Check if session is busy
      if (this.isSessionBusy(session.id)) {
        // Queue the message
        const queued = messageQueue.enqueue(
          session.id,
          payload.message,
          resolvedAgentId,
          event.correlationId,
        );

        if (queued) {
          const depth = messageQueue.getDepth(session.id);
          log.info({ sessionId: session.id, queueDepth: depth }, "Message queued - session busy");

          bus.emit(
            createEvent(
              "message:queued",
              { sessionId: session.id, queueDepth: depth },
              "agent-runner",
              event.correlationId,
            ),
          );
        }
        return;
      }

      // Process the message
      try {
        await this.processMessage(payload.message, resolvedAgentId, event.correlationId);
      } catch (err) {
        const errorMsg = (err as Error).message || "Unknown error";
        log.error({ err, agentId: payload.agentId }, "Agent error processing message");

        // Send error back as agent:response so the UI gets feedback
        bus.emit(
          createEvent(
            "agent:response",
            {
              content: `Error: ${errorMsg}`,
              sessionId: session.id,
              agentId: payload.agentId,
            },
            "agent-runner",
            event.correlationId,
          ),
        );

        bus.emit(
          createEvent(
            "agent:error",
            { error: errorMsg, agentId: payload.agentId },
            "agent-runner",
            event.correlationId,
          ),
        );
      }

      // After processing, drain any queued messages
      await this.drainQueue(session.id);
    });

    log.info("Agent runner started, listening for messages");
  }

  /**
   * Check if a message is a stop command.
   */
  private isStopCommand(content: string): boolean {
    const trimmed = content.trim().toLowerCase();
    return trimmed === "stop" || trimmed === "/stop";
  }

  /**
   * Check if a session is currently busy processing.
   */
  isSessionBusy(sessionId: SessionId): boolean {
    return this.activeRuns.has(sessionId);
  }

  /**
   * Abort an active session.
   * Returns true if a session was aborted, false if no active run.
   */
  abortSession(sessionId: SessionId): boolean {
    const run = this.activeRuns.get(sessionId);
    if (!run) {
      return false;
    }

    log.info({ sessionId, agentId: run.agentId, runningFor: Date.now() - run.startedAt }, "Aborting session");
    run.controller.abort();
    return true;
  }

  /**
   * Process queued messages for a session after current processing completes.
   */
  private async drainQueue(sessionId: SessionId): Promise<void> {
    const bus = getEventBus();
    const messageQueue = getMessageQueue();

    while (messageQueue.hasMessages(sessionId) && !this.isSessionBusy(sessionId)) {
      const queued = messageQueue.dequeue(sessionId);
      if (!queued) break;

      log.info({ sessionId, messageId: queued.id }, "Processing queued message");

      try {
        await this.processMessage(queued.message, queued.agentId, queued.correlationId);
      } catch (err) {
        const errorMsg = (err as Error).message || "Unknown error";
        log.error({ err, sessionId, messageId: queued.id }, "Error processing queued message");

        bus.emit(
          createEvent(
            "agent:error",
            { error: errorMsg, agentId: queued.agentId, sessionId },
            "agent-runner",
            queued.correlationId,
          ),
        );
      }
    }
  }

  /**
   * Process a message through the agent (with busy tracking).
   */
  private async processMessage(
    message: InboundMessage,
    agentId: AgentId,
    correlationId?: string,
  ): Promise<void> {
    const session = this.sessionManager.getOrCreate(
      {
        channelType: message.channelType,
        channelId: message.channelId,
        userId: message.user.id,
      },
      agentId,
    );

    // Create abort controller for this run
    const controller = new AbortController();

    // Mark session as busy
    this.activeRuns.set(session.id, {
      controller,
      agentId,
      startedAt: Date.now(),
      correlationId,
    });

    try {
      await this.handleMessage(message, agentId, correlationId, controller.signal);
    } finally {
      // Mark session as not busy
      this.activeRuns.delete(session.id);
    }
  }

  /**
   * Process an inbound message through the AI agent.
   *
   * Uses streaming: text deltas are emitted in real-time so the user
   * sees the response as it's generated. When the model produces content
   * alongside tool calls (intermediate messages like "let me check that"),
   * those are sent to the user immediately before tools execute.
   */
  private async handleMessage(
    message: InboundMessage,
    agentId: AgentId,
    correlationId?: string,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const provider = this.providers.get(agentId);
    const config = this.configs.get(agentId);

    if (!provider || !config) {
      log.error({ agentId }, "No provider/config for agent");
      return;
    }

    const bus = getEventBus();

    // Get or create session
    const session = this.sessionManager.getOrCreate(
      {
        channelType: message.channelType,
        channelId: message.channelId,
        userId: message.user.id,
      },
      agentId,
    );

    // Helper to check if aborted
    const isAborted = () => abortSignal?.aborted ?? false;

    // Log + add user message to history
    logTranscript(session.id, { role: "user", content: message.content, user: message.user.displayName });
    const userMsg: ChatMessage = {
      id: message.id,
      role: "user",
      content: message.content,
      attachments: message.attachments,
      timestamp: message.timestamp,
    };
    this.sessionManager.addMessage(session.id, userMsg);

    // Emit thinking event
    bus.emit(
      createEvent("agent:thinking", { sessionId: session.id, agentId }, "agent-runner", correlationId),
    );

    // AI agent loop with streaming
    let iterations = 0;
    let history = this.sessionManager.getHistory(session.id);
    const loopStart = Date.now();

    log.info({ sessionId: session.id, historyLen: history.length }, "Starting agent loop");

    while (iterations < MAX_TOOL_ITERATIONS) {
      // Check if aborted before each iteration
      if (isAborted()) {
        log.info({ sessionId: session.id, iterations }, "Agent loop aborted by user");
        return;
      }

      iterations++;
      const iterStart = Date.now();

      // Fetch tools each iteration — extensions may register new tools mid-loop
      const tools = this.toolRegistry.getToolsForAgent(config.tools);

      history = trimHistory(history);
      log.info({ iteration: iterations, historyLen: history.length, toolCount: tools.length }, "Calling LLM (streaming)");

      // ─── Stream the LLM response ────────────────────────────
      let contentAccum = "";
      const toolCalls: ToolCall[] = [];
      let finishReason: string | undefined;
      let isFirstDelta = true;

      const stream = provider.chatStream(history, config, tools);

      for await (const chunk of stream) {
        // Check if aborted during streaming
        if (isAborted()) {
          log.info({ sessionId: session.id, iterations }, "Stream aborted by user");
          bus.emit(
            createEvent(
              "agent:stream_end",
              { sessionId: session.id, agentId, iteration: iterations, aborted: true },
              "agent-runner",
              correlationId,
            ),
          );
          return;
        }

        if (chunk.type === "text" && chunk.content) {
          // Emit stream start on first delta
          if (isFirstDelta) {
            isFirstDelta = false;
            bus.emit(
              createEvent(
                "agent:stream_start",
                { sessionId: session.id, agentId, iteration: iterations },
                "agent-runner",
                correlationId,
              ),
            );
          }

          contentAccum += chunk.content;

          // Stream delta to the user in real-time
          bus.emit(
            createEvent(
              "agent:stream_delta",
              { content: chunk.content, sessionId: session.id, agentId },
              "agent-runner",
              correlationId,
            ),
          );
        } else if (chunk.type === "tool_call" && chunk.toolCall) {
          toolCalls.push(chunk.toolCall as ToolCall);
        } else if (chunk.type === "done") {
          finishReason = chunk.finishReason;
        }
      }

      // End the stream
      bus.emit(
        createEvent(
          "agent:stream_end",
          { sessionId: session.id, agentId, iteration: iterations },
          "agent-runner",
          correlationId,
        ),
      );

      const llmMs = Date.now() - iterStart;
      log.info({
        iteration: iterations,
        llmMs,
        hasToolCalls: toolCalls.length > 0,
        toolCallCount: toolCalls.length,
        contentLen: contentAccum.length,
        finishReason,
      }, "LLM stream complete");

      // ─── Handle tool calls ──────────────────────────────────
      if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          log.info({ tool: tc.name, args: tc.arguments, callId: tc.id }, "Tool call requested");
          logTranscript(session.id, { role: "tool_call", tool: tc.name, args: tc.arguments, callId: tc.id });
        }

        bus.emit(
          createEvent(
            "agent:tool_use",
            { toolCalls, sessionId: session.id },
            "agent-runner",
            correlationId,
          ),
        );

        // If the model produced content alongside tool calls, that's an
        // intermediate message — send it to the user as a separate message.
        // But only if it looks like a real user-facing message, not internal
        // narration like "Let me try fetching from:" or "I'll use the browser:"
        const trimmedContent = contentAccum.trim();
        const narrationPattern = /^(let me |i.ll |i will )(try|use|check|fetch|search|open|navigate)/i;
        const isNarration =
          trimmedContent.endsWith(":") ||          // "Let me try this:" — broken sentence
          trimmedContent.endsWith("...") ||         // "Searching..." — filler
          trimmedContent.length < 10 ||             // Too short to be meaningful
          narrationPattern.test(trimmedContent);    // Internal process narration

        if (trimmedContent && !isNarration) {
          log.info({ iteration: iterations, contentLen: trimmedContent.length }, "Intermediate message from agent");
          logTranscript(session.id, { role: "intermediate", content: trimmedContent });

          bus.emit(
            createEvent(
              "agent:intermediate",
              { content: trimmedContent, sessionId: session.id, agentId },
              "agent-runner",
              correlationId,
            ),
          );

          // Also send to channel adapters (Discord, Telegram, etc.)
          if (message.channelType !== "webchat") {
            bus.emit(
              createEvent(
                "message:outbound",
                {
                  id: genMessageId(),
                  sessionId: session.id,
                  channelType: message.channelType,
                  channelId: message.channelId,
                  content: trimmedContent,
                  attachments: [],
                  replyToId: message.id,
                },
                "agent-runner",
                correlationId,
              ),
            );
          }
        } else if (trimmedContent) {
          log.debug({ iteration: iterations, content: trimmedContent.slice(0, 80) }, "Filtered out narration intermediate");
          logTranscript(session.id, { role: "intermediate_filtered", content: trimmedContent });
        }

        // Add assistant message with tool calls to history
        const assistantMsg: ChatMessage = {
          id: genMessageId(),
          role: "assistant",
          content: contentAccum,
          attachments: [],
          toolCalls,
          timestamp: Date.now(),
        };
        this.sessionManager.addMessage(session.id, assistantMsg);

        // Check if aborted before tool execution
        if (isAborted()) {
          log.info({ sessionId: session.id, iterations }, "Aborted before tool execution");
          return;
        }

        // Execute tools
        const toolStart = Date.now();
        const results = await this.executeTools(toolCalls, isAborted);
        const toolMs = Date.now() - toolStart;

        // Check if aborted during tool execution
        if (isAborted()) {
          log.info({ sessionId: session.id, iterations }, "Aborted during tool execution");
          return;
        }

        for (const r of results) {
          log.info({
            callId: r.toolCallId,
            isError: r.isError || false,
            outputLen: r.output.length,
            outputPreview: r.output.slice(0, 200),
          }, "Tool result");
        }
        log.info({ toolMs, resultCount: results.length }, "All tools executed");
        for (const r of results) {
          logTranscript(session.id, { role: "tool_result", callId: r.toolCallId, isError: r.isError, output: r.output.slice(0, 500) });
        }

        // Add tool results to history
        const toolMsg: ChatMessage = {
          id: genMessageId(),
          role: "tool",
          content: results.map((r) => `[${r.toolCallId}]: ${r.output}`).join("\n"),
          attachments: [],
          toolResults: results,
          timestamp: Date.now(),
        };
        this.sessionManager.addMessage(session.id, toolMsg);

        // Continue the loop — model will see tool results
        history = this.sessionManager.getHistory(session.id);
        continue;
      }

      // ─── Final response (no tool calls) ─────────────────────
      if (finishReason === "max_tokens" && !contentAccum.trim()) {
        log.warn({ iteration: iterations }, "LLM hit max_tokens with empty content — aborting");
        contentAccum = "[The AI ran out of output space before finishing its response. Try a simpler or shorter request.]";
      }

      const totalMs = Date.now() - loopStart;
      log.info({ iterations, totalMs, contentLen: contentAccum.length }, "Agent loop complete — final response");
      logTranscript(session.id, { role: "assistant", content: contentAccum, iterations, totalMs });

      const assistantMsg: ChatMessage = {
        id: genMessageId(),
        role: "assistant",
        content: contentAccum,
        attachments: [],
        timestamp: Date.now(),
      };
      this.sessionManager.addMessage(session.id, assistantMsg);

      // Emit final response (used by daily log, channel adapters, etc.)
      bus.emit(
        createEvent(
          "agent:response",
          {
            content: contentAccum,
            sessionId: session.id,
            agentId,
          },
          "agent-runner",
          correlationId,
        ),
      );

      // Send to channel adapters (not webchat — handled via WS)
      if (message.channelType !== "webchat") {
        bus.emit(
          createEvent(
            "message:outbound",
            {
              id: genMessageId(),
              sessionId: session.id,
              channelType: message.channelType,
              channelId: message.channelId,
              content: contentAccum,
              attachments: [],
              replyToId: message.id,
            },
            "agent-runner",
            correlationId,
          ),
        );
      }

      break;
    }

    if (iterations >= MAX_TOOL_ITERATIONS) {
      const totalMs = Date.now() - loopStart;
      log.warn({ sessionId: session.id, iterations, totalMs }, "Agent hit max tool iterations — forcing stop");

      bus.emit(
        createEvent(
          "agent:response",
          {
            content: "[Agent reached maximum tool iterations. Please try a simpler request.]",
            sessionId: session.id,
            agentId,
          },
          "agent-runner",
          correlationId,
        ),
      );
    }
  }

  /**
   * Execute tool calls and return results.
   */
  private async executeTools(
    toolCalls: ToolCall[],
    isAborted: () => boolean = () => false,
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      // Check if aborted before each tool
      if (isAborted()) {
        log.info({ tool: call.name }, "Tool execution skipped - aborted");
        results.push({
          toolCallId: call.id,
          output: "[Skipped - request cancelled]",
          isError: true,
        });
        continue;
      }

      try {
        const tool = this.toolRegistry.getTool(call.name);
        if (!tool) {
          results.push({
            toolCallId: call.id,
            output: `Error: Tool "${call.name}" not found`,
            isError: true,
          });
          continue;
        }

        log.info({ tool: call.name, args: call.arguments }, "Executing tool");
        const result = await tool.handler(call.arguments);
        results.push({ ...result, toolCallId: call.id });
      } catch (err) {
        log.error({ err, tool: call.name }, "Tool execution failed");
        results.push({
          toolCallId: call.id,
          output: `Error: ${(err as Error).message}`,
          isError: true,
        });
      }
    }

    return results;
  }

  /**
   * Get stats about active runs and queued messages.
   */
  getStats(): { activeRuns: number; queueStats: ReturnType<typeof getMessageQueue.prototype.getStats> } {
    return {
      activeRuns: this.activeRuns.size,
      queueStats: getMessageQueue().getStats(),
    };
  }
}
