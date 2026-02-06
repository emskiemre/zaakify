/**
 * Gmail Setup Start Tool
 * Initiates OAuth setup by collecting credentials and generating auth URL
 */

import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateAuthUrl } from "../oauth.mjs";
import { startServer, resetAuth } from "../setup-server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const toolDefinition = {
  name: "gmail-setup-start",
  description: "Start Gmail OAuth setup process. Accepts OAuth credentials (can accept full OAuth JSON or individual fields) and generates authorization URL. Use this when the user wants to configure Gmail access.",
  parameters: {
    type: "object",
    properties: {
      clientId: {
        type: "string",
        description: "OAuth Client ID from Google Cloud Console (format: xxxxxx.apps.googleusercontent.com). Also accepts 'client_id'."
      },
      clientSecret: {
        type: "string",
        description: "OAuth Client Secret from Google Cloud Console (format: GOCSPX-xxxxx). Also accepts 'client_secret'."
      },
      client_id: {
        type: "string",
        description: "Alias for clientId (accepts snake_case from Google JSON)"
      },
      client_secret: {
        type: "string",
        description: "Alias for clientSecret (accepts snake_case from Google JSON)"
      },
      oauthJson: {
        type: "string",
        description: "Complete OAuth JSON from Google Cloud Console (can be pasted directly). If provided, clientId and clientSecret will be extracted automatically."
      },
      redirectUri: {
        type: "string",
        description: "OAuth redirect URI (default: http://localhost:3000/oauth2callback)",
        default: "http://localhost:3000/oauth2callback"
      },
      port: {
        type: "number",
        description: "Port for OAuth callback server (default: 3000)",
        default: 3000
      }
    },
    required: []
  }
};

