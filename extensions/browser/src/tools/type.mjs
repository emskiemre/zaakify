import { getActivePage, resolveRef } from "../client.mjs";
import { getSnapshot } from "../utils/snapshot.mjs";
import { humanMouseMove, humanDelay } from "../utils/human.mjs";

export const toolDefinition = {
  name: "browser-type",
  description: "Type text into an element by ref. Returns updated snapshot.",
  parameters: {
    ref: { type: "string", description: 'Element ref to type into (e.g. "e3")', required: true },
    text: { type: "string", description: "Text to type", required: true },
  },
};

export async function handleType(params, config) {
  if (!params.ref) return "Error: ref is required for type action";
  if (!params.text) return "Error: text is required for type action";
  const page = getActivePage();
  if (!page) return "No browser open.";
  const locator = resolveRef(page, params.ref);
  if (!locator) return `Error: ref '${params.ref}' not found.`;

  // Human-like interaction: move mouse to input first
  await humanMouseMove(page, locator.first());
  await humanDelay(100, 200);

  try {
    await locator.first().click({ timeout: 5000 });
    await humanDelay(150, 300); // Pause after focusing input
    
    // Type with human-like delays between characters
    for (const char of params.text) {
      await page.keyboard.type(char);
      const isSpace = char === ' ';
      const isPunctuation = ['.', ',', '!', '?', ';', ':'].includes(char);
      
      if (isSpace) {
        await humanDelay(120, 200);
      } else if (isPunctuation) {
        await humanDelay(150, 300);
      } else {
        await humanDelay(50, 150); // Normal typing speed
      }
    }
  } catch {
    // Fallback for tricky inputs
    await locator.first().click({ timeout: 5000 });
    await page.keyboard.type(params.text, { delay: 100 }); // Slower for compatibility
  }
  
  await humanDelay(200, 400); // Pause after finishing typing
  const snapshot = await getSnapshot(page);
  return `Typed "${params.text}" into ${params.ref}\nURL: ${page.url()}\n\n${snapshot}`;
}
