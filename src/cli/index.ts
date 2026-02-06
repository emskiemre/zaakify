#!/usr/bin/env node

/**
 * Zaakify CLI
 *
 * Main entry point. Clean command structure:
 *   zaakify gateway        -- start the gateway server
 *   zaakify onboard        -- interactive setup wizard
 *   zaakify config doctor  -- validate config
 *   zaakify status         -- show system health
 */

// Suppress punycode deprecation warning from dependencies
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "DeprecationWarning" && warning.message.includes("punycode")) {
    return;
  }
  console.warn(warning);
});

import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { bootstrap } from "./bootstrap.js";
import { loadConfig, generateDefaultConfig, watchConfig } from "../config/loader.js";
import { initLogger, getLogger } from "../utils/logger.js";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { CONFIG_FILE, ZAAKIFY_HOME } from "../paths.js";

const VERSION = "1.0.0";

const program = new Command();

program
  .name("zaakify")
  .description("Zaakify -- A fast, modular AI assistant gateway")
  .version(VERSION);

// ─── gateway command ───────────────────────────────────────────
program
  .command("gateway")
  .description("Start the Zaakify gateway server")
  .option("-c, --config <path>", "Config file path", CONFIG_FILE)
  .option("-p, --port <number>", "Override gateway port")
  .option("--no-watch", "Disable config hot-reload")
  .action(async (opts) => {
    const configPath = opts.config;

    // No config file — tell user to onboard first
    if (!existsSync(configPath)) {
      console.log();
      console.log("  No config file found.");
      console.log(`  Expected at: ${CONFIG_FILE}`);
      console.log("  Run `npm run onboard` (or `zaakify onboard` if installed globally) to set up your instance.");
      console.log();
      process.exit(1);
    }

    const config = loadConfig(configPath);

    if (opts.port) {
      config.gateway.port = parseInt(opts.port, 10);
    }

    initLogger(config.logging);
    const log = getLogger("cli");

    // Startup banner
    console.log();
    console.log(`  Zaakify v${VERSION}`);
    console.log(`  Owner:    ${config.owner.name}`);
    console.log(`  Timezone: ${config.timezone}`);
    console.log(`  Gateway:  http://${config.gateway.host}:${config.gateway.port}`);
    console.log();

    log.info(`Zaakify v${VERSION} starting...`);

    if (opts.watch !== false) {
      watchConfig();
    }

    const app = await bootstrap(config);

    let shutdownInProgress = false;
    const shutdown = async () => {
      if (shutdownInProgress) {
        log.warn("Shutdown already in progress, forcing exit...");
        process.exit(1);
      }
      shutdownInProgress = true;
      
      log.info("Shutting down...");
      
      // Add 10-second overall timeout to prevent hanging
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("Shutdown timeout after 10s")), 10000);
      });
      
      try {
        await Promise.race([app.stop(), timeoutPromise]);
        process.exit(0);
      } catch (err) {
        log.error({ err }, "Forced shutdown due to timeout");
        process.exit(1);
      }
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("uncaughtException", (err) => {
      log.fatal({ err }, "Uncaught exception");
      shutdown();
    });
    process.on("unhandledRejection", (err) => {
      log.fatal({ err }, "Unhandled rejection");
    });
  });

