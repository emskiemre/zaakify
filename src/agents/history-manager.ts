/**
 * History Manager — trims conversation history to fit the context window.
 */

import type { ChatMessage } from "../types/index.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger("history");

/**
 * Rough character-based context limit. Claude supports 200K tokens,
 * but we cap at ~400K chars (~100K tokens) to leave room for the system
 * prompt and tool definitions. Older messages get trimmed from the front.
 * 
 * Token estimation: ~4 characters per token on average
 */
const MAX_HISTORY_CHARS = 400_000;

/**
 * Trim history to stay within context budget.
 * Removes oldest messages (preserving the first user message for context).
 */
export function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  let totalChars = 0;
  for (const m of messages) {
    totalChars += m.content.length;
  }
  if (totalChars <= MAX_HISTORY_CHARS) return messages;

  // Keep removing from the front (after position 0) until under budget
  const trimmed = [...messages];
  while (totalChars > MAX_HISTORY_CHARS && trimmed.length > 2) {
    const removed = trimmed.splice(1, 1)[0]; // remove second message (keep first)
    totalChars -= removed.content.length;
  }
  log.info({ original: messages.length, trimmed: trimmed.length, chars: totalChars }, "History trimmed to fit context window");
  return trimmed;
}
