import type { AnalysePrProviderInput } from "@review-guide/shared";

const schema = {
  summary: "string",
  prUnderstanding: {
    purpose: "string",
    affectedSystems: ["string"],
    potentialRisks: ["string"],
    keyBehaviorChanges: ["string"]
  },
  reviewPlan: [
    {
      title: "string",
      reason: "string",
      files: ["string"],
      suggestedFocus: "string"
    }
  ],
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
  ],
  impactChains: [
    {
      title: "string",
      nodes: ["string"],
      explanation: "string",
      risk: "low | medium | high"
    }
  ],
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

export function buildAnalysePrPrompt(input: AnalysePrProviderInput): string {
  return `You are helping a human review a GitHub PR.

You are running inside a temporary git worktree for the PR branch.
Do not modify files.
Do not run destructive commands.
Use the local repository context to understand the change.

Review the diff:
${input.baseRef}...HEAD

Focus on:
- explaining this PR like a senior engineer before the reviewer reads code
- the purpose of the PR in business/product/technical terms
- affected systems or runtime areas
- potential risks and likely bugs
- a suggested review plan before reading files
- risky files and why they deserve attention
- risk signals such as business logic, auth, config, tests, concurrency, schema, API contract, payments, UI, data flow, and error handling
- files safe to skim
- missing or weak tests
- impact chains where one changed file/function/schema likely drives another
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

Guidelines:
- Keep the response concise enough for a docked review panel.
- Use actual changed file paths in files, reviewOrder, reviewPlan, impactChains, and worries.
- For impactChains, infer likely chains from local context and changed files. Do not invent exact call paths when uncertain; describe them as likely impact chains.
- For worries, focus on the most likely bugs or missed review checks, not generic advice.
- Include the legacy fields summary, reviewOrder, skimFiles, suggestedChecks, and changedFiles because the extension uses them for badges and file actions.

Do not modify files.`;
}
