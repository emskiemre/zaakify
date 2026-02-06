/**
 * BitQlon Extension Runner (plain JS — runs in child process)
 *
 * This file is intentionally .js so it can be forked directly
 * by Node.js without tsx or compilation.
 *
 * Extension format:
 *   export default { name, description, activate(sdk) }
 *
 * Protocol (JSON over IPC):
 *   Runner → Host:  { type: "ready", tools: [...] }
 *   Runner → Host:  { type: "result", id, output, isError? }
 *   Runner → Host:  { type: "error", message }
 *   Runner → Host:  { type: "register_tool", tool: { name, description, parameters } }
 *   Runner → Host:  { type: "emit_event", eventType, payload }
 *   Host → Runner:  { type: "execute", id, toolName, params }
 */

const extPath = process.argv[2];

if (!extPath) {
  process.send?.({ type: "error", message: "No extension path provided" });
  process.exit(1);
}

// ─── SDK for extensions ─────────────────────────────────────────

function createSDK(extName) {
  const registeredTools = [];

  return {
    name: extName,

    registerTool(tool) {
      if (!tool.name || !tool.description || typeof tool.handler !== "function") {
        throw new Error(`Invalid tool: must have name, description, and handler`);
      }
      registeredTools.push(tool);
      // Tell the host about this tool
      process.send?.({
        type: "register_tool",
        tool: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters || {},
        },
      });
    },

    emitEvent(eventType, payload) {
      process.send?.({ type: "emit_event", eventType, payload });
    },

    log: {
      info: (msg) => console.log(`[${extName}] ${msg}`),
      warn: (msg) => console.warn(`[${extName}] ${msg}`),
      error: (msg) => console.error(`[${extName}] ${msg}`),
    },

    /** Internal: get registered tools for execution routing */
    _getTools() {
      return registeredTools;
    },
  };
}

// ─── Tool execution handler ─────────────────────────────────────

function setupExecutionHandler(toolMap) {
  process.on("message", async (msg) => {
    if (msg.type !== "execute") return;

    const toolName = msg.toolName || msg.name;
    const tool = toolMap.get(toolName);

    if (!tool) {
      process.send?.({
        type: "result",
        id: msg.id,
        output: `Tool "${toolName}" not found in this extension`,
        isError: true,
      });
      return;
    }

    try {
      const result = await tool.handler(msg.params);
      const output = typeof result === "string" ? result : JSON.stringify(result);
      process.send?.({ type: "result", id: msg.id, output });
    } catch (err) {
      process.send?.({
        type: "result",
        id: msg.id,
        output: `Tool handler error: ${err?.message || String(err)}`,
        isError: true,
      });
    }
  });
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  try {
    const { pathToFileURL } = await import("node:url");
    const extUrl = pathToFileURL(extPath).href;
    const mod = await import(extUrl);
    const ext = mod.default || mod;

    if (typeof ext.activate !== "function") {
      process.send?.({
        type: "error",
        message: `Extension must export { name, description, activate(sdk) }. Got keys: ${Object.keys(ext).join(", ")}`,
      });
      process.exit(1);
    }

    const name = ext.name || "unnamed";
    const sdk = createSDK(name);

    await ext.activate(sdk);

    const tools = sdk._getTools();
    const toolMap = new Map();
    for (const t of tools) {
      toolMap.set(t.name, t);
    }

    setupExecutionHandler(toolMap);

    process.send?.({
      type: "ready",
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters || {},
      })),
    });
  } catch (err) {
    process.send?.({
      type: "error",
      message: `Failed to load extension: ${err?.message || String(err)}`,
    });
    process.exit(1);
  }
}

main();
