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

const GUIDE_SECTIONS = [
  { id: "understanding", label: "Understanding" },
  { id: "plan", label: "Plan" },
  { id: "heatmap", label: "Heatmap" },
  { id: "files", label: "Files" },
  { id: "trace", label: "Trace" },
  { id: "worries", label: "Worries" }
] as const;

export type GuideSectionId = (typeof GUIDE_SECTIONS)[number]["id"];

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
  activeGuideSection?: GuideSectionId;
  loadedGuideSections?: Partial<Record<GuideSectionId, boolean>>;
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
  onSelectGuideSection(section: GuideSectionId): void;
  onLoadGuideSection(section: GuideSectionId): void;
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

function renderList(items: string[], emptyText: string): string {
  if (items.length === 0) {
    return `<div class="rg-review-guide__muted">${escapeHtml(emptyText)}</div>`;
  }

  return `<ul class="rg-review-guide__list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderFileChips(files: string[], emptyText = "No specific files called out."): string {
  if (files.length === 0) {
    return `<div class="rg-review-guide__muted">${escapeHtml(emptyText)}</div>`;
  }

  return `<div class="rg-review-guide__chip-row">${files
    .map(
      (file) =>
        `<button class="rg-review-guide__file-chip" data-rg-action="select-file" data-rg-file="${escapeHtml(file)}">${escapeHtml(
          file
        )}</button>`
    )
    .join("")}</div>`;
}

function renderSignals(signals: string[] | undefined): string {
  if (!signals || signals.length === 0) {
    return "";
  }

  return `<div class="rg-review-guide__signal-row">${signals
    .map((signal) => `<span class="rg-review-guide__signal">${escapeHtml(signal)}</span>`)
    .join("")}</div>`;
}

function renderLazySectionState(section: GuideSectionId, title: string, isLoading: boolean, isLoaded: boolean): string {
  if (isLoading) {
    return `<div class="rg-review-guide__loading">
      <span class="rg-review-guide__spinner" aria-hidden="true"></span>
      <span>Generating ${escapeHtml(title.toLowerCase())}...</span>
    </div>`;
  }

  if (!isLoaded) {
    return `<div class="rg-review-guide__insight">
      <strong>${escapeHtml(title)} loads on demand</strong>
      <p>This section uses a separate provider request so the initial PR overview can appear faster.</p>
      <button class="rg-review-guide__primary" data-rg-action="load-guide-section" data-rg-section="${section}">Generate ${escapeHtml(
        title
      )}</button>
    </div>`;
  }

  return "";
}

function getReviewFiles(analysis: AnalysePrResponse) {
  const reviewAdviceByFile = new Map(analysis.reviewOrder.map((file) => [file.file, file]));
  return analysis.changedFiles.length > 0
    ? analysis.changedFiles.map((file) => {
        const advice = reviewAdviceByFile.get(file.file);
        return {
          file: file.file,
          additions: file.additions,
          deletions: file.deletions,
          risk: file.risk,
          signals: file.signals ?? [],
          reason: advice?.reason ?? file.reason,
          suggestedAction: advice?.suggestedAction ?? "Review this file in context."
        };
      })
    : [...analysis.reviewOrder]
        .sort((left, right) => getRiskRank(right.risk) - getRiskRank(left.risk))
        .map((file) => ({
          file: file.file,
          additions: 0,
          deletions: 0,
          risk: file.risk,
          signals: [],
          reason: file.reason,
          suggestedAction: file.suggestedAction
        }));
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

function renderGuideNav(activeSection: GuideSectionId): string {
  return `<div class="rg-review-guide__section-nav" role="tablist" aria-label="Review guide sections">
    ${GUIDE_SECTIONS.map(
      (section) => `<button class="${
        section.id === activeSection ? "rg-review-guide__section-tab rg-review-guide__section-tab--active" : "rg-review-guide__section-tab"
      }" data-rg-action="guide-section" data-rg-section="${section.id}" role="tab" aria-selected="${
        section.id === activeSection ? "true" : "false"
      }">${escapeHtml(section.label)}</button>`
    ).join("")}
  </div>`;
}

function renderAnalysedFilesQueue(state: PanelState): string {
  if (state.analysedFiles.length === 0) {
    return `<div class="rg-review-guide__muted">Analyzed file results from this page session will appear here.</div>`;
  }

  return `<div class="rg-review-guide__queue">
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
  </div>`;
}

function renderGuideContent(state: PanelState, reviewFiles: ReturnType<typeof getReviewFiles>): string {
  const analysis = state.analysis;
  if (!analysis) {
    return "";
  }

  const activeSection = state.activeGuideSection ?? "understanding";
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

  if (activeSection === "understanding") {
    return `<div class="rg-review-guide__guide-section">
      <div class="rg-review-guide__section-heading">PR Understanding</div>
      <div class="rg-review-guide__insight">
        <strong>Purpose</strong>
        <p>${escapeHtml(analysis.prUnderstanding.purpose)}</p>
      </div>
      <div class="rg-review-guide__subsection">
        <strong>Affected systems</strong>
        ${renderList(analysis.prUnderstanding.affectedSystems, "No affected systems were identified.")}
      </div>
      <div class="rg-review-guide__subsection">
        <strong>Potential risks</strong>
        ${renderList(analysis.prUnderstanding.potentialRisks, "No specific risks were identified.")}
      </div>
      <div class="rg-review-guide__subsection">
        <strong>Key behavior changes</strong>
        ${renderList(analysis.prUnderstanding.keyBehaviorChanges, "No key behavior changes were identified.")}
      </div>
    </div>`;
  }

  if (activeSection === "plan") {
    return `<div class="rg-review-guide__guide-section">
      <div class="rg-review-guide__section-heading">Review Plan</div>
      ${analysis.reviewPlan
        .map(
          (step, index) => `<div class="rg-review-guide__plan-step">
            <div class="rg-review-guide__step-number">${index + 1}</div>
            <div>
              <strong>${escapeHtml(step.title)}</strong>
              <p>${escapeHtml(step.reason)}</p>
              <div class="rg-review-guide__muted">${escapeHtml(step.suggestedFocus)}</div>
              ${renderFileChips(step.files)}
            </div>
          </div>`
        )
        .join("")}
    </div>`;
  }

  if (activeSection === "heatmap") {
    const grouped = {
      high: reviewFiles.filter((file) => file.risk === "high"),
      medium: reviewFiles.filter((file) => file.risk === "medium"),
      low: reviewFiles.filter((file) => file.risk === "low"),
      skim: analysis.skimFiles
    };

    const renderRiskGroup = (label: string, risk: "high" | "medium" | "low", files: typeof grouped.high) => `<div class="rg-review-guide__heatmap-group">
      <div class="rg-review-guide__heatmap-title">
        <span class="rg-review-guide__risk rg-review-guide__risk--${risk}">${escapeHtml(label)}</span>
        <span class="rg-review-guide__muted">${files.length} file(s)</span>
      </div>
      ${
        files.length > 0
          ? files
              .map(
                (file) => `<button class="rg-review-guide__heatmap-file" data-rg-action="select-file" data-rg-file="${escapeHtml(
                  file.file
                )}">
                  <strong>${escapeHtml(file.file)}</strong>
                  <span>${escapeHtml(file.reason)}</span>
                  ${renderSignals(file.signals)}
                </button>`
              )
              .join("")
          : `<div class="rg-review-guide__muted">No ${escapeHtml(label.toLowerCase())} files.</div>`
      }
    </div>`;

    return `<div class="rg-review-guide__guide-section">
      <div class="rg-review-guide__section-heading">Risk Heatmap</div>
      ${renderRiskGroup("High risk", "high", grouped.high)}
      ${renderRiskGroup("Medium risk", "medium", grouped.medium)}
      ${renderRiskGroup("Low risk", "low", grouped.low)}
      <div class="rg-review-guide__heatmap-group">
        <div class="rg-review-guide__heatmap-title">
          <span class="rg-review-guide__risk rg-review-guide__risk--low">Skim</span>
          <span class="rg-review-guide__muted">${grouped.skim.length} file(s)</span>
        </div>
        ${renderFileChips(grouped.skim, "No files were marked safe to skim.")}
      </div>
    </div>`;
  }

  if (activeSection === "files") {
    const currentFile = state.activeFile && reviewFiles.some((file) => file.file === state.activeFile)
      ? state.activeFile
      : reviewFiles[0]?.file;
    const currentFileRisk = reviewFiles.find((file) => file.file === currentFile)?.risk ?? "low";
    const topRiskFiles = [...reviewFiles].sort((left, right) => getRiskRank(right.risk) - getRiskRank(left.risk)).slice(0, 5);

    return `<div class="rg-review-guide__guide-section">
      <div class="rg-review-guide__section-heading">Files</div>
      ${
        currentFile
          ? `<div class="rg-review-guide__current-file">
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
            </div>`
          : `<div class="rg-review-guide__muted">No changed files were returned by the provider.</div>`
      }
      <div class="rg-review-guide__subsection">
        <strong>All changed files</strong>
        <div class="rg-review-guide__queue">${reviewFiles.map(renderQueueItem).join("")}</div>
      </div>
      <div class="rg-review-guide__subsection">
        <strong>Highest-risk files</strong>
        <div class="rg-review-guide__queue">${topRiskFiles.map(renderQueueItem).join("")}</div>
      </div>
      <div class="rg-review-guide__subsection">
        <strong>Analyzed files</strong>
        ${renderAnalysedFilesQueue(state)}
      </div>
      <div class="rg-review-guide__subsection">
        <strong>Suggested checks</strong>
        <div>${analysis.suggestedChecks.map((item) => `<span class="rg-review-guide__pill">${escapeHtml(item)}</span>`).join("")}</div>
      </div>
    </div>`;
  }

  if (activeSection === "trace") {
    const isLoading = state.loadingAction === "guide:trace";
    const isLoaded = Boolean(state.loadedGuideSections?.trace || analysis.impactChains.length > 0);
    const lazyState = renderLazySectionState("trace", "Change Tracing", isLoading, isLoaded);
    return `<div class="rg-review-guide__guide-section">
      <div class="rg-review-guide__section-heading">Change Tracing</div>
      ${
        lazyState ||
        (analysis.impactChains.length > 0
          ? analysis.impactChains
              .map(
                (chain) => `<div class="rg-review-guide__impact-chain">
                  <div class="rg-review-guide__heatmap-title">
                    <strong>${escapeHtml(chain.title)}</strong>
                    <span class="rg-review-guide__risk rg-review-guide__risk--${chain.risk}">${chain.risk}</span>
                  </div>
                  <div class="rg-review-guide__chain-nodes">${chain.nodes
                    .map((node) => `<button data-rg-action="select-file" data-rg-file="${escapeHtml(node)}">${escapeHtml(node)}</button>`)
                    .join('<span aria-hidden="true">&darr;</span>')}</div>
                  <p>${escapeHtml(chain.explanation)}</p>
                </div>`
              )
              .join("")
          : `<div class="rg-review-guide__muted">No impact chains were returned by the provider.</div>`)
      }
    </div>`;
  }

  const isWorriesLoading = state.loadingAction === "guide:worries";
  const worriesLoaded = Boolean(state.loadedGuideSections?.worries || analysis.worries.length > 0);
  const worriesLazyState = renderLazySectionState("worries", "Worries", isWorriesLoading, worriesLoaded);
  return `<div class="rg-review-guide__guide-section">
    <div class="rg-review-guide__section-heading">What To Worry About</div>
    ${
      worriesLazyState ||
      (analysis.worries.length > 0
        ? analysis.worries
            .map(
              (worry) => `<div class="rg-review-guide__worry">
                <div class="rg-review-guide__heatmap-title">
                  <strong>${escapeHtml(worry.title)}</strong>
                  <span class="rg-review-guide__risk rg-review-guide__risk--${worry.risk}">${worry.risk}</span>
                </div>
                <p>${escapeHtml(worry.reason)}</p>
                <div class="rg-review-guide__muted">${escapeHtml(worry.suggestedCheck)}</div>
                ${renderFileChips(worry.files)}
              </div>`
            )
            .join("")
        : `<div class="rg-review-guide__muted">No major worries were returned by the provider.</div>`)
    }
  </div>`;
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
                  <span>${escapeHtml(providerLabel)} is preparing the guided PR review.</span>
                </div>`
              : ""
          }
        </div>`
      : "";
  }

  const reviewFiles = getReviewFiles(state.analysis);

  if (reviewFiles.length === 0) {
    return `<div class="rg-review-guide__section">
      <div><strong>Guided review</strong></div>
      ${renderGuideNav(state.activeGuideSection ?? "understanding")}
      ${renderGuideContent(state, reviewFiles)}
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
  const activeSection = state.activeGuideSection ?? "understanding";

  return `<div class="rg-review-guide__section">
    <div class="rg-review-guide__review-header">
      <div>
        <div><strong>Guided PR review</strong></div>
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

    <p class="rg-review-guide__muted">${escapeHtml(state.analysis.summary)}</p>
    ${renderGuideNav(activeSection)}
    ${renderGuideContent(state, reviewFiles)}
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
        case "guide-section": {
          const section = target?.getAttribute("data-rg-section") as GuideSectionId | null;
          if (section && GUIDE_SECTIONS.some((item) => item.id === section)) {
            this.callbacks.onSelectGuideSection(section);
          }
          break;
        }
        case "load-guide-section": {
          const section = target?.getAttribute("data-rg-section") as GuideSectionId | null;
          if (section && GUIDE_SECTIONS.some((item) => item.id === section)) {
            this.callbacks.onLoadGuideSection(section);
          }
          break;
        }
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
    const analysedFilesSection = state.analysis ? "" : renderAnalysedFilesSection(state);
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
