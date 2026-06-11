import { describe, expect, it } from "vitest";
import {
  analyseFileResponseSchema,
  analysePrHeatmapResponseSchema,
  analysePrPlanResponseSchema,
  analysePrProviderStreamEventSchema,
  analysePrResponseSchema,
  analysePrTraceResponseSchema,
  analysePrWorriesResponseSchema,
  askFileQuestionResponseSchema,
  extractJsonPayload,
  pullRequestIdentitySchema,
  repoIdentitySchema
} from "../src/schemas";

describe("schemas", () => {
  it("extracts markdown-wrapped provider JSON", () => {
    expect(extractJsonPayload("```json\n{\"summary\":\"ok\"}\n```")).toBe("{\"summary\":\"ok\"}");
  });

  it("validates analyse-pr provider output", () => {
    expect(
      analysePrResponseSchema.parse({
        summary: "Reviewed.",
        prUnderstanding: {
          purpose: "Adds guided review output.",
          affectedSystems: ["API layer"],
          potentialRisks: ["API contract drift"],
          keyBehaviorChanges: ["src/api.ts changed."]
        },
        reviewPlan: [
          {
            title: "Review API",
            reason: "API-facing behavior changed.",
            files: ["src/api.ts"],
            suggestedFocus: "Check callers and tests."
          }
        ],
        reviewOrder: [],
        skimFiles: [],
        suggestedChecks: [],
        changedFiles: [
          {
            file: "src/api.ts",
            additions: 3,
            deletions: 1,
            risk: "medium",
            reason: "API-facing behavior changed.",
            signals: ["API contract"]
          }
        ],
        impactChains: [
          {
            title: "API impact",
            nodes: ["src/api.ts", "src/api.test.ts"],
            explanation: "The API change should be reflected in tests.",
            risk: "medium"
          }
        ],
        worries: [
          {
            title: "Missing regression coverage",
            reason: "The behavior should be covered by a focused test.",
            files: ["src/api.ts"],
            suggestedCheck: "Run API tests.",
            risk: "medium"
          }
        ]
      })
    ).toMatchObject({
      summary: "Reviewed.",
      prUnderstanding: {
        purpose: "Adds guided review output."
      },
      reviewPlan: [
        {
          title: "Review API"
        }
      ],
      changedFiles: [
        {
          signals: ["API contract"]
        }
      ]
    });
  });

  it("validates lazy PR guide section output", () => {
    expect(
      analysePrPlanResponseSchema.parse({
        reviewPlan: [
          {
            title: "Review API behavior",
            reason: "API-facing code changed.",
            files: ["src/api.ts"],
            suggestedFocus: "Check callers and tests."
          }
        ]
      })
    ).toMatchObject({
      reviewPlan: [
        {
          title: "Review API behavior"
        }
      ]
    });

    expect(
      analysePrHeatmapResponseSchema.parse({
        reviewOrder: [
          {
            file: "src/api.ts",
            risk: "medium",
            reason: "API-facing behavior changed.",
            suggestedAction: "Review callers before skimming tests."
          }
        ],
        skimFiles: ["src/api.test.ts"],
        suggestedChecks: ["Run API tests."],
        changedFiles: [
          {
            file: "src/api.ts",
            additions: 3,
            deletions: 1,
            risk: "medium",
            reason: "API-facing behavior changed.",
            signals: ["API contract"]
          }
        ]
      })
    ).toMatchObject({
      changedFiles: [
        {
          signals: ["API contract"]
        }
      ]
    });

    expect(
      analysePrTraceResponseSchema.parse({
        impactChains: [
          {
            title: "API impact",
            nodes: ["src/api.ts", "src/api.test.ts"],
            explanation: "The API change should be reflected in tests.",
            risk: "medium"
          }
        ]
      })
    ).toMatchObject({
      impactChains: [
        {
          risk: "medium"
        }
      ]
    });

    expect(
      analysePrWorriesResponseSchema.parse({
        worries: [
          {
            title: "Missing regression coverage",
            reason: "The behavior should be covered by a focused test.",
            files: ["src/api.ts"],
            suggestedCheck: "Run API tests.",
            risk: "medium"
          }
        ]
      })
    ).toMatchObject({
      worries: [
        {
          title: "Missing regression coverage"
        }
      ]
    });
  });

  it("validates streamed PR understanding events", () => {
    expect(
      analysePrProviderStreamEventSchema.parse({
        type: "partial",
        field: "purpose",
        text: "Adds guided review streaming."
      })
    ).toMatchObject({
      field: "purpose"
    });

    expect(
      analysePrProviderStreamEventSchema.parse({
        type: "partial",
        field: "potentialRisks",
        items: ["Streaming output could be malformed."]
      })
    ).toMatchObject({
      items: ["Streaming output could be malformed."]
    });

    expect(
      analysePrProviderStreamEventSchema.parse({
        type: "final",
        result: {
          summary: "Reviewed.",
          prUnderstanding: {
            purpose: "Adds guided review streaming.",
            affectedSystems: ["Bridge"],
            potentialRisks: ["Malformed stream events"],
            keyBehaviorChanges: ["Understanding can render before final JSON."]
          },
          reviewPlan: [],
          reviewOrder: [],
          skimFiles: [],
          suggestedChecks: [],
          changedFiles: [],
          impactChains: [],
          worries: []
        }
      })
    ).toMatchObject({
      result: {
        prUnderstanding: {
          purpose: "Adds guided review streaming."
        }
      }
    });
  });

  it("validates file analysis and file question output", () => {
    expect(
      analyseFileResponseSchema.parse({
        file: "src/api.ts",
        summary: ["Changed API behavior."],
        prContext: "Part of a larger API update.",
        risks: ["Check downstream consumers."],
        reviewChecks: ["Verify error handling."],
        suggestedTests: ["Run focused API tests."]
      })
    ).toMatchObject({
      file: "src/api.ts"
    });

    expect(
      askFileQuestionResponseSchema.parse({
        file: "src/api.ts",
        answer: ["Check the caller behavior before approving."],
        suggestedComment: "Can we add coverage for this edge case?",
        confidence: "medium"
      })
    ).toMatchObject({
      confidence: "medium"
    });
  });

  it("rejects repo identity path traversal segments", () => {
    expect(() =>
      repoIdentitySchema.parse({
        host: "github.com",
        owner: "..",
        repo: "rewards-service"
      })
    ).toThrow();
  });

  it("accepts a normal base branch hint on PR requests", () => {
    expect(
      pullRequestIdentitySchema.parse({
        host: "github.com",
        owner: "iag-loyalty",
        repo: "rewards-service",
        prNumber: 123,
        baseBranchHint: "release/dev"
      })
    ).toMatchObject({
      baseBranchHint: "release/dev"
    });
  });
});
