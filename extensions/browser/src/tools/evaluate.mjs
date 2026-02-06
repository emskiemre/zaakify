import { getActivePage } from "../client.mjs";

export const toolDefinition = {
  name: "browser-evaluate",
  description: "Run JavaScript in the page. Returns the result.",
  parameters: {
    code: { type: "string", description: "JavaScript code to evaluate in the page", required: true },
  },
};

export async function handleEvaluate(params, config) {
  if (!params.code) return "Error: code is required for evaluate action";
  const page = getActivePage();
  if (!page) return "No browser open.";
  const result = await page.evaluate(params.code);
  return `Result: ${JSON.stringify(result, null, 2)}`;
}
