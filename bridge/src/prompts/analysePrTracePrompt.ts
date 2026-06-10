import type { AnalysePrTraceProviderInput } from "@review-guide/shared";
import { renderPrContextPack } from "./contextPackPrompt.js";

const schema = {
  impactChains: [
    {
      title: "string",
      nodes: ["string"],
      explanation: "string",
      risk: "low | medium | high"
    }
  ]
};

export function buildAnalysePrTracePrompt(input: AnalysePrTraceProviderInput): string {
  return `You are helping a human trace the impact of a GitHub PR.

You are running inside a temporary git worktree for the PR branch.
Do not modify files.
Do not run destructive commands.

Review the diff:
${input.baseRef}...HEAD

${renderPrContextPack(input.contextPack)}

Task:
- Produce likely impact chains where one changed file, schema, function, API, or behavior likely drives another.
- Prefer concrete changed file paths from the PR.
- Keep each chain short enough for a browser-extension panel.
- If uncertain, describe the chain as likely and explain the uncertainty.
- Inspect additional diffs, callers, or tests only when the context pack is insufficient.

Return only valid JSON matching this schema:
${JSON.stringify(schema, null, 2)}

Do not include markdown.
Do not include prose outside the JSON.
Do not modify files.`;
}
