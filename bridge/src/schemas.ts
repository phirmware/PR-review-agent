import { z } from "zod";

export const riskLevelSchema = z.enum(["low", "medium", "high"]);
export const providerNameSchema = z.enum(["mock", "claude-code", "copilot-cli"]);
const repoIdentityPartSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_.-]+$/, "Use only letters, numbers, dots, underscores, or hyphens.")
  .refine((value) => value !== "." && value !== "..", "Path traversal segments are not allowed.");

export const repoIdentitySchema = z.object({
  host: repoIdentityPartSchema,
  owner: repoIdentityPartSchema,
  repo: repoIdentityPartSchema
});

export const pullRequestIdentitySchema = repoIdentitySchema.extend({
  prNumber: z.coerce.number().int().positive()
});

export const bindRepoRequestSchema = repoIdentitySchema.extend({
  localPath: z.string().min(1)
});

export const explainFileRequestSchema = pullRequestIdentitySchema.extend({
  file: z.string().min(1)
});

export const askFileQuestionRequestSchema = explainFileRequestSchema.extend({
  question: z.string().min(1).max(1000),
  selectedText: z.string().max(4000).optional()
});

export const preApprovalRequestSchema = pullRequestIdentitySchema.extend({
  reviewedFiles: z.array(z.string().min(1))
});

export const cleanupWorktreesRequestSchema = z.object({
  olderThanDays: z.number().int().nonnegative()
});

export const updateProviderRequestSchema = z.object({
  provider: providerNameSchema
});

export const changedFileSchema = z.object({
  file: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  risk: riskLevelSchema,
  reason: z.string().min(1)
});

export const analysePrResponseSchema = z.object({
  summary: z.string().min(1),
  reviewOrder: z.array(
    z.object({
      file: z.string().min(1),
      risk: riskLevelSchema,
      reason: z.string().min(1),
      suggestedAction: z.string().min(1)
    })
  ),
  skimFiles: z.array(z.string().min(1)),
  suggestedChecks: z.array(z.string().min(1)),
  changedFiles: z.array(changedFileSchema)
});

export const explainFileResponseSchema = z.object({
  file: z.string().min(1),
  explanation: z.string().min(1),
  thingsToCheck: z.array(z.string().min(1)),
  possibleCallers: z.array(z.string().min(1)),
  suggestedTests: z.array(z.string().min(1))
});

export const analyseFileResponseSchema = z.object({
  file: z.string().min(1),
  summary: z.array(z.string().min(1)).max(5),
  prContext: z.string().min(1),
  risks: z.array(z.string().min(1)).max(6),
  reviewChecks: z.array(z.string().min(1)).max(6),
  suggestedTests: z.array(z.string().min(1)).max(6),
  suggestedComment: z.string().min(1).optional()
});

export const askFileQuestionResponseSchema = z.object({
  file: z.string().min(1),
  answer: z.array(z.string().min(1)).max(5),
  suggestedComment: z.string().min(1).optional(),
  confidence: z.enum(["low", "medium", "high"])
});

export const suggestTestsResponseSchema = z.object({
  suggestedTests: z.array(z.string().min(1)),
  commands: z.array(z.string().min(1))
});

export const preApprovalCheckResponseSchema = z.object({
  remainingRisks: z.array(
    z.object({
      file: z.string().min(1),
      risk: riskLevelSchema,
      reason: z.string().min(1)
    })
  ),
  recommendation: z.enum(["approve", "comment", "request_changes"]),
  summary: z.string().min(1)
});

export function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }

  return trimmed;
}
