import { getActivePage, getPages } from "../client.mjs";

export const toolDefinition = {
  name: "browser-tabs",
  description: "List all open browser tabs.",
  parameters: {},
};

export async function handleTabs(params, config) {
  const pages = getPages();
  if (pages.size === 0) return "No tabs open.";
  const active = getActivePage();
  const lines = [];
  for (const [id, page] of pages) {
    if (page.isClosed()) continue;
    const title = await page.title();
    const isActive = page === active ? " (active)" : "";
    lines.push(`${id}: ${title} — ${page.url()}${isActive}`);
  }
  return lines.join("\n") || "No tabs open.";
}
