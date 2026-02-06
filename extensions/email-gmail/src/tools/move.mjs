/**
 * gmail-move tool implementation
 */

import { createGmailClient, modifyMessage } from "../client.mjs";
import { handleApiError, validateParams } from "../utils/errors.mjs";

export async function handleMove(params, config) {
  try {
    validateParams(params, ["account", "messageId"]);
    
    const {
      account,
      messageId,
      addLabels = [],
      removeLabels = [],
    } = params;
    
    // Ensure at least one label action
    if (addLabels.length === 0 && removeLabels.length === 0) {
      return "Error: Must specify at least one of addLabels or removeLabels";
    }
    
    // Create client
    const gmail = await createGmailClient(config);
    
    // Modify message labels
    const result = await modifyMessage(gmail, messageId, {
      addLabels,
      removeLabels,
    });
    
    const actions = [];
    if (addLabels.length > 0) {
      actions.push(`Added labels: ${addLabels.join(", ")}`);
    }
    if (removeLabels.length > 0) {
      actions.push(`Removed labels: ${removeLabels.join(", ")}`);
    }
    
    return [
      `Message labels updated successfully!`,
      ``,
      `Account: ${account}`,
      `Message ID: ${messageId}`,
      ``,
      ...actions,
      ``,
      `Current labels: ${result.labelIds.join(", ")}`,
    ].join("\n");
    
  } catch (error) {
    return handleApiError(error, "gmail-move");
  }
}

export const toolDefinition = {
  name: "gmail-move",
  description: "Move or organize Gmail messages by adding/removing labels. Use this to archive, mark as important, or apply custom labels.",
  parameters: {
    account: {
      type: "string",
      description: "Gmail account email address",
      required: true,
    },
    messageId: {
      type: "string",
      description: "Message ID to modify",
      required: true,
    },
    addLabels: {
      type: "array",
      description: 'Labels to add (e.g., ["IMPORTANT", "Label_123"]). Common labels: INBOX, STARRED, IMPORTANT, SPAM, TRASH',
      required: false,
    },
    removeLabels: {
      type: "array",
      description: 'Labels to remove (e.g., ["INBOX", "UNREAD"]). Use ["INBOX"] to archive',
      required: false,
    },
  },
};
