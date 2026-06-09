import type { AnalysePrProviderInput } from "@review-guide/shared";

const schema = {
  summary: "string",
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
      reason: "string"
    }
  ]
};

export function buildAnalysePrPrompt(input: AnalysePrProviderInput): string {
  return `You are helping a human review a GitHub PR.

You are running inside a temporary git worktree for the PR branch.
Do not modify files.
Do not run destructive commands.
Use the local repository context to understand the change.

Review the diff:
${input.baseRef}...HEAD

Focus on:
- what changed
- suggested review order
- risky files
- files safe to skim
- missing or weak tests
- API/schema/config/security implications
- specific things the human reviewer should verify

Return only valid JSON matching this schema:
${JSON.stringify(schema, null, 2)}

Do not include markdown.
Do not include prose outside the JSON.

You may inspect the repo using read-only commands like:
- git diff --stat ${input.baseRef}...HEAD
- git diff --name-only ${input.baseRef}...HEAD
- git diff ${input.baseRef}...HEAD -- <file>
- rg for call sites
- inspect nearby tests

Do not modify files.`;
}
