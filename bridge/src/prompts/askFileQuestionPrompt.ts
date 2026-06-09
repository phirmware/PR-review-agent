import type { AskFileQuestionProviderInput } from "@review-guide/shared";
import { renderFileContextPack } from "./contextPackPrompt.js";

const schema = {
  file: "string",
  answer: ["string"],
  suggestedComment: "optional string",
  confidence: "low | medium | high"
};

export function buildAskFileQuestionPrompt(input: AskFileQuestionProviderInput): string {
  return `You are helping a human review one file in a GitHub PR.

You are running inside a temporary git worktree for the PR branch.
Do not modify files.
Answer concisely for a browser-extension popover.

File:
${input.file}

Reviewer question:
${input.question}

${
  input.selectedText
    ? `Selected diff text:
${input.selectedText}`
    : "No selected diff text was provided."
}

Use this diff and local repo context:
git diff ${input.baseRef}...HEAD -- ${input.file}

${renderFileContextPack(input.contextPack)}

Use the precomputed context pack first. Inspect additional repo context only if needed to answer the reviewer's question accurately.

Return only valid JSON matching this schema:
${JSON.stringify(schema, null, 2)}

Constraints:
- answer: 1-4 concise bullets.
- suggestedComment: include only if the reviewer likely needs to leave a concise GitHub review comment.
- confidence: low, medium, or high.
- Do not include markdown.
- Do not include prose outside JSON.`;
}
