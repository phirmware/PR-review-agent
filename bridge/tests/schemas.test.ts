import { describe, expect, it } from "vitest";
import {
  analyseFileResponseSchema,
  analysePrResponseSchema,
  analysePrTraceResponseSchema,
  analysePrWorriesResponseSchema,
  askFileQuestionResponseSchema,
  extractJsonPayload,
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
});
