/**
 * BitQlon Browser Extension
 *
 * Gives the agent full web browsing capabilities via Playwright.
 * Stealth mode bypasses most bot detection (Cloudflare, PerimeterX, DataDome).
 * Smart loading handles SPAs, cookie consent banners, and lazy-loaded content.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Import tool handlers
import { handleOpen, toolDefinition as openDef } from "./src/tools/open.mjs";
import { handleNavigate, toolDefinition as navigateDef } from "./src/tools/navigate.mjs";
import { handleSnapshot, toolDefinition as snapshotDef } from "./src/tools/snapshot.mjs";
import { handleClick, toolDefinition as clickDef } from "./src/tools/click.mjs";
import { handleType, toolDefinition as typeDef } from "./src/tools/type.mjs";
import { handlePress, toolDefinition as pressDef } from "./src/tools/press.mjs";
import { handleScroll, toolDefinition as scrollDef } from "./src/tools/scroll.mjs";
import { handleEvaluate, toolDefinition as evaluateDef } from "./src/tools/evaluate.mjs";
import { handleWait, toolDefinition as waitDef } from "./src/tools/wait.mjs";
import { handleTabs, toolDefinition as tabsDef } from "./src/tools/tabs.mjs";
import { handleSwitch, toolDefinition as switchDef } from "./src/tools/switch.mjs";
import { handleClose, toolDefinition as closeDef } from "./src/tools/close.mjs";
import { handleQuit, toolDefinition as quitDef } from "./src/tools/quit.mjs";

// Get directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load configuration
let config;
try {
  const configPath = join(__dirname, "config.json");
  const configData = readFileSync(configPath, "utf-8");
  config = JSON.parse(configData);
} catch (error) {
  console.error("Failed to load config.json:", error.message);
  process.exit(1);
}

// Check if extension is configured
if (!config.configured) {
  console.error("Extension not configured. Please edit config.json and set configured: true");
  process.exit(1);
}

/**
 * Extension entry point
 */
export default {
  name: "browser",
  description: "Web browser extension — stealth Playwright-based browsing",

  async activate(sdk) {
    // Register all Browser tools
    const tools = [
      { def: openDef, handler: handleOpen },
      { def: navigateDef, handler: handleNavigate },
      { def: snapshotDef, handler: handleSnapshot },
      { def: clickDef, handler: handleClick },
      { def: typeDef, handler: handleType },
      { def: pressDef, handler: handlePress },
      { def: scrollDef, handler: handleScroll },
      { def: evaluateDef, handler: handleEvaluate },
      { def: waitDef, handler: handleWait },
      { def: tabsDef, handler: handleTabs },
      { def: switchDef, handler: handleSwitch },
      { def: closeDef, handler: handleClose },
      { def: quitDef, handler: handleQuit },
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

    sdk.log.info(`Browser extension activated with ${tools.length} tools`);
  },
};
