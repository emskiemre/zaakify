/**
 * gmail-reply tool implementation
 */

import { createGmailClient, sendMessage, getMessage, getUserProfile } from "../client.mjs";
import { createReplyMessage } from "../utils/mime.mjs";
import { handleApiError, validateParams } from "../utils/errors.mjs";

export async function handleReply(params, config) {
  try {
    validateParams(params, ["account", "messageId", "body"]);
    
    const { account, messageId, body } = params;
    
    // Create client
    const gmail = await createGmailClient(config);
    
    // Get original message to extract headers
    const originalMessage = await getMessage(gmail, messageId);
    
    // Get headers from original message
    const headers = originalMessage.payload.headers;
    const getHeader = (name) => {
      const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
      return header ? header.value : "";
    };
    
    const originalFrom = getHeader("From");
    const originalSubject = getHeader("Subject");
    const originalMessageId = getHeader("Message-ID");
    const originalReferences = getHeader("References");
    
    // Extract email from "From" header (remove name if present)
    const toAddress = originalFrom.match(/<(.+?)>/) ? originalFrom.match(/<(.+?)>/)[1] : originalFrom;
    
    // Build References header for threading
    const references = originalReferences
      ? `${originalReferences} ${originalMessageId}`
      : originalMessageId;
    
    // Get user profile for "from" address
    const profile = await getUserProfile(gmail);
    const from = profile.emailAddress;
    
    // Create reply MIME message
    const rawMessage = createReplyMessage({
      from,
      to: toAddress,
      subject: originalSubject,
      body,
      inReplyTo: originalMessageId,
      references,
    });
    
    // Send reply
    const result = await sendMessage(gmail, rawMessage);
    
    return [
      `Reply sent successfully!`,
      ``,
      `From: ${from}`,
      `To: ${toAddress}`,
      `Subject: ${originalSubject.startsWith("Re:") ? originalSubject : "Re: " + originalSubject}`,
      `In reply to: ${messageId}`,
      `Message ID: ${result.id}`,
      `Thread ID: ${result.threadId}`,
    ].join("\n");
    
  } catch (error) {
    return handleApiError(error, "gmail-reply");
  }
}

export const toolDefinition = {
  name: "gmail-reply",
  description: "Reply to an existing Gmail message. Maintains email threading and references.",
  parameters: {
    account: {
      type: "string",
      description: "Gmail account email address",
      required: true,
    },
    messageId: {
      type: "string",
      description: "Message ID to reply to (from gmail-list or gmail-read)",
      required: true,
    },
    body: {
      type: "string",
      description: "Reply message body (plain text)",
      required: true,
    },
  },
};
