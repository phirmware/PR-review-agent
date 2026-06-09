import { describe, expect, it } from "vitest";
import {
  analyseFileResponseSchema,
  analysePrResponseSchema,
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
        reviewOrder: [],
        skimFiles: [],
        suggestedChecks: [],
        changedFiles: []
      })
    ).toEqual({
      summary: "Reviewed.",
      reviewOrder: [],
      skimFiles: [],
      suggestedChecks: [],
      changedFiles: []
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
