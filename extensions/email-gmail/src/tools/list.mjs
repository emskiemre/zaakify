/**
 * gmail-list tool implementation
 */

import { createGmailClient, listMessages } from "../client.mjs";
import { formatMessageList } from "../utils/formatters.mjs";
import { handleApiError, validateParams } from "../utils/errors.mjs";

export async function handleList(params, config) {
  try {
    validateParams(params, ["account"]);
    
    const {
      account,
      label = "INBOX",
      maxResults = 10,
      query = "",
    } = params;
    
    // Validate maxResults range
    const limit = Math.max(1, Math.min(100, parseInt(maxResults) || 10));
    
    // Create client
    const gmail = await createGmailClient(config);
    
    // List messages
    const messages = await listMessages(gmail, {
      labelIds: [label],
      maxResults: limit,
      query,
    });
    
    if (messages.length === 0) {
      return `No messages found in ${label}.`;
    }
    
    const header = [
      `Gmail: ${account}`,
      `Label: ${label}`,
      `Found ${messages.length} message(s)`,
      "",
    ].join("\n");
    
    return header + formatMessageList(messages);
    
  } catch (error) {
    return handleApiError(error, "gmail-list");
  }
}

export const toolDefinition = {
  name: "gmail-list",
  description: "List emails from Gmail inbox or a specific label. Returns message summaries with sender, subject, date, and preview.",
  parameters: {
    account: {
      type: "string",
      description: "Gmail account email address",
      required: true,
    },
    label: {
      type: "string",
      description: 'Label to list from. Options: INBOX (default), SENT, DRAFT, SPAM, TRASH, STARRED, IMPORTANT, or custom label',
      required: false,
    },
    maxResults: {
      type: "number",
      description: "Maximum number of messages to return (1-100, default: 10)",
      required: false,
    },
    query: {
      type: "string",
      description: "Gmail search query (e.g., 'from:example@gmail.com subject:urgent')",
      required: false,
    },
  },
};
