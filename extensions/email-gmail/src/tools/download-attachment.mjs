/**
 * gmail-download-attachment tool implementation
 */

import { createGmailClient, getMessage, getAttachment } from "../client.mjs";
import { handleApiError, validateParams } from "../utils/errors.mjs";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export async function handleDownloadAttachment(params, config) {
  try {
    validateParams(params, ["account", "messageId", "attachmentId"]);
    
    const { account, messageId, attachmentId, savePath } = params;
    
    // Create client
    const gmail = await createGmailClient(config);
    
    // Get message to find attachment filename
    const message = await getMessage(gmail, messageId);
    
    // Find the attachment in message parts
    let attachmentInfo = null;
    function findAttachment(parts) {
      if (!parts) return;
      for (const part of parts) {
        if (part.body && part.body.attachmentId === attachmentId) {
          attachmentInfo = {
            filename: part.filename || "attachment",
            mimeType: part.mimeType,
            size: part.body.size || 0,
          };
          return;
        }
        if (part.parts) {
          findAttachment(part.parts);
        }
      }
    }
    
    if (message.payload.parts) {
      findAttachment(message.payload.parts);
    }
    
    if (!attachmentInfo) {
      return `Error: Attachment ${attachmentId} not found in message ${messageId}`;
    }
    
    // Get attachment data
    const attachmentData = await getAttachment(gmail, messageId, attachmentId);
    
    // Decode base64 data
    const buffer = Buffer.from(attachmentData.data, "base64url");
    
    // Determine save location
    const downloadsDir = join(homedir(), ".bitqlon", "drive", "downloads");
    
    // Create downloads directory if it doesn't exist
    if (!existsSync(downloadsDir)) {
      mkdirSync(downloadsDir, { recursive: true });
    }
    
    // Use custom path or default to downloads directory
    const targetPath = savePath || join(downloadsDir, attachmentInfo.filename);
    
    // Save the file
    writeFileSync(targetPath, buffer);
    
    // Format size
    const formatBytes = (bytes) => {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
    };
    
    return [
      `✓ Attachment downloaded successfully`,
      ``,
      `File: ${attachmentInfo.filename}`,
      `Type: ${attachmentInfo.mimeType}`,
      `Size: ${formatBytes(buffer.length)}`,
      `Saved to: ${targetPath}`,
      ``,
      `You can now read, process, or share this file.`,
    ].join("\n");
    
  } catch (error) {
    return handleApiError(error, "gmail-download-attachment");
  }
}

export const toolDefinition = {
  name: "gmail-download-attachment",
  description: "Download an attachment from a Gmail message and save it to disk. The attachment will be saved to ~/.bitqlon/drive/downloads/ by default. Get the attachmentId from gmail-read output.",
  parameters: {
    account: {
      type: "string",
      description: "Gmail account email address",
      required: true,
    },
    messageId: {
      type: "string",
      description: "Message ID containing the attachment (from gmail-list or gmail-search)",
      required: true,
    },
    attachmentId: {
      type: "string",
      description: "Attachment ID to download (from gmail-read output)",
      required: true,
    },
    savePath: {
      type: "string",
      description: "Optional: Custom path to save the file. If not provided, saves to ~/.bitqlon/drive/downloads/[filename]",
      required: false,
    },
  },
};
