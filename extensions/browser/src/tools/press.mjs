import { getActivePage, resolveRef } from "../client.mjs";
import { getSnapshot } from "../utils/snapshot.mjs";
import { smartWait } from "../utils/wait.mjs";

export const toolDefinition = {
  name: "browser-press",
  description: "Press a key (Enter, Tab, Escape, etc). Returns updated snapshot.",
  parameters: {
    key: { type: "string", description: "Key to press (e.g. Enter, Tab, Escape)", required: true },
    ref: { type: "string", description: "Optional element ref to press key on", required: false },
  },
};

export async function handlePress(params, config) {
  if (!params.key) return "Error: key is required for press action (e.g. Enter)";
  const page = getActivePage();
  if (!page) return "No browser open.";

  if (params.ref) {
    const locator = resolveRef(page, params.ref);
    if (locator) await locator.first().press(params.key);
    else await page.keyboard.press(params.key);
  } else {
    await page.keyboard.press(params.key);
  }
  await smartWait(page, { ...config, smartWaitTimeout: 5000 });
  const snapshot = await getSnapshot(page);
  return `Pressed ${params.key}\nURL: ${page.url()}\n\n${snapshot}`;
}
