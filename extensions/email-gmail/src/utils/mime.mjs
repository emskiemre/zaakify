/**
 * MIME message creation utilities for Gmail API
 */

/**
 * Create a MIME message for sending email
 */
export function createMimeMessage({ to, from, subject, body, cc, bcc, inReplyTo, references }) {
  const lines = [];
  
  lines.push(`To: ${to}`);
  lines.push(`From: ${from}`);
  
  if (cc) {
    lines.push(`Cc: ${cc}`);
  }
  
  if (bcc) {
    lines.push(`Bcc: ${bcc}`);
  }
  
  lines.push(`Subject: ${subject}`);
  
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
  }
  
  if (references) {
    lines.push(`References: ${references}`);
  }
  
  lines.push("Content-Type: text/plain; charset=utf-8");
  lines.push("MIME-Version: 1.0");
  lines.push("");
  lines.push(body);
  
  const message = lines.join("\r\n");
  
  // Encode to base64url
  return encodeBase64Url(message);
}

/**
 * Encode string to base64url format (Gmail API requirement)
 */
function encodeBase64Url(str) {
  const base64 = Buffer.from(str, "utf-8").toString("base64");
  // Convert to URL-safe base64
  return base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Create reply message with proper threading
 */
export function createReplyMessage({ to, from, subject, body, inReplyTo, references }) {
  // Add "Re:" prefix if not already present
  const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
  
  return createMimeMessage({
    to,
    from,
    subject: replySubject,
    body,
    inReplyTo,
    references,
  });
}
