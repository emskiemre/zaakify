import { getActivePage } from "../client.mjs";
import { getSnapshot } from "../utils/snapshot.mjs";

export const toolDefinition = {
  name: "browser-scroll",
  description: 'Scroll the page up or down. Returns updated snapshot.',
  parameters: {
    direction: { type: "string", description: '"up" or "down" (default: down)', required: false },
  },
};

export async function handleScroll(params, config) {
  const page = getActivePage();
  if (!page) return "No browser open.";
  const dir = params.direction === "up" ? -500 : 500;
  await page.mouse.wheel(0, dir);
  await page.waitForTimeout(800);
  const snapshot = await getSnapshot(page);
  return `Scrolled ${params.direction || "down"}\nURL: ${page.url()}\n\n${snapshot}`;
}
