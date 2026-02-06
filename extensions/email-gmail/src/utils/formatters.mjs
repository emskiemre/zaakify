/**
 * Email message formatting utilities
 */

/**
 * Format a list of messages for display
 */
export function formatMessageList(messages) {
  if (!messages || messages.length === 0) {
    return "No messages found.";
  }

  const formatted = messages.map((msg, index) => {
    return formatMessageSummary(msg, index + 1);
  });

  return formatted.join("\n\n");
}

/**
 * Format a single message summary (for list view)
 */
export function formatMessageSummary(message, index) {
  const from = getHeader(message, "From") || "Unknown";
  const subject = getHeader(message, "Subject") || "(No subject)";
  const date = getHeader(message, "Date") || "";
  const snippet = message.snippet || "";
  
  const labels = message.labelIds || [];
  const isUnread = labels.includes("UNREAD");
  const isStarred = labels.includes("STARRED");
  
  const flags = [];
  if (isUnread) flags.push("UNREAD");
  if (isStarred) flags.push("⭐");
  
  const flagStr = flags.length > 0 ? `[${flags.join(" ")}] ` : "";
  
  return [
    `${index}. ${flagStr}${subject}`,
    `   From: ${from}`,
    `   Date: ${formatDate(date)}`,
    `   ID: ${message.id}`,
    `   Preview: ${snippet.slice(0, 100)}${snippet.length > 100 ? "..." : ""}`,
  ].join("\n");
}

/**
 * Format full message details (for read view)
 */
export function formatMessageDetails(message) {
  const from = getHeader(message, "From") || "Unknown";
  const to = getHeader(message, "To") || "";
  const cc = getHeader(message, "Cc") || "";
  const subject = getHeader(message, "Subject") || "(No subject)";
  const date = getHeader(message, "Date") || "";
  const messageId = getHeader(message, "Message-ID") || message.id;
  
  const labels = message.labelIds || [];
  const body = getMessageBody(message);
  const attachments = extractAttachments(message);
  
  const parts = [
    `Message ID: ${message.id}`,
    `Subject: ${subject}`,
    `From: ${from}`,
    `To: ${to}`,
  ];
  
  if (cc) parts.push(`Cc: ${cc}`);
  parts.push(`Date: ${formatDate(date)}`);
  parts.push(`Labels: ${labels.join(", ") || "None"}`);
  parts.push(`Message-ID: ${messageId}`);
  
  // Add attachments section if any exist
  if (attachments.length > 0) {
    parts.push("");
    parts.push("--- Attachments ---");
    attachments.forEach((att, idx) => {
      parts.push(`${idx + 1}. ${att.filename} (${formatBytes(att.size)}) [${att.mimeType}]`);
      parts.push(`   Attachment ID: ${att.attachmentId}`);
    });
  }
  
  parts.push("");
  parts.push("--- Message Body ---");
  parts.push(body || "(No content)");
  
  return parts.join("\n");
}

/**
 * Get a header value from a message
 */
function getHeader(message, name) {
  if (!message.payload || !message.payload.headers) return "";
  const header = message.payload.headers.find(
    h => h.name.toLowerCase() === name.toLowerCase()
  );
  return header ? header.value : "";
}

/**
 * Extract message body from payload (supports nested multipart)
 */
function getMessageBody(message) {
  if (!message.payload) return "";
  
  // Try to get plain text body from direct payload
  if (message.payload.body && message.payload.body.data) {
    return decodeBase64(message.payload.body.data).trim();
  }
  
  // Search through parts recursively
  if (message.payload.parts) {
    const textBody = findBodyInParts(message.payload.parts, "text/plain");
    if (textBody) return textBody;
    
    // If no plain text, try HTML
    const htmlBody = findBodyInParts(message.payload.parts, "text/html");
    if (htmlBody) return stripHtmlTags(htmlBody);
  }
  
  return "";
}

/**
 * Recursively search for body content in message parts
 */
function findBodyInParts(parts, mimeType) {
  for (const part of parts) {
    // Check if this part matches the desired MIME type
    if (part.mimeType === mimeType && part.body && part.body.data) {
      return decodeBase64(part.body.data).trim();
    }
    
    // Recursively search in nested parts (for multipart/alternative, etc.)
    if (part.parts) {
      const found = findBodyInParts(part.parts, mimeType);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Extract attachment information from message
 */
function extractAttachments(message) {
  const attachments = [];
  
  if (!message.payload || !message.payload.parts) {
    return attachments;
  }
  
  // Recursively find attachments in parts
  function findAttachments(parts) {
    for (const part of parts) {
      // Check if this part is an attachment
      if (part.filename && part.body && part.body.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId,
        });
      }
      
      // Recursively search nested parts
      if (part.parts) {
        findAttachments(part.parts);
      }
    }
  }
  
  findAttachments(message.payload.parts);
  return attachments;
}

/**
 * Decode base64url string
 */
function decodeBase64(str) {
  try {
    // Replace URL-safe characters
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch (err) {
    return "";
  }
}

/**
 * Strip HTML tags from string (basic)
 */
function stripHtmlTags(html) {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gi, "")
    .replace(/<script[^>]*>.*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
  if (!dateStr) return "";
  
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    
    // Less than 1 minute
    if (diff < 60000) {
      return "Just now";
    }
    
    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    }
    
    // Less than 24 hours
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    }
    
    // Less than 7 days
    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days} day${days > 1 ? "s" : ""} ago`;
    }
    
    // Otherwise show date
    return date.toLocaleString();
  } catch (err) {
    return dateStr;
  }
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
}
