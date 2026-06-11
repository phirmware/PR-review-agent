import type { AnalysePrProviderInput } from "@review-guide/shared";
import { renderPrContextPack } from "./contextPackPrompt.js";

const finalSchema = {
  summary: "string",
  prUnderstanding: {
    purpose: "string",
    affectedSystems: ["string"],
    potentialRisks: ["string"],
    keyBehaviorChanges: ["string"]
  },
  reviewPlan: [],
  reviewOrder: [],
  skimFiles: [],
  suggestedChecks: [],
  changedFiles: [],
  impactChains: [],
  worries: []
};

export function buildAnalysePrStreamPrompt(input: AnalysePrProviderInput): string {
  return `You are helping a human understand a GitHub PR before they review code.

You are running inside a temporary git worktree for the PR branch.
Do not modify files.
Do not run destructive commands.

Review the diff:
${input.baseRef}...HEAD

${renderPrContextPack(input.contextPack)}

Return newline-delimited JSON events only.
Each line must be a complete valid JSON object.
Do not include markdown.
Do not include prose outside JSON lines.

Emit events in this order as soon as each answer is ready:
{"type":"partial","field":"summary","text":"one concise senior-reviewer summary"}
{"type":"partial","field":"purpose","text":"the purpose of the PR in business/product/technical terms"}
{"type":"partial","field":"affectedSystems","items":["system or runtime area"]}
{"type":"partial","field":"potentialRisks","items":["risk worth verifying"]}
{"type":"partial","field":"keyBehaviorChanges","items":["behavior change visible from the diff and repo context"]}
{"type":"final","result":${JSON.stringify(finalSchema)}}

Guidelines:
- This stream is only for PR Understanding.
- Keep each field concise enough for a docked side panel.
- Explain the PR like a senior engineer, not like a file counter.
- Use repo context where it materially improves the explanation.
- Do not produce review plan, heatmap, impact chains, worries, or changed file lists here.
- The final result must match the schema exactly and must keep all later sections as [].

You may inspect the repo using read-only commands like:
- git diff --stat ${input.baseRef}...HEAD
- git diff --name-only ${input.baseRef}...HEAD
- git diff ${input.baseRef}...HEAD -- <file>
- rg for call sites

Do not modify files.`;
}
