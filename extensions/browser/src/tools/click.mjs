import { getActivePage, resolveRef } from "../client.mjs";
import { getSnapshot } from "../utils/snapshot.mjs";
import { smartWait } from "../utils/wait.mjs";
import { humanMouseMove, humanDelay } from "../utils/human.mjs";

export const toolDefinition = {
  name: "browser-click",
  description: "Click an element by ref (e.g. ref='e3'). Returns updated snapshot.",
  parameters: {
    ref: { type: "string", description: 'Element ref to click (e.g. "e3")', required: true },
  },
};

export async function handleClick(params, config) {
  if (!params.ref) return "Error: ref is required for click (e.g. ref='e3')";
  const page = getActivePage();
  if (!page) return "No browser open.";
  const locator = resolveRef(page, params.ref);
  if (!locator) return `Error: ref '${params.ref}' not found. Get a fresh snapshot first.`;
  
  // Human-like interaction: move mouse to element first
  await humanMouseMove(page, locator.first());
  await locator.first().click({ timeout: 10000 });
  await humanDelay(100, 300); // Post-click delay
  
  await smartWait(page, { ...config, smartWaitTimeout: 5000 });
  const snapshot = await getSnapshot(page);
  return `Clicked ${params.ref}\nURL: ${page.url()}\n\n${snapshot}`;
}
