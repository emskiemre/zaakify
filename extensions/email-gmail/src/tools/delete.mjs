/**
 * gmail-delete tool implementation
 */

import { createGmailClient, trashMessage, deleteMessage } from "../client.mjs";
import { handleApiError, validateParams } from "../utils/errors.mjs";

export async function handleDelete(params, config) {
  try {
    validateParams(params, ["account", "messageId"]);
    
    const {
      account,
      messageId,
      permanent = false,
    } = params;
    
    // Create client
    const gmail = await createGmailClient(config);
    
    if (permanent) {
      // Permanently delete
      await deleteMessage(gmail, messageId);
      
      return [
        `Message permanently deleted!`,
        ``,
        `Account: ${account}`,
        `Message ID: ${messageId}`,
        ``,
        `⚠️ This action cannot be undone.`,
      ].join("\n");
    } else {
      // Move to trash
      await trashMessage(gmail, messageId);
      
      return [
        `Message moved to trash!`,
        ``,
        `Account: ${account}`,
        `Message ID: ${messageId}`,
        ``,
        `The message can be recovered from trash within 30 days.`,
      ].join("\n");
    }
    
  } catch (error) {
    return handleApiError(error, "gmail-delete");
  }
}

export const toolDefinition = {
  name: "gmail-delete",
  description: "Delete or trash a Gmail message. Can either move to trash (recoverable) or permanently delete.",
  parameters: {
    account: {
      type: "string",
      description: "Gmail account email address",
      required: true,
    },
    messageId: {
      type: "string",
      description: "Message ID to delete",
      required: true,
    },
    permanent: {
      type: "boolean",
      description: "If true, permanently delete. If false (default), move to trash (recoverable for 30 days)",
      required: false,
    },
  },
};
