import type { AnalysePrWorriesProviderInput } from "@review-guide/shared";
import { renderPrContextPack } from "./contextPackPrompt.js";

const schema = {
  worries: [
    {
      title: "string",
      reason: "string",
      files: ["string"],
      suggestedCheck: "string",
      risk: "low | medium | high"
    }
  ]
};

export function buildAnalysePrWorriesPrompt(input: AnalysePrWorriesProviderInput): string {
  return `You are helping a human identify what to worry about before reviewing or approving a GitHub PR.

You are running inside a temporary git worktree for the PR branch.
Do not modify files.
Do not run destructive commands.

Review the diff:
${input.baseRef}...HEAD

${renderPrContextPack(input.contextPack)}

Task:
- Identify the most likely bugs, missed checks, risky assumptions, or fragile behavior in this PR.
- Focus on concrete worries the reviewer can verify, not generic advice.
- Prefer actual changed file paths from the PR.
- Include a concise suggested check for each worry.
- Inspect additional diffs, callers, or tests only when the context pack is insufficient.

Return only valid JSON matching this schema:
${JSON.stringify(schema, null, 2)}

Do not include markdown.
Do not include prose outside the JSON.
Do not modify files.`;
}
