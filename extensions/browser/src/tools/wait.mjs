import { getActivePage } from "../client.mjs";
import { getSnapshot } from "../utils/snapshot.mjs";
import { smartWait } from "../utils/wait.mjs";

export const toolDefinition = {
  name: "browser-wait",
  description: "Wait for page to finish loading (use after click that triggers navigation).",
  parameters: {},
};

export async function handleWait(params, config) {
  const page = getActivePage();
  if (!page) return "No browser open.";
  await smartWait(page, config);
  const title = await page.title();
  const snapshot = await getSnapshot(page);
  return `Waited for page to stabilize.\nPage: ${title}\nURL: ${page.url()}\n\n${snapshot}`;
}
