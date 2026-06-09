import type { PreApprovalProviderInput } from "@review-guide/shared";

const schema = {
  remainingRisks: [
    {
      file: "string",
      risk: "low | medium | high",
      reason: "string"
    }
  ],
  recommendation: "approve | comment | request_changes",
  summary: "string"
};

export function buildPreApprovalPrompt(input: PreApprovalProviderInput): string {
  return `You are helping a human do a final sanity check before submitting a GitHub PR review.

The reviewer has marked these files as reviewed:
${JSON.stringify(input.reviewedFiles, null, 2)}

Review the full diff:
${input.baseRef}...HEAD

Return only valid JSON matching this schema:
${JSON.stringify(schema, null, 2)}

Focus on:
- high-risk changed files not reviewed
- untested behaviour changes
- API/schema/config/security concerns
- whether the likely next action is approve, comment, or request changes`;
}
