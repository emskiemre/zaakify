/**
 * Zaakify File & Code Tools
 *
 * Real tools that let the agent interact with the filesystem and execute code.
 * Scoped to the workspace directory for safety.
 *
 * Tools:
 *   - Read: read file contents
 *   - Write: create or overwrite a file
 *   - Edit: find-and-replace in a file
 *   - Bash: execute shell commands
 *   - Glob: find files by pattern
 *   - Grep: search file contents
 *   - WebFetch: fetch a URL
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { ToolId as makeToolId } from "../types/index.js";
import { getLogger } from "../utils/logger.js";
import { safePath } from "./sandbox.js";
import { globFiles, grepFiles } from "./search-utils.js";

const log = getLogger("file-tools");

// ─── Tool factories ─────────────────────────────────────────────

export function createReadTool(workspace: string): ToolDefinition {
  return {
    id: makeToolId("Read"),
    name: "Read",
    description: "Read the contents of a file. Returns the file content with line numbers.",
    parameters: {
      file_path: {
        type: "string",
        description: "Path to the file (relative to workspace or absolute)",
        required: true,
      },
      offset: {
        type: "number",
        description: "Line number to start reading from (0-based). Optional.",
      },
      limit: {
        type: "number",
        description: "Max number of lines to read. Defaults to 2000.",
      },
    },
    requiredParams: ["file_path"],
    handler: async (params): Promise<ToolResult> => {
      try {
        const filePath = safePath(workspace, params.file_path as string);
        if (!existsSync(filePath)) {
          return { toolCallId: "", output: `File not found: ${params.file_path}`, isError: true };
        }
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        const offset = (params.offset as number) || 0;
        const limit = (params.limit as number) || 2000;
        const slice = lines.slice(offset, offset + limit);
        const numbered = slice.map((line, i) => `${String(offset + i + 1).padStart(5)}| ${line}`).join("\n");
        return { toolCallId: "", output: numbered || "(empty file)" };
      } catch (err) {
        return { toolCallId: "", output: `Read error: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

export function createWriteTool(workspace: string): ToolDefinition {
  return {
    id: makeToolId("Write"),
    name: "Write",
    description: "Create or overwrite a file with the given content. Creates parent directories automatically.",
    parameters: {
      file_path: {
        type: "string",
        description: "Path to the file (relative to workspace or absolute)",
        required: true,
      },
      content: {
        type: "string",
        description: "The content to write to the file",
        required: true,
      },
    },
    requiredParams: ["file_path", "content"],
    handler: async (params): Promise<ToolResult> => {
      try {
        const filePath = safePath(workspace, params.file_path as string);
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(filePath, params.content as string, "utf-8");
        const lines = (params.content as string).split("\n").length;
        log.info({ file: params.file_path, lines }, "File written");
        return { toolCallId: "", output: `Written ${lines} lines to ${params.file_path}` };
      } catch (err) {
        return { toolCallId: "", output: `Write error: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

export function createEditTool(workspace: string): ToolDefinition {
  return {
    id: makeToolId("Edit"),
    name: "Edit",
    description: "Find and replace text in a file. The old_string must match exactly (including whitespace). Use for precise edits.",
    parameters: {
      file_path: {
        type: "string",
        description: "Path to the file",
        required: true,
      },
      old_string: {
        type: "string",
        description: "The exact text to find and replace",
        required: true,
      },
      new_string: {
        type: "string",
        description: "The replacement text",
        required: true,
      },
    },
    requiredParams: ["file_path", "old_string", "new_string"],
    handler: async (params): Promise<ToolResult> => {
      try {
        const filePath = safePath(workspace, params.file_path as string);
        if (!existsSync(filePath)) {
          return { toolCallId: "", output: `File not found: ${params.file_path}`, isError: true };
        }
        const content = readFileSync(filePath, "utf-8");
        const oldStr = params.old_string as string;
        const newStr = params.new_string as string;

        if (!content.includes(oldStr)) {
          return { toolCallId: "", output: "old_string not found in file content", isError: true };
        }

        const occurrences = content.split(oldStr).length - 1;
        if (occurrences > 1) {
          return {
            toolCallId: "",
            output: `old_string found ${occurrences} times. Provide more context to match uniquely.`,
            isError: true,
          };
        }

        const updated = content.replace(oldStr, newStr);
        writeFileSync(filePath, updated, "utf-8");
        log.info({ file: params.file_path }, "File edited");
        return { toolCallId: "", output: `Edited ${params.file_path} successfully` };
      } catch (err) {
        return { toolCallId: "", output: `Edit error: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

export function createDeleteTool(workspace: string): ToolDefinition {
  return {
    id: makeToolId("Delete"),
    name: "Delete",
    description: "Delete a file from the workspace.",
    parameters: {
      file_path: {
        type: "string",
        description: "Path to the file to delete",
        required: true,
      },
    },
    requiredParams: ["file_path"],
    handler: async (params): Promise<ToolResult> => {
      try {
        const filePath = safePath(workspace, params.file_path as string);
        if (!existsSync(filePath)) {
          return { toolCallId: "", output: `File not found: ${params.file_path}`, isError: true };
        }
        unlinkSync(filePath);
        log.info({ file: params.file_path }, "File deleted");
        return { toolCallId: "", output: `Deleted ${params.file_path}` };
      } catch (err) {
        return { toolCallId: "", output: `Delete error: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

export function createBashTool(workspace: string): ToolDefinition {
  return {
    id: makeToolId("Bash"),
    name: "Bash",
    description: "Execute a shell command in the workspace directory. Returns stdout/stderr. Use for running code, git, npm, etc.",
    parameters: {
      command: {
        type: "string",
        description: "The shell command to execute",
        required: true,
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 300000 / 5 minutes for long-running commands)",
      },
    },
    requiredParams: ["command"],
    handler: async (params): Promise<ToolResult> => {
      try {
        const cmd = params.command as string;
        const timeout = (params.timeout as number) || 300_000; // 5 minutes default for long operations

        // Safety: block obviously dangerous commands
        const blocked = ["rm -rf /", "format c:", "mkfs", ":(){:|:&};:"];
        if (blocked.some((b) => cmd.includes(b))) {
          return { toolCallId: "", output: "Command blocked for safety", isError: true };
        }

        log.info({ command: cmd.slice(0, 100), timeout }, "Executing bash command");

        // Use async execFile to avoid blocking the event loop
        const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
          const shellArgs = process.platform === "win32" ? ["/c", cmd] : ["-c", cmd];
          const child = execFile(shell, shellArgs, {
            cwd: workspace,
            timeout,
            encoding: "utf-8",
            maxBuffer: 1024 * 1024,
          }, (err, stdout, stderr) => {
            if (err) {
              // Still return stdout/stderr even on error (e.g., non-zero exit)
              reject({ ...err, stdout, stderr });
            } else {
              resolve({ stdout: stdout || "", stderr: stderr || "" });
            }
          });
          // Kill the child if it's still running after timeout + 1s grace
          setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* Process already exited */ } }, timeout + 1000);
        });

        const output = (result.stdout + (result.stderr ? `\n[stderr]: ${result.stderr}` : "")).slice(0, 10000);
        return { toolCallId: "", output: output || "(no output)" };
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; message: string };
        const output = [
          execErr.stdout || "",
          execErr.stderr || "",
          execErr.message || "",
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 10000);
        return { toolCallId: "", output: `Command failed:\n${output}`, isError: true };
      }
    },
  };
}

