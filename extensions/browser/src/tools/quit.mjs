import { closeBrowser } from "../client.mjs";

export const toolDefinition = {
  name: "browser-quit",
  description: "Close the browser completely.",
  parameters: {},
};

export async function handleQuit(params, config) {
  await closeBrowser();
  return "Browser closed.";
}
