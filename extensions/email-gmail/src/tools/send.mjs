/**
 * gmail-send tool implementation
 */

import { createGmailClient, sendMessage, getUserProfile } from "../client.mjs";
import { createMimeMessage } from "../utils/mime.mjs";
import { handleApiError, validateParams } from "../utils/errors.mjs";

export async function handleSend(params, config) {
  try {
    validateParams(params, ["account", "to", "subject", "body"]);
    
    const { account, to, subject, body, cc, bcc } = params;
    
    // Create client
    const gmail = await createGmailClient(config);
    
    // Get user profile to get the "from" address
    const profile = await getUserProfile(gmail);
    const from = profile.emailAddress;
    
    // Create MIME message
    const rawMessage = createMimeMessage({
      from,
      to,
      subject,
      body,
      cc,
      bcc,
    });
    
    // Send message
    const result = await sendMessage(gmail, rawMessage);
    
    return [
      `Email sent successfully!`,
      ``,
      `From: ${from}`,
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Subject: ${subject}`,
      `Message ID: ${result.id}`,
      `Thread ID: ${result.threadId}`,
    ].join("\n");
    
  } catch (error) {
    return handleApiError(error, "gmail-send");
  }
}

export const toolDefinition = {
  name: "gmail-send",
  description: "Send a new email via Gmail. Composes and sends a message with optional CC and BCC recipients.",
  parameters: {
    account: {
      type: "string",
      description: "Gmail account email address (sender)",
      required: true,
    },
    to: {
      type: "string",
      description: "Recipient email address",
      required: true,
    },
    subject: {
      type: "string",
      description: "Email subject line",
      required: true,
    },
    body: {
      type: "string",
      description: "Email body content (plain text)",
      required: true,
    },
    cc: {
      type: "string",
      description: "CC recipients (optional, comma-separated)",
      required: false,
    },
    bcc: {
      type: "string",
      description: "BCC recipients (optional, comma-separated)",
      required: false,
    },
  },
};
