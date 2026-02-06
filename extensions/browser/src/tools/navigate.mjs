import { getActivePage, openTab, getPages } from "../client.mjs";
import { getSnapshot } from "../utils/snapshot.mjs";
import { smartWait } from "../utils/wait.mjs";

export const toolDefinition = {
  name: "browser-navigate",
  description: "Navigate the current tab to a URL. Returns page snapshot.",
  parameters: {
    url: { type: "string", description: "URL to navigate to", required: true },
  },
};

export async function handleNavigate(params, config) {
  if (!params.url) return "Error: url is required for navigate action";
  let page = getActivePage();
  if (!page) {
    const tabId = await openTab(params.url, config);
    page = getPages().get(tabId);
  } else {
    await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await smartWait(page, config);
  }
  const title = await page.title();
  const snapshot = await getSnapshot(page);
  return `Navigated to: ${title}\nURL: ${page.url()}\n\n${snapshot}`;
}
