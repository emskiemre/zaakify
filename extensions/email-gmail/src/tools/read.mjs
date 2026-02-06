/**
 * gmail-read tool implementation
 */

import { createGmailClient, getMessage } from "../client.mjs";
import { formatMessageDetails } from "../utils/formatters.mjs";
import { handleApiError, validateParams } from "../utils/errors.mjs";

export async function handleRead(params, config) {
  try {
    validateParams(params, ["account", "messageId"]);
    
    const { account, messageId } = params;
    
    // Create client
    const gmail = await createGmailClient(config);
    
    // Get message
    const message = await getMessage(gmail, messageId);
    
    const header = [
      `Gmail: ${account}`,
      "",
    ].join("\n");
    
    return header + formatMessageDetails(message);
    
  } catch (error) {
    return handleApiError(error, "gmail-read");
  }
}

export const toolDefinition = {
  name: "gmail-read",
  description: "Read a specific Gmail message by ID. Returns full message content including headers, body, and metadata.",
  parameters: {
    account: {
      type: "string",
      description: "Gmail account email address",
      required: true,
    },
    messageId: {
      type: "string",
      description: "Message ID to read (from gmail-list or gmail-search)",
      required: true,
    },
  },
};
