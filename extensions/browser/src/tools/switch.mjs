import { getPages, setActivePage } from "../client.mjs";
import { getSnapshot } from "../utils/snapshot.mjs";

export const toolDefinition = {
  name: "browser-switch",
  description: "Switch to a tab by id (e.g. tab1, tab2).",
  parameters: {
    tabId: { type: "string", description: "Tab ID to switch to (e.g. tab1)", required: true },
  },
};

export async function handleSwitch(params, config) {
  if (!params.tabId) return "Error: tabId is required for switch action";
  const pages = getPages();
  const page = pages.get(params.tabId);
  if (!page || page.isClosed()) return `Error: tab '${params.tabId}' not found.`;
  setActivePage(page);
  await page.bringToFront();
  const title = await page.title();
  const snapshot = await getSnapshot(page);
  return `Switched to ${params.tabId}: ${title}\nURL: ${page.url()}\n\n${snapshot}`;
}
