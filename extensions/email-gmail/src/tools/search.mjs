/**
 * gmail-search tool implementation
 */

import { createGmailClient, searchMessages } from "../client.mjs";
import { formatMessageList } from "../utils/formatters.mjs";
import { handleApiError, validateParams } from "../utils/errors.mjs";

export async function handleSearch(params, config) {
  try {
    validateParams(params, ["account", "query"]);
    
    const {
      account,
      query,
      maxResults = 20,
    } = params;
    
    // Validate maxResults range
    const limit = Math.max(1, Math.min(100, parseInt(maxResults) || 20));
    
    // Create client
    const gmail = await createGmailClient(config);
    
    // Search messages
    const messages = await searchMessages(gmail, {
      query,
      maxResults: limit,
    });
    
    if (messages.length === 0) {
      return `No messages found matching query: "${query}"`;
    }
    
    const header = [
      `Gmail: ${account}`,
      `Search query: "${query}"`,
      `Found ${messages.length} message(s)`,
      "",
    ].join("\n");
    
    return header + formatMessageList(messages);
    
  } catch (error) {
    return handleApiError(error, "gmail-search");
  }
}

export const toolDefinition = {
  name: "gmail-search",
  description: "Search Gmail messages using Gmail query syntax. Supports searching by sender, subject, date, labels, and more.",
  parameters: {
    account: {
      type: "string",
      description: "Gmail account email address",
      required: true,
    },
    query: {
      type: "string",
      description: 'Gmail search query. Examples: "from:john@example.com", "subject:meeting", "has:attachment", "after:2024/01/01"',
      required: true,
    },
    maxResults: {
      type: "number",
      description: "Maximum number of results to return (1-100, default: 20)",
      required: false,
    },
  },
};
