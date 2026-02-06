/**
 * OpenAI Format Helpers — shared message and tool conversion.
 *
 * Used by both chat() and chatStream() in the Z.AI provider
 * to avoid duplication.
 */

import type { ChatMessage, AgentConfig, ToolDefinition } from "../types/index.js";

/**
 * Convert internal ChatMessage array to OpenAI message format.
 */
export function formatMessages(
  messages: ChatMessage[],
  config: AgentConfig,
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];

  if (config.systemPrompt) {
    result.push({ role: "system", content: config.systemPrompt });
  }

  for (const m of messages) {
    if (m.role === "system") continue;

    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      result.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      });
    } else if (m.role === "tool" && m.toolResults && m.toolResults.length > 0) {
      for (const r of m.toolResults) {
        result.push({
          role: "tool",
          tool_call_id: r.toolCallId,
          content: r.output,
        });
      }
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }

  return result;
}

/**
 * Convert internal ToolDefinition array to OpenAI function-call format.
 */
export function formatTools(
  tools: ToolDefinition[] | undefined,
): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}> | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object" as const,
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([key, param]) => [
            key,
            {
              type: param.type,
              description: param.description,
              ...(param.enum ? { enum: param.enum } : {}),
            },
          ]),
        ),
        required: t.requiredParams,
      },
    },
  }));
}
