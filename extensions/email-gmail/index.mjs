/**
 * Gmail Extension for BitQlon
 * 
 * Provides Gmail integration through the Gmail API.
 * Supports listing, reading, sending, replying, searching, moving, deleting, and marking messages.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Import tool handlers
import { handleList, toolDefinition as listDef } from "./src/tools/list.mjs";
import { handleRead, toolDefinition as readDef } from "./src/tools/read.mjs";
import { handleSend, toolDefinition as sendDef } from "./src/tools/send.mjs";
import { handleReply, toolDefinition as replyDef } from "./src/tools/reply.mjs";
import { handleSearch, toolDefinition as searchDef } from "./src/tools/search.mjs";
import { handleMove, toolDefinition as moveDef } from "./src/tools/move.mjs";
import { handleDelete, toolDefinition as deleteDef } from "./src/tools/delete.mjs";
import { handleMark, toolDefinition as markDef } from "./src/tools/mark.mjs";
import { handleDownloadAttachment, toolDefinition as downloadAttachmentDef } from "./src/tools/download-attachment.mjs";

// Import setup tool handlers
import { handleSetupStart, toolDefinition as setupStartDef } from "./src/tools/setup-start.mjs";
import { handleSetupCheck, toolDefinition as setupCheckDef } from "./src/tools/setup-check.mjs";

// Get directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load configuration
let config;
let isConfigured = false;
try {
  const configPath = join(__dirname, "config.json");
  const configData = readFileSync(configPath, "utf-8");
  config = JSON.parse(configData);
  
  // Check if extension is fully configured
  isConfigured = config.configured && 
                 config.clientId && 
                 config.clientSecret && 
                 config.redirectUri && 
                 config.refreshToken;
} catch (error) {
  console.warn("Config.json not found or invalid. Setup tools will be available for configuration.");
  // Create a minimal config for setup tools to work
  config = {
    configured: false,
    clientId: "",
    clientSecret: "",
    redirectUri: "http://localhost:3000/oauth2callback",
    refreshToken: "",
    accounts: []
  };
}

/**
 * Extension entry point
 */
export default {
  name: "email-gmail",
  description: "Gmail integration extension",
  
  async activate(sdk) {
    // Always register setup tools (available even when not configured)
    const setupTools = [
      { def: setupStartDef, handler: handleSetupStart },
      { def: setupCheckDef, handler: handleSetupCheck },
    ];
    
    for (const { def, handler } of setupTools) {
      sdk.registerTool({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        handler: async (params) => {
          try {
            const result = await handler(params, config);
            // Return formatted result
            if (typeof result === 'object') {
              return JSON.stringify(result, null, 2);
            }
            return result;
          } catch (error) {
            sdk.log.error(`Error in ${def.name}: ${error.message}`);
            return JSON.stringify({ success: false, error: error.message }, null, 2);
          }
        },
      });
    }
    
    // Register Gmail tools only if fully configured
    if (isConfigured) {
      const tools = [
        { def: listDef, handler: handleList },
        { def: readDef, handler: handleRead },
        { def: sendDef, handler: handleSend },
        { def: replyDef, handler: handleReply },
        { def: searchDef, handler: handleSearch },
        { def: moveDef, handler: handleMove },
        { def: deleteDef, handler: handleDelete },
        { def: markDef, handler: handleMark },
        { def: downloadAttachmentDef, handler: handleDownloadAttachment },
      ];
      
      for (const { def, handler } of tools) {
        sdk.registerTool({
          name: def.name,
          description: def.description,
          parameters: def.parameters,
          handler: async (params) => {
            try {
              return await handler(params, config);
            } catch (error) {
              sdk.log.error(`Error in ${def.name}: ${error.message}`);
              return `Error: ${error.message}`;
            }
          },
        });
      }
      
      sdk.log.info(`Gmail extension activated with ${setupTools.length + tools.length} tools`);
      
      // Log configured accounts
      if (config.accounts && config.accounts.length > 0) {
        const accountList = config.accounts.map(a => a.email || a).join(", ");
        sdk.log.info(`Accounts: ${accountList}`);
      }
    } else {
      sdk.log.warn(`Gmail extension activated with ${setupTools.length} setup tools only`);
      sdk.log.warn("Extension not fully configured. Use gmail-setup-start to configure OAuth access.");
    }
  },
};
