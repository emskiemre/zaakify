/**
 * Path Sandbox — prevents the agent from escaping the workspace.
 */

import { resolve, isAbsolute } from "node:path";
import { ZAAKIFY_HOME } from "../paths.js";

/**
 * Resolve a path relative to the workspace, preventing escape.
 * Allows access to the workspace and the entire ~/.zaakify tree.
 */
export function safePath(workspace: string, filePath: string): string {
  const resolved = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(workspace, filePath);

  const allowedRoots = [resolve(workspace), resolve(ZAAKIFY_HOME)];

  const isAllowed = allowedRoots.some((root) => resolved.startsWith(root));
  if (!isAllowed) {
    throw new Error(`Path "${filePath}" is outside the workspace. Allowed: ${allowedRoots.join(", ")}`);
  }

  return resolved;
}
