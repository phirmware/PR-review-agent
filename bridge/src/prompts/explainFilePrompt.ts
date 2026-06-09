import type { ExplainFileProviderInput } from "@review-guide/shared";
import { renderFileContextPack } from "./contextPackPrompt.js";

const schema = {
  file: "string",
  explanation: "string",
  thingsToCheck: ["string"],
  possibleCallers: ["string"],
  suggestedTests: ["string"]
};

export function buildExplainFilePrompt(input: ExplainFileProviderInput): string {
  return `You are helping a human review a specific file in a GitHub PR.

You are running inside a temporary git worktree for the PR branch.
Do not modify files.

File:
${input.file}

Review the diff:
git diff ${input.baseRef}...HEAD -- ${input.file}

${renderFileContextPack(input.contextPack)}

Use the precomputed context pack first. Inspect additional surrounding code, callers, and nearby tests only if helpful.

Return only valid JSON matching this schema:
${JSON.stringify(schema, null, 2)}

Focus on:
- what changed in this file
- why it matters
- what the reviewer should verify
- possible callers
- suggested tests`;
}
