import type { AnalysePrPlanProviderInput } from "@review-guide/shared";
import { renderPrContextPack } from "./contextPackPrompt.js";

const schema = {
  reviewPlan: [
    {
      title: "string",
      reason: "string",
      files: ["string"],
      suggestedFocus: "string"
    }
  ]
};

export function buildAnalysePrPlanPrompt(input: AnalysePrPlanProviderInput): string {
  return `You are helping a human plan a GitHub PR review.

You are running inside a temporary git worktree for the PR branch.
Do not modify files.
Do not run destructive commands.

Review the diff:
${input.baseRef}...HEAD

${renderPrContextPack(input.contextPack)}

Focus only on review order:
- where the reviewer should start
- why each step matters
- which files belong to each step
- what the reviewer should focus on in that step

Return only valid JSON matching this schema:
${JSON.stringify(schema, null, 2)}

Do not include markdown.
Do not include prose outside the JSON.

Guidelines:
- Keep this concise and useful in a docked side panel.
- Use actual changed file paths.
- Prefer 3-6 ordered steps.
- Do not produce file risk badges, impact chains, or worries in this response.

Do not modify files.`;
}