export async function handleSetupStart(params) {
  let { clientId, clientSecret, client_id, client_secret, oauthJson, redirectUri = "http://localhost:3000/oauth2callback", port = 3000 } = params;

  // Accept both camelCase and snake_case parameter formats
  clientId = clientId || client_id;
  clientSecret = clientSecret || client_secret;

  try {
    // If OAuth JSON is provided, extract credentials
    if (oauthJson) {
      try {
        const parsed = typeof oauthJson === 'string' ? JSON.parse(oauthJson) : oauthJson;
        
        // Support both desktop app format and web app format
        if (parsed.installed) {
          clientId = parsed.installed.client_id;
          clientSecret = parsed.installed.client_secret;
          // Check for redirect_uris in the JSON
          if (parsed.installed.redirect_uris && parsed.installed.redirect_uris.length > 0) {
            const googleRedirectUri = parsed.installed.redirect_uris[0];
            
            // Desktop app typically uses http://localhost without port
            // Google will redirect to http://localhost (port 80 by default)
            // But we can't use port 80 without admin rights, so we use a workaround:
            // We tell user to manually add port to browser OR we accept the mismatch
            if (googleRedirectUri === "http://localhost") {
              // Use the Google redirect URI directly
              redirectUri = "http://localhost";
              // But start server on port 3000, user must manually navigate to :3000
              // OR we can try port 80 (will fail without admin) and fallback to 3000
              if (port === 3000) {
                // User didn't specify port, let's inform them
                return {
                  success: false,
                  error: "Desktop app OAuth requires port 80 or manual intervention",
                  details: `You're using a Desktop app OAuth client which redirects to "http://localhost" (port 80).

Options:

1. EASIEST: Create a Web application OAuth client instead:
   - Go to https://console.cloud.google.com/apis/credentials
   - Create new OAuth client ID
   - Choose "Web application"
   - Set redirect URI to: http://localhost:3000/oauth2callback
   - Download credentials and paste the JSON

2. Use Desktop app with manual port:
   - Re-run this command with: redirectUri: "http://localhost", port: 80
   - NOTE: Port 80 requires administrator privileges on Windows
   - You may need to run BitQlon as administrator

3. Manual browser edit:
   - When redirected to http://localhost, manually change URL to http://localhost:3000
   - Then press Enter`,
                  recommendation: "Create a Web application OAuth client (option 1)"
                };
              }
            } else if (googleRedirectUri !== redirectUri) {
              return {
                success: false,
                error: "OAuth redirect URI mismatch detected",
                details: `Your Google Cloud Console has redirect URI: "${googleRedirectUri}"\nBut this extension needs: "${redirectUri}"\n\nYou have 2 options:\n\n1. Update Google Cloud Console (Recommended):\n   - Go to https://console.cloud.google.com/apis/credentials\n   - Click on your OAuth client ID\n   - Under "Authorized redirect URIs", change "${googleRedirectUri}" to "${redirectUri}"\n   - Save and try again\n\n2. Use your existing redirect URI:\n   - Re-run this tool with: redirectUri: "${googleRedirectUri}"\n   - Note: This may require port changes if not using localhost:3000`,
                googleRedirectUri,
                expectedRedirectUri: redirectUri
              };
            }
          }
        } else if (parsed.web) {
          clientId = parsed.web.client_id;
          clientSecret = parsed.web.client_secret;
          if (parsed.web.redirect_uris && parsed.web.redirect_uris.length > 0) {
            const googleRedirectUri = parsed.web.redirect_uris[0];
            if (googleRedirectUri !== redirectUri) {
              return {
                success: false,
                error: "OAuth redirect URI mismatch detected",
                details: `Your Google Cloud Console has redirect URI: "${googleRedirectUri}"\nBut this extension needs: "${redirectUri}"\n\nPlease update your OAuth client in Google Cloud Console to use: ${redirectUri}`,
                googleRedirectUri,
                expectedRedirectUri: redirectUri
              };
            }
          }
        } else {
          return {
            success: false,
            error: "Invalid OAuth JSON format. Expected format with 'installed' or 'web' key."
          };
        }
      } catch (parseError) {
        return {
          success: false,
          error: "Failed to parse OAuth JSON",
          details: parseError.message
        };
      }
    }
    
    // Validate inputs
    if (!clientId || !clientSecret) {
      return {
        success: false,
        error: "Missing OAuth credentials",
        details: "Please provide ONE of the following:\n\n" +
                 "Option 1 (Recommended): Full OAuth JSON\n" +
                 "  gmail-setup-start({ oauthJson: '{\"installed\":{...}}' })\n\n" +
                 "Option 2: Individual credentials (camelCase)\n" +
                 "  gmail-setup-start({ clientId: '...', clientSecret: '...' })\n\n" +
                 "Option 3: Individual credentials (snake_case)\n" +
                 "  gmail-setup-start({ client_id: '...', client_secret: '...' })"
      };
    }

    // Load existing config or create new one
    const configPath = join(__dirname, "../../config.json");
    let config;
    try {
      const configData = readFileSync(configPath, "utf-8");
      config = JSON.parse(configData);
    } catch (error) {
      // If config doesn't exist, use template
      config = {
        configured: false,
        clientId: "",
        clientSecret: "",
        redirectUri: "http://localhost:3000/oauth2callback",
        refreshToken: "",
        accounts: []
      };
    }

    // Update config with provided credentials (but don't set configured yet)
    config.clientId = clientId;
    config.clientSecret = clientSecret;
    config.redirectUri = redirectUri;

    // Save partial config
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Reset any previous auth state
    resetAuth();

    // Start OAuth callback server
    const serverResult = await startServer(port);

    // Generate authorization URL
    const authUrl = generateAuthUrl(config);

    return {
      success: true,
      authUrl,
      redirectUri,
      port,
      message: `✅ OAuth setup started successfully!

📋 AUTHORIZATION URL (copy/paste this EXACT URL into browser):

${authUrl}

📋 NEXT STEPS (Follow in order):

1. ⚠️ IMPORTANT: Copy the URL above EXACTLY as-is (do not modify or retype it)
2. Paste it into your browser and press Enter
3. Sign in with your Google account and grant permissions
4. You will be redirected to localhost:3000/oauth2callback with a code
5. Tell me when you see the success page or give me the code from the URL

6. 🚨 CRITICAL: I MUST then call gmail-setup-check to complete setup!
   Example: gmail-setup-check({})

⚠️ Setup is NOT complete until I call gmail-setup-check!

OAuth callback server is now listening on port ${port}...

🔍 URL VERIFICATION:
- Length: ${authUrl.length} characters
- Contains response_type: ${authUrl.includes('response_type=code') ? '✅ YES' : '❌ NO'}
- Contains client_id: ${authUrl.includes('client_id=') ? '✅ YES' : '❌ NO'}`
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: error.code === 'EADDRINUSE' 
        ? `Port ${port} is already in use. Try using a different port by specifying the 'port' parameter.`
        : undefined
    };
  }
}
