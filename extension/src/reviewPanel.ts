import type {
  AnalysePrResponse,
  ExplainFileResponse,
  HealthResponse,
  PreApprovalCheckResponse,
  ProviderName,
  PullRequestIdentity,
  SuggestTestsResponse
} from "@review-guide/shared";
import { ensurePanelElement } from "./githubDomAdapter.js";

export interface PanelState {
  isOpen: boolean;
  bridgeStatus: "idle" | "connected" | "error" | "loading";
  bridgeError?: string;
  health?: HealthResponse;
  pr?: PullRequestIdentity | null;
  binding?: {
    found: boolean;
    localPath?: string;
    remoteUrl?: string;
    suggestions?: string[];
  };
  availableProviders?: ProviderName[];
  analysis?: AnalysePrResponse | null;
  activeFile?: string | null;
  explainByFile: Record<string, ExplainFileResponse>;
  testsByFile: Record<string, SuggestTestsResponse>;
  preApproval?: PreApprovalCheckResponse | null;
  reviewedFiles: string[];
  analysedFiles: string[];
  loadingAction?: string | null;
  localRepoPathInput: string;
}

export interface ReviewPanelCallbacks {
  onClose(): void;
  onConnectRepo(localPath: string): void;
  onAnalysePr(): void;
  onExplainFile(file: string): void;
  onSuggestTests(file: string): void;
  onToggleReviewed(file: string): void;
  onPreApprovalCheck(): void;
  onJumpToFile(file: string): void;
  onLocalRepoPathInput(value: string): void;
  onSelectFile(file: string): void;
  onNextFile(): void;
  onPreviousFile(): void;
  onProviderChange(provider: ProviderName): void;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getRiskRank(risk: string): number {
  return risk === "high" ? 3 : risk === "medium" ? 2 : 1;
}

function getProviderLabel(provider: ProviderName): string {
  switch (provider) {
    case "mock":
      return "Mock";
    case "claude-code":
      return "Claude Code";
    case "copilot-cli":
      return "Copilot CLI";
  }
}

function renderAnalysisSection(state: PanelState): string {
  const providerLabel = getProviderLabel(state.health?.provider ?? "mock");
  if (!state.analysis) {
    return state.binding?.found
      ? `<div class="rg-review-guide__section">
          <button class="rg-review-guide__primary" data-rg-action="analyse" ${
            state.loadingAction === "analyse" ? "disabled" : ""
          }>${state.loadingAction === "analyse" ? "Analyzing PR..." : "Analyse PR"}</button>
          ${
            state.loadingAction === "analyse"
              ? `<div class="rg-review-guide__loading">
                  <span class="rg-review-guide__spinner" aria-hidden="true"></span>
                  <span>${escapeHtml(providerLabel)} is preparing the PR review summary.</span>
                </div>`
              : ""
          }
        </div>`
      : "";
  }

  const reviewAdviceByFile = new Map(state.analysis.reviewOrder.map((file) => [file.file, file]));
  const reviewFiles =
    state.analysis.changedFiles.length > 0
      ? state.analysis.changedFiles.map((file) => {
          const advice = reviewAdviceByFile.get(file.file);
          return {
            file: file.file,
            risk: file.risk,
            reason: advice?.reason ?? file.reason,
            suggestedAction: advice?.suggestedAction ?? "Review this file in context."
          };
        })
      : [...state.analysis.reviewOrder].sort((left, right) => getRiskRank(right.risk) - getRiskRank(left.risk));

  if (reviewFiles.length === 0) {
    return `<div class="rg-review-guide__section">
      <div><strong>Analysis</strong></div>
      <p class="rg-review-guide__muted">${escapeHtml(state.analysis.summary)}</p>
      <div class="rg-review-guide__muted">No changed files were returned by the provider.</div>
    </div>`;
  }

  const reviewedCount = reviewFiles.filter((file) => state.reviewedFiles.includes(file.file)).length;
  const progressPercent = Math.round((reviewedCount / reviewFiles.length) * 100);
  const riskCounts = reviewFiles.reduce(
    (counts, file) => {
      counts[file.risk] += 1;
      return counts;
    },
    { low: 0, medium: 0, high: 0 }
  );
  const topRiskFiles = [...reviewFiles].sort((left, right) => getRiskRank(right.risk) - getRiskRank(left.risk)).slice(0, 5);
  const currentFile = state.activeFile && reviewFiles.some((file) => file.file === state.activeFile)
    ? state.activeFile
    : reviewFiles[0].file;
  const currentFileRisk = reviewFiles.find((file) => file.file === currentFile)?.risk ?? "low";
  const renderQueueItem = (item: (typeof reviewFiles)[number]) => `<button class="rg-review-guide__queue-item ${
    item.file === state.activeFile ? "rg-review-guide__queue-item--active" : ""
  } ${state.reviewedFiles.includes(item.file) ? "rg-review-guide__queue-item--reviewed" : ""}" data-rg-action="select-file" data-rg-file="${escapeHtml(
    item.file
  )}">
    <span>${escapeHtml(item.file)}</span>
    <span class="rg-review-guide__queue-meta">
      <span class="rg-review-guide__risk rg-review-guide__risk--${item.risk}">${item.risk}</span>
      <span>${state.reviewedFiles.includes(item.file) ? "Reviewed" : "Analyze"}</span>
    </span>
  </button>`;

  return `<div class="rg-review-guide__section">
    <div class="rg-review-guide__review-header">
      <div>
        <div><strong>PR review summary</strong></div>
        <div class="rg-review-guide__muted">${reviewedCount}/${reviewFiles.length} files reviewed</div>
      </div>
      <button class="rg-review-guide__primary" data-rg-action="pre-approval" ${
        state.loadingAction === "pre-approval" ? "disabled" : ""
      }>Pre-approval</button>
    </div>
    <div class="rg-review-guide__progress" aria-label="${progressPercent}% reviewed">
      <div class="rg-review-guide__progress-fill" style="width: ${progressPercent}%"></div>
    </div>

    <div class="rg-review-guide__summary-grid">
      <div><strong>${riskCounts.high}</strong><span>high</span></div>
      <div><strong>${riskCounts.medium}</strong><span>medium</span></div>
      <div><strong>${riskCounts.low}</strong><span>low</span></div>
    </div>

    <div class="rg-review-guide__current-file">
      <div>
        <strong>Current file</strong>
        <div class="rg-review-guide__muted">${escapeHtml(currentFile)}</div>
      </div>
      <div class="rg-review-guide__current-file-actions">
        <button data-rg-action="previous-file">Previous</button>
        <button data-rg-action="next-file">Next</button>
        <button class="rg-review-guide__primary" data-rg-action="select-file" data-rg-file="${escapeHtml(currentFile)}">
          Analyze file
        </button>
        <span class="rg-review-guide__risk rg-review-guide__risk--${currentFileRisk}">${currentFileRisk}</span>
      </div>
    </div>

    <details class="rg-review-guide__details">
      <summary>PR summary</summary>
      <p>${escapeHtml(state.analysis.summary)}</p>
    </details>

    <details class="rg-review-guide__details" open>
      <summary>All changed files</summary>
      <div class="rg-review-guide__queue">
        ${reviewFiles.map(renderQueueItem).join("")}
      </div>
    </details>

    <details class="rg-review-guide__details">
      <summary>Highest-risk files</summary>
      <div class="rg-review-guide__queue">
        ${topRiskFiles.map(renderQueueItem).join("")}
      </div>
    </details>

    <details class="rg-review-guide__details">
      <summary>Suggested checks</summary>
      <div>${state.analysis.suggestedChecks.map((item) => `<span class="rg-review-guide__pill">${escapeHtml(item)}</span>`).join("")}</div>
    </details>

    ${
      state.analysis.skimFiles.length > 0
        ? `<details class="rg-review-guide__details">
            <summary>Files safe to skim</summary>
            <div>${state.analysis.skimFiles.map((item) => `<span class="rg-review-guide__pill">${escapeHtml(item)}</span>`).join("")}</div>
          </details>`
        : ""
    }
  </div>`;
}

function renderAnalysedFilesSection(state: PanelState): string {
  if (state.analysedFiles.length === 0) {
    return "";
  }

  return `<div class="rg-review-guide__section">
    <div><strong>Analyzed files</strong></div>
    <div class="rg-review-guide__muted">Reopen file analysis from this page session.</div>
    <div class="rg-review-guide__queue">
      ${state.analysedFiles
        .map(
          (file) => `<button class="rg-review-guide__queue-item ${
            file === state.activeFile ? "rg-review-guide__queue-item--active" : ""
          } ${state.reviewedFiles.includes(file) ? "rg-review-guide__queue-item--reviewed" : ""}" data-rg-action="select-file" data-rg-file="${escapeHtml(
            file
          )}">
            <span>${escapeHtml(file)}</span>
            <span class="rg-review-guide__queue-meta">
              <span>${state.reviewedFiles.includes(file) ? "Reviewed" : "Open"}</span>
            </span>
          </button>`
        )
        .join("")}
    </div>
  </div>`;
}

