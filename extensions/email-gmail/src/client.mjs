/**
 * Gmail API client wrapper
 */

import { google } from "googleapis";
import { getAuthenticatedClient } from "./oauth.mjs";

/**
 * Create Gmail API client
 */
export async function createGmailClient(config) {
  const auth = await getAuthenticatedClient(config);
  return google.gmail({ version: "v1", auth });
}

/**
 * List messages from a label
 */
export async function listMessages(gmail, { labelIds = ["INBOX"], maxResults = 10, query = "" }) {
  const params = {
    userId: "me",
    labelIds,
    maxResults,
  };
  
  if (query) {
    params.q = query;
  }
  
  const response = await gmail.users.messages.list(params);
  const messages = response.data.messages || [];
  
  // Fetch full message details for each
  const fullMessages = await Promise.all(
    messages.map(msg => gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "full",
    }))
  );
  
  return fullMessages.map(res => res.data);
}

/**
 * Get a single message by ID
 */
export async function getMessage(gmail, messageId) {
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  
  return response.data;
}

/**
 * Send a message
 */
export async function sendMessage(gmail, rawMessage) {
  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: rawMessage,
    },
  });
  
  return response.data;
}

/**
 * Modify message labels
 */
export async function modifyMessage(gmail, messageId, { addLabels = [], removeLabels = [] }) {
  const response = await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: addLabels,
      removeLabelIds: removeLabels,
    },
  });
  
  return response.data;
}

/**
 * Trash a message
 */
export async function trashMessage(gmail, messageId) {
  const response = await gmail.users.messages.trash({
    userId: "me",
    id: messageId,
  });
  
  return response.data;
}

/**
 * Permanently delete a message
 */
export async function deleteMessage(gmail, messageId) {
  await gmail.users.messages.delete({
    userId: "me",
    id: messageId,
  });
  
  return { success: true };
}

/**
 * Search messages
 */
export async function searchMessages(gmail, { query, maxResults = 20 }) {
  return await listMessages(gmail, {
    labelIds: [], // Search all
    maxResults,
    query,
  });
}

/**
 * Get user profile (email address)
 */
export async function getUserProfile(gmail) {
  const response = await gmail.users.getProfile({
    userId: "me",
  });
  
  return response.data;
}

/**
 * Get attachment data from a message
 */
export async function getAttachment(gmail, messageId, attachmentId) {
  const response = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId: messageId,
    id: attachmentId,
  });
  
  return response.data;
}
