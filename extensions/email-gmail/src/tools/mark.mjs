/**
 * gmail-mark tool implementation
 */

import { createGmailClient, modifyMessage } from "../client.mjs";
import { handleApiError, validateParams } from "../utils/errors.mjs";

export async function handleMark(params, config) {
  try {
    validateParams(params, ["account", "messageId"]);
    
    const {
      account,
      messageId,
      read,
      starred,
    } = params;
    
    // Ensure at least one action is specified
    if (read === undefined && starred === undefined) {
      return "Error: Must specify at least one of: read, starred";
    }
    
    // Create client
    const gmail = await createGmailClient(config);
    
    // Build label modifications
    const addLabels = [];
    const removeLabels = [];
    
    if (read === true) {
      removeLabels.push("UNREAD");
    } else if (read === false) {
      addLabels.push("UNREAD");
    }
    
    if (starred === true) {
      addLabels.push("STARRED");
    } else if (starred === false) {
      removeLabels.push("STARRED");
    }
    
    // Modify message
    const result = await modifyMessage(gmail, messageId, {
      addLabels,
      removeLabels,
    });
    
    const actions = [];
    if (read !== undefined) {
      actions.push(`Marked as ${read ? "read" : "unread"}`);
    }
    if (starred !== undefined) {
      actions.push(`${starred ? "Starred" : "Unstarred"}`);
    }
    
    return [
      `Message updated successfully!`,
      ``,
      `Account: ${account}`,
      `Message ID: ${messageId}`,
      ``,
      ...actions,
      ``,
      `Current labels: ${result.labelIds.join(", ")}`,
    ].join("\n");
    
  } catch (error) {
    return handleApiError(error, "gmail-mark");
  }
}

export const toolDefinition = {
  name: "gmail-mark",
  description: "Mark a Gmail message as read/unread or star/unstar it. Use this to manage message status.",
  parameters: {
    account: {
      type: "string",
      description: "Gmail account email address",
      required: true,
    },
    messageId: {
      type: "string",
      description: "Message ID to mark",
      required: true,
    },
    read: {
      type: "boolean",
      description: "Mark as read (true) or unread (false). Omit to not change read status",
      required: false,
    },
    starred: {
      type: "boolean",
      description: "Star (true) or unstar (false) the message. Omit to not change starred status",
      required: false,
    },
  },
};
