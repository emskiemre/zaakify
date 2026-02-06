import { getActivePage } from "../client.mjs";

export const toolDefinition = {
  name: "browser-close",
  description: "Close the current tab. Switches to next available tab.",
  parameters: {},
};

export async function handleClose(params, config) {
  const page = getActivePage();
  if (!page) return "No tab to close.";
  await page.close();
  const nextPage = getActivePage();
  if (nextPage) {
    const title = await nextPage.title();
    return `Tab closed. Active tab: ${title} — ${nextPage.url()}`;
  }
  return "Tab closed. No tabs remaining.";
}