export class ReviewPanel {
  private readonly element = ensurePanelElement();

  constructor(private readonly callbacks: ReviewPanelCallbacks) {
    this.element.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-rg-action]");
      const action = target?.getAttribute("data-rg-action");
      const file = target?.getAttribute("data-rg-file");

      switch (action) {
        case "close":
          this.callbacks.onClose();
          break;
        case "connect": {
          const input = this.element.querySelector<HTMLInputElement>("[data-rg-input='local-path']");
          this.callbacks.onConnectRepo(input?.value ?? "");
          break;
        }
        case "analyse":
          this.callbacks.onAnalysePr();
          break;
        case "explain":
          if (file) {
            this.callbacks.onExplainFile(file);
          }
          break;
        case "tests":
          if (file) {
            this.callbacks.onSuggestTests(file);
          }
          break;
        case "toggle-reviewed":
          if (file) {
            this.callbacks.onToggleReviewed(file);
          }
          break;
        case "pre-approval":
          this.callbacks.onPreApprovalCheck();
          break;
        case "jump":
          if (file) {
            this.callbacks.onJumpToFile(file);
          }
          break;
        case "select-file":
          if (file) {
            this.callbacks.onSelectFile(file);
          }
          break;
        case "next-file":
          this.callbacks.onNextFile();
          break;
        case "previous-file":
          this.callbacks.onPreviousFile();
          break;
        default:
          break;
      }
    });

    this.element.addEventListener("input", (event) => {
      const target = event.target as HTMLInputElement | null;
      if (target?.getAttribute("data-rg-input") === "local-path") {
        this.callbacks.onLocalRepoPathInput(target.value);
      }
    });

    this.element.addEventListener("change", (event) => {
      const target = event.target as HTMLSelectElement | null;
      if (target?.getAttribute("data-rg-input") === "provider") {
        this.callbacks.onProviderChange(target.value as ProviderName);
      }
    });
  }

  render(state: PanelState): void {
    this.element.classList.toggle("rg-review-guide__panel--open", state.isOpen);

    if (!state.isOpen) {
      return;
    }

    const bindingSection = state.pr
      ? state.binding?.found
        ? `<div class="rg-review-guide__section">
            <div><strong>Repo binding</strong></div>
            <div class="rg-review-guide__muted">${escapeHtml(state.binding.localPath ?? "")}</div>
          </div>`
        : `<div class="rg-review-guide__section">
            <div><strong>Connect local repo</strong></div>
            <div class="rg-review-guide__muted">${escapeHtml(`${state.pr.host}/${state.pr.owner}/${state.pr.repo}`)}</div>
            <input class="rg-review-guide__input" data-rg-input="local-path" value="${escapeHtml(state.localRepoPathInput)}" placeholder="/Users/you/dev/repo" />
            <button class="rg-review-guide__primary" data-rg-action="connect" ${state.loadingAction === "connect" ? "disabled" : ""}>Connect repo</button>
          </div>`
      : `<div class="rg-review-guide__section"><div class="rg-review-guide__muted">Open a GitHub pull request page to use Review Guide.</div></div>`;

    const analysisSection = renderAnalysisSection(state);
    const analysedFilesSection = renderAnalysedFilesSection(state);
    const providers = state.availableProviders ?? ["mock", "claude-code", "copilot-cli"];
    const selectedProvider = state.health?.provider ?? "mock";
    const providerSection = `<div class="rg-review-guide__section">
      <label class="rg-review-guide__field">
        <span>Provider</span>
        <select class="rg-review-guide__select" data-rg-input="provider" ${
          state.loadingAction === "provider" || state.bridgeStatus !== "connected" ? "disabled" : ""
        }>
          ${providers
            .map(
              (provider) =>
                `<option value="${provider}" ${provider === selectedProvider ? "selected" : ""}>${escapeHtml(
                  getProviderLabel(provider)
                )}</option>`
            )
            .join("")}
        </select>
      </label>
      <div class="rg-review-guide__muted">
        ${state.loadingAction === "provider" ? "Switching provider..." : "Applies to the next analysis request."}
      </div>
    </div>`;

    const preApprovalSection = state.preApproval
      ? `<div class="rg-review-guide__section">
          <div><strong>Pre-approval check</strong></div>
          <div class="rg-review-guide__muted">${escapeHtml(state.preApproval.summary)}</div>
          <div class="rg-review-guide__pill rg-review-guide__pill--recommendation">${escapeHtml(
            state.preApproval.recommendation
          )}</div>
          ${
            state.preApproval.remainingRisks.length > 0
              ? state.preApproval.remainingRisks
                  .map(
                    (item) => `<div class="rg-review-guide__muted">${escapeHtml(item.file)} - ${escapeHtml(
                      item.risk
                    )}: ${escapeHtml(item.reason)}</div>`
                  )
                  .join("")
              : `<div class="rg-review-guide__muted">No remaining medium/high unreviewed files.</div>`
          }
        </div>`
      : "";

    this.element.innerHTML = `
      <div class="rg-review-guide__panel-header">
        <div>
          <div class="rg-review-guide__title">Review Guide</div>
          <div class="rg-review-guide__muted">
            Bridge: ${escapeHtml(state.bridgeStatus)}
            ${state.health?.provider ? `- provider ${escapeHtml(state.health.provider)}` : ""}
          </div>
        </div>
        <button data-rg-action="close">Close</button>
      </div>
      ${
        state.bridgeError
          ? `<div class="rg-review-guide__section rg-review-guide__error">${escapeHtml(state.bridgeError)}</div>`
          : ""
      }
      ${
        state.pr
          ? `<div class="rg-review-guide__section">
              <div><strong>Detected PR</strong></div>
              <div class="rg-review-guide__muted">${escapeHtml(
                `${state.pr.host}/${state.pr.owner}/${state.pr.repo}#${state.pr.prNumber}`
              )}</div>
            </div>`
          : ""
      }
      ${providerSection}
      ${bindingSection}
      ${analysedFilesSection}
      ${analysisSection}
      ${preApprovalSection}
    `;
  }
}