// ─── onboard command ───────────────────────────────────────────
program
  .command("onboard")
  .description("Interactive setup wizard")
  .option("-c, --config <path>", "Config file output path", CONFIG_FILE)
  .action(async (opts) => {
    const configPath = opts.config;

    if (existsSync(configPath)) {
      console.log(`\n  Config already exists at ${configPath}`);
      console.log("  Delete it first if you want to re-run onboarding.\n");
      return;
    }

    // Ensure ~/.zaakify directory exists
    if (!existsSync(ZAAKIFY_HOME)) {
      mkdirSync(ZAAKIFY_HOME, { recursive: true });
    }

    const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    console.log();
    console.log("  =========================================");
    console.log("          Welcome to Zaakify!             ");
    console.log("  =========================================");
    console.log();

    const rl = createInterface({ input: process.stdin, output: process.stdout });

    // 1. Owner name
    const nameInput = await rl.question("  What's your name? > ");
    const ownerName = nameInput.trim() || "Owner";

    // 2. Timezone — auto-detect, confirm or override
    console.log(`\n  Detected timezone: ${detectedTz}`);
    const tzInput = await rl.question("  Press Enter to confirm, or type a different IANA timezone > ");
    const timezone = tzInput.trim() || detectedTz;

    // 3. Z.AI API key
    console.log();
    console.log("  Zaakify uses Z.AI (GLM) as its AI provider.");
    console.log("  Get a coding subscription API key from https://api.z.ai");
    console.log();
    const apiKeyInput = await rl.question("  Z.AI API key (paste it, or press Enter to skip) > ");
    const apiKey = apiKeyInput.trim();

    rl.close();

    // Generate config with user values
    let configContent = generateDefaultConfig();
    configContent = configContent.replace('name = "Owner"', `name = "${ownerName}"`);
    if (timezone !== detectedTz) {
      configContent = configContent.replace(
        `timezone = "${detectedTz}"`,
        `timezone = "${timezone}"`,
      );
    }
    if (apiKey) {
      configContent = configContent.replace(
        'apiKey = "${ZAI_API_KEY}"',
        `apiKey = "${apiKey}"`,
      );
    }

    writeFileSync(configPath, configContent, "utf-8");

    // Summary
    console.log();
    console.log("  -------------------------------------");
    console.log(`  Config written to: ${configPath}`);
    console.log(`  Owner:    ${ownerName}`);
    console.log(`  Timezone: ${timezone}`);
    console.log(`  API key:  ${apiKey ? "configured" : "not set (add it to ~/.zaakify/zaakify.toml later)"}`);
    console.log("  -------------------------------------");
    console.log();
    console.log("  Run `npm start` (or `zaakify gateway` if installed globally) to start.");
    console.log();
  });

// ─── config doctor ─────────────────────────────────────────────
program
  .command("doctor")
  .description("Validate config and check system health")
  .option("-c, --config <path>", "Config file path", CONFIG_FILE)
  .action(async (opts) => {
    console.log("\n  Zaakify Doctor\n");

    try {
      const config = loadConfig(opts.config);
      console.log("  [OK] Config file parsed and validated");
      console.log(`  [OK] Owner: ${config.owner.name}`);
      console.log(`  [OK] Timezone: ${config.timezone}`);

      const nodeVersion = process.versions.node;
      const major = parseInt(nodeVersion.split(".")[0], 10);
      if (major >= 22) {
        console.log(`  [OK] Node.js v${nodeVersion} (>= 22 required)`);
      } else {
        console.log(`  [!!] Node.js v${nodeVersion} -- v22+ recommended`);
      }

      if (config.channels.discord?.enabled) {
        console.log(
          config.channels.discord.token
            ? "  [OK] Discord: configured"
            : "  [!!] Discord: enabled but no token",
        );
      }

      if (config.channels.telegram?.enabled) {
        console.log(
          config.channels.telegram.botToken
            ? "  [OK] Telegram: configured"
            : "  [!!] Telegram: enabled but no botToken",
        );
      }

      if (config.channels.whatsapp?.enabled) {
        console.log("  [OK] WhatsApp: enabled (will pair on first run)");
      }

      if (config.agents.length > 0) {
        console.log(`  [OK] ${config.agents.length} agent(s) configured`);
        for (const agent of config.agents) {
          const hasKey = !!agent.apiKey || !!process.env.ZAI_API_KEY;
          console.log(
            hasKey
              ? `  [OK] Agent "${agent.id}": Z.AI API key configured`
              : `  [!!] Agent "${agent.id}": No API key found`,
          );
        }
      } else {
        console.log("  [!!] No agents configured");
      }

      console.log(
        config.memory.enabled
          ? `  [OK] Memory: enabled (${config.memory.dbPath})`
          : "  [--] Memory: disabled",
      );

      console.log("\n  All checks passed.\n");
    } catch (err) {
      console.error(`  [FAIL] ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

// ─── status command ────────────────────────────────────────────
program
  .command("status")
  .description("Show gateway status (requires running gateway)")
  .option("-p, --port <number>", "Gateway port", "18800")
  .action(async (opts) => {
    try {
      const res = await fetch(`http://127.0.0.1:${opts.port}/health`);
      const health = (await res.json()) as {
        status: string;
        uptime: number;
        memory: { heapUsed: number };
        version: string;
      };
      console.log("\n  Zaakify Status\n");
      console.log(`  Status:  ${health.status}`);
      console.log(`  Uptime:  ${Math.floor(health.uptime / 1000)}s`);
      console.log(`  Memory:  ${Math.floor(health.memory.heapUsed / 1024 / 1024)}MB heap`);
      console.log(`  Version: ${health.version}`);
      console.log();
    } catch {
      console.error("  Cannot connect to gateway. Is it running?\n");
    }
  });

program.parse();
