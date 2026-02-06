import { getActivePage } from "../client.mjs";
import { getSnapshot } from "../utils/snapshot.mjs";

export const toolDefinition = {
  name: "browser-snapshot",
  description: "Get the current page content with interactive element refs. Set scroll=true to load lazy content first.",
  parameters: {
    scroll: { type: "string", description: 'Set to "true" to auto-scroll and load lazy content before snapshot' },
  },
};

export async function handleSnapshot(params, config) {
  const page = getActivePage();
  if (!page) return "Error: no browser tab open. Use browser-open first.";

  const scroll = params?.scroll === "true" || params?.scroll === true;
  const title = await page.title();
  const snapshot = await getSnapshot(page, { scroll });
  return `Page: ${title}\nURL: ${page.url()}\n\n${snapshot}`;
}
