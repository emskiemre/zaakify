/**
 * OAuth 2.0 token management for Gmail API
 */

import { google } from "googleapis";

/**
 * Create and configure OAuth2 client
 */
export function createOAuthClient(config) {
  const { clientId, clientSecret, redirectUri } = config;
  
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing OAuth credentials in config.json");
  }
  
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Set refresh token and get access token
 */
export async function getAuthenticatedClient(config) {
  const oauth2Client = createOAuthClient(config);
  
  if (!config.refreshToken) {
    throw new Error("No refresh token found. Please complete OAuth flow first.");
  }
  
  oauth2Client.setCredentials({
    refresh_token: config.refreshToken,
  });
  
  // Automatically refreshes access token when needed
  return oauth2Client;
}

/**
 * Generate authorization URL for initial OAuth flow
 */
export function generateAuthUrl(config) {
  const oauth2Client = createOAuthClient(config);
  
  const scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.compose",
  ];
  
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent", // Force consent to get refresh token
    response_type: "code",
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function getTokensFromCode(config, code) {
  const oauth2Client = createOAuthClient(config);
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}
