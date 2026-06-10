import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysePrResponse } from "@review-guide/shared";
import { ReviewPanel, type ReviewPanelCallbacks } from "../src/reviewPanel";

function installDom(): void {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
}

function callbacks(overrides: Partial<ReviewPanelCallbacks> = {}): ReviewPanelCallbacks {
  return {
    onClose: vi.fn(),
    onConnectRepo: vi.fn(),
    onAnalysePr: vi.fn(),
    onExplainFile: vi.fn(),
    onSuggestTests: vi.fn(),
    onToggleReviewed: vi.fn(),
    onPreApprovalCheck: vi.fn(),
    onJumpToFile: vi.fn(),
    onLocalRepoPathInput: vi.fn(),
    onSelectFile: vi.fn(),
    onNextFile: vi.fn(),
    onPreviousFile: vi.fn(),
    onProviderChange: vi.fn(),
    onSelectGuideSection: vi.fn(),
    onLoadGuideSection: vi.fn(),
    onBaseBranchHintInput: vi.fn(),
    ...overrides
  };
}

function makeAnalysis(overrides: Partial<AnalysePrResponse> = {}): AnalysePrResponse {
  return {
    summary: "Adds caching around loyalty balances.",
    prUnderstanding: {
      purpose: "Adds loyalty balance caching to reduce API calls.",
      affectedSystems: ["Loyalty API", "Cache layer"],
      potentialRisks: ["Stale balances"],
      keyBehaviorChanges: ["cacheService.ts stores balances before API retrieval."]
    },
    reviewPlan: [
      {
        title: "Review cache invalidation",
        reason: "Stale balances are the main risk.",
        files: ["src/cacheService.ts"],
        suggestedFocus: "Check expiry and refresh behavior."
      }
    ],
    reviewOrder: [
      {
        file: "src/cacheService.ts",
        risk: "high",
        reason: "Touches cache behavior.",
        suggestedAction: "Review full diff."
      }
    ],
    skimFiles: ["src/cacheService.test.ts"],
    suggestedChecks: ["Run cache tests."],
    changedFiles: [
      {
        file: "src/cacheService.ts",
        additions: 40,
        deletions: 8,
        risk: "high",
        reason: "Touches cache behavior.",
        signals: ["business logic", "concurrency"]
      }
    ],
    impactChains: [
      {
        title: "Balance cache impact",
        nodes: ["src/cacheService.ts", "src/balanceController.ts"],
        explanation: "The controller now depends on cached balance behavior.",
        risk: "high"
      }
    ],
    worries: [
      {
        title: "Stale balances",
        reason: "Cached balances may outlive their valid refresh window.",
        files: ["src/cacheService.ts"],
        suggestedCheck: "Verify invalidation and refresh tests.",
        risk: "high"
      }
    ],
    ...overrides
  };
}

describe("ReviewPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders one active guide section at a time and emits section changes", () => {
    installDom();
    const onSelectGuideSection = vi.fn();
    const panel = new ReviewPanel(callbacks({ onSelectGuideSection }));

    panel.render({
      isOpen: true,
      bridgeStatus: "connected",
      pr: {
        host: "github.com",
        owner: "iag-loyalty",
        repo: "rewards-service",
        prNumber: 123
      },
      binding: {
        found: true,
        localPath: "/tmp/rewards-service"
      },
      analysis: makeAnalysis(),
      activeGuideSection: "understanding",
      explainByFile: {},
      testsByFile: {},
      reviewedFiles: [],
      analysedFiles: [],
      activeFile: "src/cacheService.ts",
      localRepoPathInput: ""
    });

    expect(document.body.textContent).toContain("PR Understanding");
    expect(document.body.textContent).toContain("Adds loyalty balance caching");
    expect(document.body.textContent).not.toContain("Balance cache impact");

    document.querySelector<HTMLButtonElement>("[data-rg-section='trace']")?.click();
    expect(onSelectGuideSection).toHaveBeenCalledWith("trace");

    panel.render({
      isOpen: true,
      bridgeStatus: "connected",
      analysis: makeAnalysis(),
      activeGuideSection: "trace",
      explainByFile: {},
      testsByFile: {},
      reviewedFiles: [],
      analysedFiles: [],
      activeFile: "src/cacheService.ts",
      localRepoPathInput: ""
    });

    expect(document.body.textContent).toContain("Change Tracing");
    expect(document.body.textContent).toContain("Balance cache impact");
    expect(document.body.textContent).not.toContain("PR Understanding");
  });

  it("renders lazy section loading controls when trace has not been generated", () => {
    installDom();
    const onLoadGuideSection = vi.fn();
    const panel = new ReviewPanel(callbacks({ onLoadGuideSection }));

    panel.render({
      isOpen: true,
      bridgeStatus: "connected",
      analysis: makeAnalysis({ impactChains: [] }),
      activeGuideSection: "trace",
      loadedGuideSections: {
        trace: false
      },
      explainByFile: {},
      testsByFile: {},
      reviewedFiles: [],
      analysedFiles: [],
      activeFile: "src/cacheService.ts",
      localRepoPathInput: ""
    });

    expect(document.body.textContent).toContain("Change Tracing loads on demand");
    document.querySelector<HTMLButtonElement>("[data-rg-action='load-guide-section']")?.click();
    expect(onLoadGuideSection).toHaveBeenCalledWith("trace");
  });

  it("renders progressive section loading states", () => {
    installDom();
    const panel = new ReviewPanel(callbacks());

    panel.render({
      isOpen: true,
      bridgeStatus: "connected",
      analysis: makeAnalysis({ reviewPlan: [] }),
      activeGuideSection: "plan",
      loadedGuideSections: {
        understanding: true
      },
      loadingGuideSections: {
        plan: true
      },
      explainByFile: {},
      testsByFile: {},
      reviewedFiles: [],
      analysedFiles: [],
      activeFile: "src/cacheService.ts",
      localRepoPathInput: ""
    });

    expect(document.body.textContent).toContain("Generating review plan");
    expect(document.body.textContent).not.toContain("Review cache invalidation");
  });
});