export function createGlobTool(workspace: string): ToolDefinition {
  return {
    id: makeToolId("Glob"),
    name: "Glob",
    description: "Find files matching a glob pattern in the workspace. Supports **, *, ? wildcards.",
    parameters: {
      pattern: {
        type: "string",
        description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.md")',
        required: true,
      },
    },
    requiredParams: ["pattern"],
    handler: async (params): Promise<ToolResult> => {
      try {
        const pattern = params.pattern as string;
        const matches = globFiles(workspace, pattern);
        if (matches.length === 0) {
          return { toolCallId: "", output: "No files found matching pattern" };
        }
        return {
          toolCallId: "",
          output: matches.slice(0, 100).join("\n") +
            (matches.length > 100 ? `\n... and ${matches.length - 100} more` : ""),
        };
      } catch (err) {
        return { toolCallId: "", output: `Glob error: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

export function createGrepTool(workspace: string): ToolDefinition {
  return {
    id: makeToolId("Grep"),
    name: "Grep",
    description: "Search file contents for a regex pattern. Returns matching files, line numbers, and snippets.",
    parameters: {
      pattern: {
        type: "string",
        description: "Regex pattern to search for",
        required: true,
      },
      include: {
        type: "string",
        description: 'File pattern filter (e.g., "*.ts", "*.{ts,tsx}")',
      },
    },
    requiredParams: ["pattern"],
    handler: async (params): Promise<ToolResult> => {
      try {
        const pattern = params.pattern as string;
        const include = params.include as string | undefined;
        const results = grepFiles(workspace, pattern, include);
        if (results.length === 0) {
          return { toolCallId: "", output: "No matches found" };
        }
        const formatted = results
          .map((r) => `${r.file}:${r.line}: ${r.text}`)
          .join("\n");
        return { toolCallId: "", output: formatted };
      } catch (err) {
        return { toolCallId: "", output: `Grep error: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

export function createWebFetchTool(): ToolDefinition {
  return {
    id: makeToolId("WebFetch"),
    name: "WebFetch",
    description: "Fetch content from a URL. Returns the response body as text. This is a simple HTTP fetch — it cannot execute JavaScript or bypass bot detection. For JS-heavy sites or sites that block requests, start the browser extension instead.",
    parameters: {
      url: {
        type: "string",
        description: "The URL to fetch",
        required: true,
      },
    },
    requiredParams: ["url"],
    handler: async (params): Promise<ToolResult> => {
      try {
        const url = params.url as string;
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          return { toolCallId: "", output: "URL must start with http:// or https://", isError: true };
        }
        const response = await fetch(url, {
          headers: { "User-Agent": "Zaakify/1.0" },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          return { toolCallId: "", output: `HTTP ${response.status}: ${response.statusText}`, isError: true };
        }
        const text = await response.text();
        return { toolCallId: "", output: text.slice(0, 20000) };
      } catch (err) {
        return { toolCallId: "", output: `Fetch error: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

export function createListTool(workspace: string): ToolDefinition {
  return {
    id: makeToolId("List"),
    name: "List",
    description: "List files and directories in a path. Shows names, sizes, and types.",
    parameters: {
      path: {
        type: "string",
        description: "Directory path (relative to workspace). Defaults to workspace root.",
      },
    },
    requiredParams: [],
    handler: async (params): Promise<ToolResult> => {
      try {
        const dirPath = safePath(workspace, (params.path as string) || ".");
        if (!existsSync(dirPath)) {
          return { toolCallId: "", output: `Directory not found: ${params.path || "."}`, isError: true };
        }
        const entries = readdirSync(dirPath, { withFileTypes: true });
        const lines = entries.map((e) => {
          const full = join(dirPath, e.name);
          if (e.isDirectory()) return `  ${e.name}/`;
          try {
            const stat = statSync(full);
            const size = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(1)}K`;
            return `  ${e.name} (${size})`;
          } catch {
            return `  ${e.name}`;
          }
        });
        return { toolCallId: "", output: lines.join("\n") || "(empty directory)" };
      } catch (err) {
        return { toolCallId: "", output: `List error: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

/**
 * Register all file/code tools scoped to a workspace directory.
 */
export function registerFileTools(registry: { register: (tool: ToolDefinition) => void }, workspace: string): void {
  registry.register(createReadTool(workspace));
  registry.register(createWriteTool(workspace));
  registry.register(createEditTool(workspace));
  registry.register(createDeleteTool(workspace));
  registry.register(createBashTool(workspace));
  registry.register(createGlobTool(workspace));
  registry.register(createGrepTool(workspace));
  registry.register(createWebFetchTool());
  registry.register(createListTool(workspace));
  log.info({ workspace, count: 9 }, "File tools registered");
}
