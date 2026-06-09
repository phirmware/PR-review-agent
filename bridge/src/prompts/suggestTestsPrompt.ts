import type { SuggestTestsProviderInput } from "@review-guide/shared";
import { renderFileContextPack } from "./contextPackPrompt.js";

const schema = {
  suggestedTests: ["string"],
  commands: ["string"]
};

export function buildSuggestTestsPrompt(input: SuggestTestsProviderInput): string {
  return `You are helping a human identify useful tests for a changed file in a PR.

File:
${input.file}

${renderFileContextPack(input.contextPack)}

Use the precomputed context pack first, especially likelyTestFiles and packageScripts. Inspect additional repo context only if needed.
Return only valid JSON matching this schema:
${JSON.stringify(schema, null, 2)}

Focus on:
- existing relevant tests
- missing test cases
- targeted test commands if obvious`;
}
