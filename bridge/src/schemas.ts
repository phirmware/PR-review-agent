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

export const baseBranchHintSchema = z
  .string()
  .trim()
  .min(1)
  .max(250)
  .regex(/^[A-Za-z0-9._/-]+$/, "Use a normal branch name such as dev, main, or release/foo.")
  .optional();

export const pullRequestIdentitySchema = repoIdentitySchema.extend({
  prNumber: z.coerce.number().int().positive(),
  baseBranchHint: baseBranchHintSchema
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
  reason: z.string().min(1),
  signals: z.array(z.string().min(1)).optional()
});

export const reviewPlanStepSchema = z.object({
  title: z.string().min(1),
  reason: z.string().min(1),
  files: z.array(z.string().min(1)),
  suggestedFocus: z.string().min(1)
});

export const reviewOrderItemSchema = z.object({
  file: z.string().min(1),
  risk: riskLevelSchema,
  reason: z.string().min(1),
  suggestedAction: z.string().min(1)
});

export const analysePrResponseSchema = z.object({
  summary: z.string().min(1),
  prUnderstanding: z.object({
    purpose: z.string().min(1),
    affectedSystems: z.array(z.string().min(1)),
    potentialRisks: z.array(z.string().min(1)),
    keyBehaviorChanges: z.array(z.string().min(1))
  }),
  reviewPlan: z.array(reviewPlanStepSchema),
  reviewOrder: z.array(reviewOrderItemSchema),
  skimFiles: z.array(z.string().min(1)),
  suggestedChecks: z.array(z.string().min(1)),
  changedFiles: z.array(changedFileSchema),
  impactChains: z.array(
    z.object({
      title: z.string().min(1),
      nodes: z.array(z.string().min(1)),
      explanation: z.string().min(1),
      risk: riskLevelSchema
    })
  ),
  worries: z.array(
    z.object({
      title: z.string().min(1),
      reason: z.string().min(1),
      files: z.array(z.string().min(1)),
      suggestedCheck: z.string().min(1),
      risk: riskLevelSchema
    })
  )
});

const analysePrTextPartialStreamEventSchema = z.object({
  type: z.literal("partial"),
  field: z.enum(["summary", "purpose"]),
  text: z.string().min(1)
});

const analysePrListPartialStreamEventSchema = z.object({
  type: z.literal("partial"),
  field: z.enum(["affectedSystems", "potentialRisks", "keyBehaviorChanges"]),
  items: z.array(z.string().min(1))
});

export const analysePrProviderStreamEventSchema = z.union([
  analysePrTextPartialStreamEventSchema,
  analysePrListPartialStreamEventSchema,
  z.object({
    type: z.literal("final"),
    result: analysePrResponseSchema
  })
]);

export const analysePrPlanResponseSchema = z.object({
  reviewPlan: z.array(reviewPlanStepSchema)
});

export const analysePrHeatmapResponseSchema = z.object({
  reviewOrder: z.array(reviewOrderItemSchema),
  skimFiles: z.array(z.string().min(1)),
  suggestedChecks: z.array(z.string().min(1)),
  changedFiles: z.array(changedFileSchema)
});

export const analysePrTraceResponseSchema = z.object({
  impactChains: z.array(
    z.object({
      title: z.string().min(1),
      nodes: z.array(z.string().min(1)),
      explanation: z.string().min(1),
      risk: riskLevelSchema
    })
  )
});

export const analysePrWorriesResponseSchema = z.object({
  worries: z.array(
    z.object({
      title: z.string().min(1),
      reason: z.string().min(1),
      files: z.array(z.string().min(1)),
      suggestedCheck: z.string().min(1),
      risk: riskLevelSchema
    })
  )
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
