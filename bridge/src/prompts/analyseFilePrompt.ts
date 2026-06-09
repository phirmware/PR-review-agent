import type { AnalyseFileProviderInput } from "@review-guide/shared";
import { renderFileContextPack } from "./contextPackPrompt.js";

const schema = {
  file: "string",
  summary: ["string"],
  prContext: "string",
  risks: ["string"],
  reviewChecks: ["string"],
  suggestedTests: ["string"],
  suggestedComment: "optional string"
};

export function buildAnalyseFilePrompt(input: AnalyseFileProviderInput): string {
  return `You are helping a human review one changed file in a GitHub PR.

You are running inside a temporary git worktree for the PR branch.
Do not modify files.
Keep the response concise and useful inside a small browser-extension popover.

File:
${input.file}

Review this file diff:
git diff ${input.baseRef}...HEAD -- ${input.file}

${renderFileContextPack(input.contextPack)}

Use the precomputed context pack to explain how this file relates to the larger PR.
Inspect additional surrounding code, callers, and tests only when the context pack is insufficient.

Return only valid JSON matching this schema:
${JSON.stringify(schema, null, 2)}

Constraints:
- summary: 2-4 short bullets explaining what changed in this file.
- prContext: 1 short paragraph explaining how the file relates to the larger PR.
- risks: 2-5 short bullets.
- reviewChecks: 2-5 short bullets the reviewer should verify.
- suggestedTests: 1-4 short bullets or commands if obvious.
- suggestedComment: include only if there is a useful concise GitHub review comment.
- Do not include markdown.
- Do not include prose outside JSON.`;
}
