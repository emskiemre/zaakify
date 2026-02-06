import { openTab, getPages } from "../client.mjs";
import { getSnapshot } from "../utils/snapshot.mjs";

export const toolDefinition = {
  name: "browser-open",
  description: "Open a new browser tab and navigate to a URL. Returns page snapshot.",
  parameters: {
    url: { type: "string", description: "URL to open", required: true },
  },
};

export async function handleOpen(params, config) {
  if (!params.url) return "Error: url is required for open action";
  const tabId = await openTab(params.url, config);
  const page = getPages().get(tabId);
  const title = await page.title();
  const snapshot = await getSnapshot(page);
  return `Opened ${tabId}: ${title}\nURL: ${page.url()}\n\n${snapshot}`;
}
