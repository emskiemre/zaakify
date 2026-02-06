/**
 * Gmail Setup Check Tool
 * Checks if OAuth authorization is complete and saves the refresh token
 */

import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getTokensFromCode } from "../oauth.mjs";
import { getAuthCode, getAuthError, isAuthComplete, stopServer } from "../setup-server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const toolDefinition = {
  name: "gmail-setup-check",
  description: "Complete Gmail OAuth setup after user authorization. CRITICAL: This MUST be called after gmail-setup-start and user authorization to finalize the setup. Without calling this, the extension will not be configured.",
  parameters: {
    type: "object",
    properties: {}
  }
};

export async function handleSetupCheck() {
  try {
    // Check if authorization is complete
    if (!isAuthComplete()) {
      return {
        success: false,
        status: "pending",
        message: "⏳ Still waiting for OAuth authorization.\n\n" +
                 "Make sure the user has:\n" +
                 "1. Visited the authorization URL from gmail-setup-start\n" +
                 "2. Signed in with their Google account\n" +
                 "3. Granted the requested Gmail permissions\n" +
                 "4. Been redirected back (they should see a success page)\n\n" +
                 "If the user completed authorization but this still shows pending:\n" +
                 "- Wait a few seconds and try again\n" +
                 "- Check if the callback server is still running\n" +
                 "- Restart the setup process with gmail-setup-start"
      };
    }

    // Check for errors
    const authError = getAuthError();
    if (authError) {
      await stopServer();
      return {
        success: false,
        status: "error",
        error: authError,
        message: `❌ OAuth authorization failed: ${authError}\n\n` +
                 "Common causes:\n" +
                 "- User denied permissions\n" +
                 "- OAuth app not properly configured in Google Cloud Console\n" +
                 "- User's email not added as test user (if app is in testing mode)\n" +
                 "- Wrong OAuth credentials used\n\n" +
                 "To fix: Start over with gmail-setup-start using correct credentials."
      };
    }

    // Get authorization code
    const authCode = getAuthCode();
    if (!authCode) {
      await stopServer();
      return {
        success: false,
        status: "error",
        message: "❌ Authorization callback received but no authorization code found.\n\n" +
                 "This shouldn't happen normally. Try:\n" +
                 "1. Start setup again with gmail-setup-start\n" +
                 "2. Make sure the redirect URI in Google Cloud Console matches exactly:\n" +
                 "   http://localhost:3000/oauth2callback"
      };
    }

    // Load config
    const configPath = join(__dirname, "../../config.json");
    let config;
    try {
      const configData = readFileSync(configPath, "utf-8");
      config = JSON.parse(configData);
    } catch (error) {
      await stopServer();
      return {
        success: false,
        error: "Failed to load config.json. Please run gmail-setup-start first.",
        details: error.message
      };
    }

    // Validate that we have the necessary OAuth credentials
    if (!config.clientId || !config.clientSecret || !config.redirectUri) {
      await stopServer();
      return {
        success: false,
        error: "OAuth credentials not found in config. Please run gmail-setup-start first."
      };
    }

    // Exchange authorization code for tokens
    let tokens;
    try {
      tokens = await getTokensFromCode(config, authCode);
    } catch (error) {
      await stopServer();
      return {
        success: false,
        error: "Failed to exchange authorization code for tokens",
        details: error.message,
        suggestion: "The authorization code may have expired. Please run gmail-setup-start again."
      };
    }

    // Validate we received a refresh token
    if (!tokens.refresh_token) {
      await stopServer();
      return {
        success: false,
        error: "No refresh token received from Google",
        message: "❌ Google did not provide a refresh token.\n\n" +
                 "This usually happens if the app was previously authorized.\n\n" +
                 "Fix:\n" +
                 "1. Go to: https://myaccount.google.com/permissions\n" +
                 "2. Find your OAuth app and revoke access\n" +
                 "3. Run gmail-setup-start again\n" +
                 "4. Complete authorization\n" +
                 "5. Call gmail-setup-check again"
      };
    }

    // Update config with refresh token and mark as configured
    config.refreshToken = tokens.refresh_token;
    config.configured = true;

    // Save complete config
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Stop the OAuth callback server
    await stopServer();

    return {
      success: true,
      status: "complete",
      message: `✅ Gmail extension configured successfully!

Configuration saved with:
- Client ID: ${config.clientId.substring(0, 30)}...
- Refresh token: Saved securely
- Status: Ready to use

📋 NEXT STEPS:

1. Restart the extension to load the new configuration:
   Extension({ action: "restart", name: "email-gmail" })

2. Test Gmail access:
   gmail-list({ account: "user@gmail.com", maxResults: 5 })

3. Use other Gmail tools as needed:
   - gmail-list: List emails
   - gmail-read: Read emails
   - gmail-send: Send emails
   - gmail-search: Search emails
   - gmail-reply: Reply to emails
   - gmail-move: Organize with labels
   - gmail-delete: Delete emails
   - gmail-mark: Mark as read/unread/starred

✅ Setup is now complete!`
    };

  } catch (error) {
    // Ensure server is stopped on any error
    try {
      await stopServer();
    } catch (e) {
      // Ignore server stop errors
    }

    return {
      success: false,
      error: "Unexpected error during setup completion",
      details: error.message
    };
  }
}
