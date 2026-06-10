import type { AnalysePrHeatmapProviderInput } from "@review-guide/shared";
import { renderPrContextPack } from "./contextPackPrompt.js";

const schema = {
  reviewOrder: [
    {
      file: "string",
      risk: "low | medium | high",
      reason: "string",
      suggestedAction: "string"
    }
  ],
  skimFiles: ["string"],
  suggestedChecks: ["string"],
  changedFiles: [
    {
      file: "string",
      additions: 0,
      deletions: 0,
      risk: "low | medium | high",
      reason: "string",
      signals: ["business logic | auth | config | tests | concurrency | schema | API contract | payments | UI | data flow | error handling"]
    }
  ]
};

export function buildAnalysePrHeatmapPrompt(input: AnalysePrHeatmapProviderInput): string {
  return `You are helping a human review changed files in a GitHub PR.

You are running inside a temporary git worktree for the PR branch.
Do not modify files.
Do not run destructive commands.

Review the diff:
${input.baseRef}...HEAD

${renderPrContextPack(input.contextPack)}

Focus only on file-level review guidance:
- risk level for each changed file
- clear reason for each risk level
- risk signals such as business logic, auth, config, tests, concurrency, schema, API contract, payments, UI, data flow, and error handling
- suggested review order for files
- files safe to skim
- concrete checks/tests the reviewer should run or verify

Return only valid JSON matching this schema:
${JSON.stringify(schema, null, 2)}

Do not include markdown.
Do not include prose outside the JSON.

You may inspect read-only context if needed:
- git diff --stat ${input.baseRef}...HEAD
- git diff --name-only ${input.baseRef}...HEAD
- git diff ${input.baseRef}...HEAD -- <file>
- rg for call sites
- inspect nearby tests

Guidelines:
- Use actual changed file paths.
- Do not blindly follow heuristic risk labels from the context pack. Correct them when repo context suggests better judgment.
- Do not produce PR purpose, review plan steps, impact chains, or worries in this response.

Do not modify files.`;
}
