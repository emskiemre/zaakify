/**
 * Zaakify AI Provider — Z.AI (GLM) Only
 *
 * Uses the OpenAI-compatible API at https://api.z.ai/api/paas/v4/
 * with the GLM-4.7 model family. Simple API key auth, no OAuth nonsense.
 */

import type {
  AgentConfig,
  AgentResponse,
  ChatMessage,
  ToolDefinition,
  ToolCall,
} from "../types/index.js";
import { getLogger } from "../utils/logger.js";
import { formatMessages, formatTools } from "./format-openai.js";

const log = getLogger("provider");

/** Z.AI OpenAI-compatible base URL (coding endpoint — works with GLM Coding Plan subscription) */
const ZAI_BASE_URL = "https://api.z.ai/api/coding/paas/v4";

/**
 * AI Provider interface.
 */
export interface AIProvider {
  readonly name: string;

  chat(
    messages: ChatMessage[],
    config: AgentConfig,
    tools?: ToolDefinition[],
  ): Promise<AgentResponse>;

  chatStream(
    messages: ChatMessage[],
    config: AgentConfig,
    tools?: ToolDefinition[], 
  ): AsyncIterable<AgentStreamChunk>;

  healthCheck(): Promise<boolean>;
}

export interface AgentStreamChunk {
  type: "text" | "tool_call" | "done";
  content?: string;
  toolCall?: ToolCall;
  finishReason?: "stop" | "tool_use" | "max_tokens";
}

/**
 * Z.AI (GLM) provider.
 *
 * Uses the OpenAI SDK pointed at Z.AI's base URL.
 * Supports GLM-4.7, GLM-4.7-FlashX, GLM-4.7-Flash (free), etc.
 *
 * IMPORTANT: GLM-4.7 is a reasoning model. It produces internal
 * "reasoning_content" that counts toward max_tokens. The actual
 * visible "content" only appears after reasoning is done. If
 * max_tokens is too low, all tokens go to reasoning and the
 * response comes back empty. We set a high default (32768) to
 * give the model room for both reasoning and response.
 */
export class ZaiProvider implements AIProvider {
  readonly name = "zai";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    log.info("Z.AI provider initialized");
  }

  private async getClient() {
    const { default: OpenAI } = await import("openai");
    return new OpenAI({
      apiKey: this.apiKey,
      baseURL: ZAI_BASE_URL,
    });
  }

  async chat(
    messages: ChatMessage[],
    config: AgentConfig,
    tools?: ToolDefinition[],
  ): Promise<AgentResponse> {
    const client = await this.getClient();

    const openaiMessages = formatMessages(messages, config);
    const openaiTools = formatTools(tools);

    const response = await client.chat.completions.create({
      model: config.model,
      messages: openaiMessages as unknown as Parameters<typeof client.chat.completions.create>[0]["messages"],
      temperature: config.temperature,
      max_tokens: config.maxTokens || 32768,
      tools: openaiTools,
    });

    const choice = response.choices[0];

    // GLM-4.7 reasoning model: log reasoning token usage
    const reasoning = (choice.message as unknown as Record<string, unknown>).reasoning_content as string | undefined;
    if (reasoning) {
      log.debug({ reasoningLen: reasoning.length, reasoningPreview: reasoning.slice(0, 200) }, "LLM reasoning content");
    }
    const reasoningTokens = (response.usage as unknown as Record<string, unknown>)?.completion_tokens_details as Record<string, unknown> | undefined;
    if (reasoningTokens?.reasoning_tokens) {
      log.info({ reasoningTokens: reasoningTokens.reasoning_tokens, completionTokens: response.usage?.completion_tokens }, "Token breakdown");
    }

    const toolCalls: ToolCall[] =
      choice.message.tool_calls?.map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch (err) {
          log.warn({ toolName: tc.function.name, rawArgs: tc.function.arguments, err }, "Failed to parse tool call arguments");
        }
        return {
          id: tc.id,
          toolId: "" as never,
          name: tc.function.name,
          arguments: args,
        };
      }) ?? [];

    return {
      content: choice.message.content || "",
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens ?? 0,
          }
        : undefined,
      finishReason:
        choice.finish_reason === "tool_calls"
          ? "tool_use"
          : choice.finish_reason === "length"
            ? "max_tokens"
            : "stop",
    };
  }

  async *chatStream(
    messages: ChatMessage[],
    config: AgentConfig,
    tools?: ToolDefinition[],
  ): AsyncIterable<AgentStreamChunk> {
    const client = await this.getClient();

    const openaiMessages = formatMessages(messages, config);
    const openaiTools = formatTools(tools);

    const stream = await client.chat.completions.create({
      model: config.model,
      messages: openaiMessages as unknown as Parameters<typeof client.chat.completions.create>[0]["messages"],
      temperature: config.temperature,
      max_tokens: config.maxTokens || 32768,
      tools: openaiTools,
      stream: true,
    });

    // Track tool calls being assembled from deltas
    const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // Text content delta
      if (delta.content) {
        yield { type: "text", content: delta.content };
      }

      // Tool call deltas — OpenAI streams these in parts
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;

          if (!pendingToolCalls.has(idx)) {
            // New tool call starting
            pendingToolCalls.set(idx, {
              id: tc.id || "",
              name: tc.function?.name || "",
              args: tc.function?.arguments || "",
            });
          } else {
            // Append to existing tool call
            const pending = pendingToolCalls.get(idx)!;
            if (tc.id) pending.id = tc.id;
            if (tc.function?.name) pending.name += tc.function.name;
            if (tc.function?.arguments) pending.args += tc.function.arguments;
          }
        }
      }

      // Check finish reason
      const finishReason = chunk.choices[0]?.finish_reason;
      if (finishReason === "tool_calls" || finishReason === "stop") {
        break;
      }
    }

    // Yield completed tool calls
    for (const [_, tc] of pendingToolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.args);
      } catch {
        log.warn({ toolName: tc.name, rawArgs: tc.args }, "Failed to parse streamed tool call args");
      }

      yield {
        type: "tool_call",
        toolCall: {
          id: tc.id,
          toolId: "" as never,
          name: tc.name,
          arguments: args,
        },
      };
    }

    yield { type: "done", finishReason: pendingToolCalls.size > 0 ? "tool_use" : "stop" };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.getClient();
      await client.chat.completions.create({
        model: "glm-4.7-flash",
        max_tokens: 10,
        messages: [{ role: "user", content: "ping" }],
      });
      return true;
    } catch (err) {
      log.error({ err }, "Z.AI health check failed");
      return false;
    }
  }
}

/**
 * Provider factory. Z.AI only.
 */
export function createProvider(
  _provider: string,
  agentConfig: { apiKey?: string },
): AIProvider {
  const apiKey = agentConfig.apiKey || process.env.ZAI_API_KEY || "";
  if (!apiKey) {
    log.error("No Z.AI API key configured");
  }
  return new ZaiProvider(apiKey);
}
