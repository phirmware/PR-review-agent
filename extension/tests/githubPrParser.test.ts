import { describe, expect, it } from "vitest";
import { parseGitHubPrUrl } from "../src/githubPrParser";

describe("parseGitHubPrUrl", () => {
  it("parses GitHub PR overview URLs", () => {
    expect(parseGitHubPrUrl("https://github.com/iag-loyalty/rewards-service/pull/123")).toEqual({
      host: "github.com",
      owner: "iag-loyalty",
      repo: "rewards-service",
      prNumber: 123
    });
  });

  it("parses GitHub PR files URLs", () => {
    expect(parseGitHubPrUrl("https://github.com/iag-loyalty/rewards-service/pull/123/files")).toEqual({
      host: "github.com",
      owner: "iag-loyalty",
      repo: "rewards-service",
      prNumber: 123
    });
  });

  it("parses GitHub PR changes URLs", () => {
    expect(parseGitHubPrUrl("https://github.com/iagl-loyalty/currency-globalcurrency-gatekeeper/pull/130/changes")).toEqual({
      host: "github.com",
      owner: "iagl-loyalty",
      repo: "currency-globalcurrency-gatekeeper",
      prNumber: 130
    });
  });

  it("rejects non-PR URLs", () => {
    expect(parseGitHubPrUrl("https://github.com/iag-loyalty/rewards-service")).toBeNull();
  });
});
