/**
 * Error handling utilities
 */

/**
 * Handle Gmail API errors and format user-friendly messages
 */
export function handleApiError(error, context = "") {
  const prefix = context ? `${context}: ` : "";
  
  // Network/connection errors
  if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
    return `${prefix}Network error. Check your internet connection.`;
  }
  
  if (error.code === "ETIMEDOUT") {
    return `${prefix}Request timed out. Please try again.`;
  }
  
  // Gmail API errors
  if (error.response && error.response.status) {
    const status = error.response.status;
    const message = error.response.data?.error?.message || error.message;
    
    switch (status) {
      case 400:
        return `${prefix}Bad request: ${message}`;
      
      case 401:
        return `${prefix}Authentication failed. Your OAuth token may have expired. Please reconfigure the extension.`;
      
      case 403:
        return `${prefix}Permission denied: ${message}. Check your OAuth scopes.`;
      
      case 404:
        return `${prefix}Resource not found: ${message}`;
      
      case 429:
        return `${prefix}Rate limit exceeded. Please wait a moment and try again.`;
      
      case 500:
      case 502:
      case 503:
        return `${prefix}Gmail API error (${status}). Please try again later.`;
      
      default:
        return `${prefix}API error (${status}): ${message}`;
    }
  }
  
  // OAuth errors
  if (error.message && error.message.includes("invalid_grant")) {
    return `${prefix}OAuth token is invalid or expired. Please reconfigure the extension with a fresh refresh token.`;
  }
  
  // Generic error
  return `${prefix}${error.message || "Unknown error occurred"}`;
}

/**
 * Validate required parameters
 */
export function validateParams(params, required) {
  const missing = [];
  
  for (const field of required) {
    if (!params[field]) {
      missing.push(field);
    }
  }
  
  if (missing.length > 0) {
    throw new Error(`Missing required parameters: ${missing.join(", ")}`);
  }
}

/**
 * Safely parse JSON with error handling
 */
export function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}
