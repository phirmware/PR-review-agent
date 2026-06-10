import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyFileReviewControls,
  applyRiskBadges,
  getCurrentGitHubFileInViewport,
  getGitHubPrBaseBranch,
  getGitHubFileHeaders
} from "../src/githubDomAdapter";
import type { AnalysePrResponse } from "@review-guide/shared";

function installDom(html: string): void {
  const dom = new JSDOM(html, { url: "https://github.com/iag-loyalty/rewards-service/pull/123/files" });
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("CSS", {
    escape: (value: string) => value.replaceAll('"', '\\"')
  });
}

function makeAnalysis(overrides: Partial<AnalysePrResponse> = {}): AnalysePrResponse {
  return {
    summary: "Reviewed one file.",
    prUnderstanding: {
      purpose: "Exercise DOM adapter behavior.",
      affectedSystems: ["API layer"],
      potentialRisks: ["Review API contract implications."],
      keyBehaviorChanges: ["src/api.ts changed."]
    },
    reviewPlan: [
      {
        title: "Review API",
        reason: "API-facing change.",
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
        additions: 10,
        deletions: 2,
        risk: "medium",
        reason: "API-facing change.",
        signals: ["API contract"]
      }
    ],
    impactChains: [],
    worries: [],
    ...overrides
  };
}

describe("githubDomAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finds GitHub file headers and applies risk badges", () => {
    installDom(`
      <div class="file-header" data-path="src/api.ts">
        <a class="Link--primary" title="src/api.ts">src/api.ts</a>
      </div>
    `);

    const analysis = makeAnalysis();

    expect(getGitHubFileHeaders()).toHaveLength(1);
    applyRiskBadges(analysis);

    const badge = document.querySelector(".rg-review-guide-badge");
    expect(badge?.textContent).toBe("medium");
    expect(badge?.className).toContain("rg-review-guide-badge--medium");
  });

  it("detects the file nearest the review anchor in the viewport", () => {
    installDom(`
      <div class="file-header" data-path="src/first.ts">src/first.ts</div>
      <div class="file-header" data-path="src/current.ts">src/current.ts</div>
      <div class="file-header" data-path="src/next.ts">src/next.ts</div>
    `);

    const headers = [...document.querySelectorAll<HTMLElement>(".file-header")];
    const tops = [-300, 80, 500];
    headers.forEach((header, index) => {
      header.getBoundingClientRect = () =>
        ({
          top: tops[index],
          bottom: tops[index] + 40,
          left: 0,
          right: 100,
          width: 100,
          height: 40,
          x: 0,
          y: tops[index],
          toJSON: () => ({})
        }) as DOMRect;
    });

    expect(getCurrentGitHubFileInViewport()).toBe("src/current.ts");
  });

  it("adds contextual review controls to analysed file headers", () => {
    installDom(`
      <div class="file-header" data-path="src/api.ts">
        <a class="Link--primary" title="src/api.ts">src/api.ts</a>
      </div>
    `);

    applyFileReviewControls(
      makeAnalysis(),
      ["src/api.ts"],
      "src/api.ts"
    );

    const button = document.querySelector<HTMLButtonElement>("[data-rg-file-review='true']");
    expect(button?.textContent).toBe("Reviewed");
    expect(button?.dataset.rgFile).toBe("src/api.ts");
  });

  it("detects the PR target branch from GitHub PR header markup", () => {
    installDom(`
      <div>
        <span class="commit-ref base-ref">iag-loyalty:dev</span>
        <span class="commit-ref head-ref">feature-branch</span>
      </div>
    `);

    expect(getGitHubPrBaseBranch()).toBe("dev");
  });
});
