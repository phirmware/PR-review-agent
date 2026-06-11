import type {
  AnalyseFileResponse,
  AnalysePrResponse,
  AnalysePrStreamEvent,
  AskFileQuestionResponse,
  ExplainFileResponse,
  HealthResponse,
  PreApprovalCheckResponse,
  ProviderName,
  PullRequestIdentity,
  SuggestTestsResponse
} from "@review-guide/shared";
import { ApiClient } from "./apiClient.js";
import { FilePopover } from "./filePopover.js";
import {
  DOM_IDS,
  applyFileReviewControls,
  applyRiskBadges,
  ensureFloatingButton,
  getCurrentGitHubFileInViewport,
  getGitHubPrBaseBranch,
  getGitHubFileHeaderRect,
  getGitHubFileHeaders,
  hideFloatingButton,
  scrollToGitHubFile
} from "./githubDomAdapter.js";
import { resolveSelectedFilePath as resolveSelectedFilePathFromKnownFiles } from "./filePathResolver.js";
import { parseGitHubPrUrl } from "./githubPrParser.js";
import { ReviewPanel, type GuideSectionId, type PanelState } from "./reviewPanel.js";
import { getReviewedFiles, setReviewedFiles } from "./storage.js";

const client = new ApiClient();
let currentPrKey = "";
let currentAnalysis: AnalysePrResponse | null = null;
let refreshTimer: number | null = null;
let isFilePopoverOpen = false;
let isFilePopoverExpanded = false;
let selectedTextForPopover = "";
let fileAnalysisByFile: Record<string, AnalyseFileResponse> = {};
let fileQuestionByFile: Record<string, AskFileQuestionResponse> = {};
let questionDraftByFile: Record<string, string> = {};
let baseBranchEdited = false;
let analysisRunId = 0;

const state: PanelState = {
  isOpen: false,
  bridgeStatus: "idle",
  explainByFile: {},
  testsByFile: {},
  reviewedFiles: [],
  analysedFiles: [],
  activeFile: null,
  activeGuideSection: "understanding",
  loadedGuideSections: {},
  loadingGuideSections: {},
  streamingUnderstanding: null,
  localRepoPathInput: "",
  baseBranchHintInput: ""
};

interface AnalyzeSelectedFileMessage {
  type: "RG_ANALYZE_SELECTED_FILE";
  selectedText: string;
}

function isAnalyzeSelectedFileMessage(message: unknown): message is AnalyzeSelectedFileMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "RG_ANALYZE_SELECTED_FILE" &&
    typeof (message as { selectedText?: unknown }).selectedText === "string"
  );
}

function getKnownFiles(): string[] {
  const files = [
    ...getGitHubFileHeaders().map((file) => file.file),
    ...(state.analysis?.changedFiles.map((file) => file.file) ?? []),
    ...(state.analysis?.reviewOrder.map((file) => file.file) ?? [])
  ];
  return [...new Set(files)];
}

function resolveSelectedFilePath(selectedText: string): string | null {
  return resolveSelectedFilePathFromKnownFiles(selectedText, getKnownFiles());
}

function getRequestIdentity(): PullRequestIdentity | null {
  if (!state.pr) {
    return null;
  }

  const baseBranchHint = state.baseBranchHintInput?.trim();
  return baseBranchHint ? { ...state.pr, baseBranchHint } : state.pr;
}

async function analyseFile(file: string): Promise<void> {
  const identity = getRequestIdentity();
  if (!identity) {
    return;
  }

  update({ loadingAction: `analyse-file:${file}`, bridgeError: undefined });
  try {
    const analysis = await client.analyseFile({ ...identity, file });
    fileAnalysisByFile = {
      ...fileAnalysisByFile,
      [file]: analysis
    };
    render();
  } catch (error) {
    update({ bridgeError: error instanceof Error ? error.message : `Failed to analyse ${file}.` });
  } finally {
    update({ loadingAction: null });
  }
}

async function askFileQuestion(file: string, question: string): Promise<void> {
  const identity = getRequestIdentity();
  if (!identity || !question.trim()) {
    return;
  }

  update({ loadingAction: `ask:${file}`, bridgeError: undefined });
  try {
    const answer = await client.askFileQuestion({
      ...identity,
      file,
      question: question.trim(),
      selectedText: selectedTextForPopover || undefined
    });
    fileQuestionByFile = {
      ...fileQuestionByFile,
      [file]: answer
    };
    questionDraftByFile = {
      ...questionDraftByFile,
      [file]: ""
    };
    render();
  } catch (error) {
    update({ bridgeError: error instanceof Error ? error.message : `Failed to answer question for ${file}.` });
  } finally {
    update({ loadingAction: null });
  }
}

async function explainFile(file: string): Promise<void> {
  const identity = getRequestIdentity();
  if (!identity) {
    return;
  }

  update({ loadingAction: `explain:${file}`, bridgeError: undefined });
  try {
    const explanation: ExplainFileResponse = await client.explainFile({ ...identity, file });
    update({
      explainByFile: {
        ...state.explainByFile,
        [file]: explanation
      }
    });
  } catch (error) {
    update({ bridgeError: error instanceof Error ? error.message : `Failed to explain ${file}.` });
  } finally {
    update({ loadingAction: null });
  }
}

async function suggestTests(file: string): Promise<void> {
  const identity = getRequestIdentity();
  if (!identity) {
    return;
  }

  update({ loadingAction: `tests:${file}`, bridgeError: undefined });
  try {
    const tests: SuggestTestsResponse = await client.suggestTests({ ...identity, file });
    update({
      testsByFile: {
        ...state.testsByFile,
        [file]: tests
      }
    });
  } catch (error) {
    update({ bridgeError: error instanceof Error ? error.message : `Failed to suggest tests for ${file}.` });
  } finally {
    update({ loadingAction: null });
  }
}

async function loadGuideSection(section: GuideSectionId): Promise<void> {
  const identity = getRequestIdentity();
  await loadGuideSectionForIdentity(section, identity, analysisRunId);
}

function setGuideSectionLoading(section: GuideSectionId, isLoading: boolean): void {
  update({
    loadingGuideSections: {
      ...(state.loadingGuideSections ?? {}),
      [section]: isLoading
    }
  });
}

async function loadGuideSectionForIdentity(
  section: GuideSectionId,
  identity: PullRequestIdentity | null,
  runId: number
): Promise<void> {
  if (!identity || !state.analysis) {
    return;
  }

  const loadingSection = section === "files" ? "heatmap" : section;
  const alreadyLoaded =
    section === "files"
      ? Boolean(state.loadedGuideSections?.files || state.loadedGuideSections?.heatmap)
      : Boolean(state.loadedGuideSections?.[section]);
  if (alreadyLoaded || state.loadingGuideSections?.[loadingSection]) {
    return;
  }

  setGuideSectionLoading(loadingSection, true);
  try {
    if (section === "plan") {
      const sectionResult = await client.analysePrPlan(identity);
      if (runId !== analysisRunId || !state.analysis) {
        return;
      }
      currentAnalysis = {
        ...state.analysis,
        reviewPlan: sectionResult.reviewPlan
      };
      update({
        analysis: currentAnalysis,
        loadedGuideSections: {
          ...(state.loadedGuideSections ?? {}),
          plan: true
        }
      });
    } else if (section === "heatmap" || section === "files") {
      const sectionResult = await client.analysePrHeatmap(identity);
      if (runId !== analysisRunId || !state.analysis) {
        return;
      }
      currentAnalysis = {
        ...state.analysis,
        reviewOrder: sectionResult.reviewOrder,
        skimFiles: sectionResult.skimFiles,
        suggestedChecks: sectionResult.suggestedChecks,
        changedFiles: sectionResult.changedFiles
      };
      update({
        analysis: currentAnalysis,
        activeFile: state.activeFile ?? sectionResult.reviewOrder[0]?.file ?? sectionResult.changedFiles[0]?.file ?? null,
        loadedGuideSections: {
          ...(state.loadedGuideSections ?? {}),
          heatmap: true,
          files: true
        }
      });
      applyRiskBadges(currentAnalysis);
    } else if (section === "trace") {
      const sectionResult = await client.analysePrTrace(identity);
      if (runId !== analysisRunId || !state.analysis) {
        return;
      }
      currentAnalysis = {
        ...state.analysis,
        impactChains: sectionResult.impactChains
      };
      update({
        analysis: currentAnalysis,
        loadedGuideSections: {
          ...(state.loadedGuideSections ?? {}),
          trace: true
        }
      });
    } else if (section === "worries") {
      const sectionResult = await client.analysePrWorries(identity);
      if (runId !== analysisRunId || !state.analysis) {
        return;
      }
      currentAnalysis = {
        ...state.analysis,
        worries: sectionResult.worries
      };
      update({
        analysis: currentAnalysis,
        loadedGuideSections: {
          ...(state.loadedGuideSections ?? {}),
          worries: true
        }
      });
    }
  } catch (error) {
    if (runId === analysisRunId) {
      update({
        bridgeError: error instanceof Error ? error.message : `Failed to generate ${section}.`
      });
    }
  } finally {
    if (runId === analysisRunId) {
      setGuideSectionLoading(loadingSection, false);
    }
  }
}

async function loadProgressiveGuideSections(identity: PullRequestIdentity, runId: number): Promise<void> {
  await loadGuideSectionForIdentity("plan", identity, runId);
  await loadGuideSectionForIdentity("heatmap", identity, runId);
}

function handleAnalysePrStreamEvent(event: AnalysePrStreamEvent, runId: number): void {
  if (runId !== analysisRunId) {
    return;
  }

  if (event.type === "status") {
    update({
      streamingUnderstanding: {
        ...(state.streamingUnderstanding ?? {}),
        status: event.message
      }
    });
    return;
  }

  if (event.type !== "partial") {
    return;
  }

  if (event.field === "summary" || event.field === "purpose") {
    update({
      streamingUnderstanding: {
        ...(state.streamingUnderstanding ?? {}),
        [event.field]: event.text
      }
    });
    return;
  }

  if ("items" in event) {
    update({
      streamingUnderstanding: {
        ...(state.streamingUnderstanding ?? {}),
        [event.field]: event.items
      }
    });
  }
}

async function toggleReviewed(file: string): Promise<void> {
  if (!state.pr) {
    return;
  }

  const reviewedFiles = state.reviewedFiles.includes(file)
    ? state.reviewedFiles.filter((item) => item !== file)
    : [...state.reviewedFiles, file];

  await setReviewedFiles(state.pr, reviewedFiles);
  update({ reviewedFiles });
}

function openFilePopover(file: string, selectedText = ""): void {
  selectedTextForPopover = selectedText;
  isFilePopoverOpen = true;
  update({ activeFile: file });

  if (!fileAnalysisByFile[file]) {
    void analyseFile(file);
  }
}

function openSelectedFileFromText(selectedText: string): void {
  const file = resolveSelectedFilePath(selectedText);
  if (!file) {
    update({ bridgeError: "Select a changed file path before using Analyze selected file." });
    return;
  }

  openFilePopover(file);
}

function closeFilePopover(): void {
  isFilePopoverOpen = false;
  isFilePopoverExpanded = false;
  selectedTextForPopover = "";
  render();
}

const panel = new ReviewPanel({
  onClose() {
    state.isOpen = false;
    render();
  },
  async onConnectRepo(localPath) {
    if (!state.pr) {
      return;
    }

    update({ loadingAction: "connect", bridgeError: undefined, localRepoPathInput: localPath });
    try {
      const result = await client.bindRepo({ ...state.pr, localPath });
      if (!result.ok) {
        throw new Error(result.error);
      }
      await loadBridgeState(state.pr);
    } catch (error) {
      update({ bridgeError: error instanceof Error ? error.message : "Failed to bind repo." });
    } finally {
      update({ loadingAction: null });
    }
  },
  async onAnalysePr() {
    const identity = getRequestIdentity();
    if (!identity) {
      return;
    }

    const runId = ++analysisRunId;
    update({
      loadingAction: "analyse",
      bridgeError: undefined,
      loadingGuideSections: {},
      loadedGuideSections: {},
      streamingUnderstanding: {
        status: "Starting streamed PR understanding."
      }
    });
    try {
      try {
        currentAnalysis = await client.analysePrStream(identity, (event) => handleAnalysePrStreamEvent(event, runId));
      } catch (streamError) {
        if (runId !== analysisRunId) {
          return;
        }
        console.warn("[review-guide] streamed analysis failed; falling back to /analyse-pr", streamError);
        update({
          streamingUnderstanding: {
            ...(state.streamingUnderstanding ?? {}),
            status: "Streaming failed; retrying standard analysis."
          }
        });
        currentAnalysis = await client.analysePr(identity);
      }
      if (runId !== analysisRunId) {
        return;
      }
      update({
        analysis: currentAnalysis,
        activeFile: null,
        activeGuideSection: "understanding",
        loadedGuideSections: {
          understanding: true,
          plan: currentAnalysis.reviewPlan.length > 0,
          heatmap: currentAnalysis.changedFiles.length > 0,
          files: currentAnalysis.changedFiles.length > 0,
          trace: currentAnalysis.impactChains.length > 0,
          worries: currentAnalysis.worries.length > 0
        },
        loadingGuideSections: {},
        streamingUnderstanding: null,
        loadingAction: null,
        preApproval: null
      });
      applyRiskBadges(currentAnalysis);
      void loadProgressiveGuideSections(identity, runId);
    } catch (error) {
      if (runId === analysisRunId) {
        update({
          bridgeError: error instanceof Error ? error.message : "Failed to analyse PR.",
          streamingUnderstanding: null
        });
      }
    } finally {
      if (runId === analysisRunId && state.loadingAction === "analyse") {
        update({ loadingAction: null });
      }
    }
  },
  async onExplainFile(file) {
    void explainFile(file);
  },
  async onSuggestTests(file) {
    void suggestTests(file);
  },
  async onToggleReviewed(file) {
    await toggleReviewed(file);
  },
  async onPreApprovalCheck() {
    const identity = getRequestIdentity();
    if (!identity) {
      return;
    }

    update({ loadingAction: "pre-approval", bridgeError: undefined });
    try {
      const preApproval: PreApprovalCheckResponse = await client.preApprovalCheck({
        ...identity,
        reviewedFiles: state.reviewedFiles
      });
      update({ preApproval });
    } catch (error) {
      update({ bridgeError: error instanceof Error ? error.message : "Failed to run pre-approval check." });
    } finally {
      update({ loadingAction: null });
    }
  },
  onJumpToFile(file) {
    scrollToGitHubFile(file);
  },
  onLocalRepoPathInput(value) {
    state.localRepoPathInput = value;
  },
  onBaseBranchHintInput(value) {
    baseBranchEdited = true;
    update({
      baseBranchHintInput: value,
      pr: state.pr ? { ...state.pr, baseBranchHint: value.trim() || undefined } : state.pr
    });
  },
  onSelectFile(file) {
    openFilePopover(file);
    scrollToGitHubFile(file);
  },
  onNextFile() {
    const nextFile = getAdjacentReviewFile(1);
    if (nextFile) {
      openFilePopover(nextFile);
      scrollToGitHubFile(nextFile);
    }
  },
  onPreviousFile() {
    const previousFile = getAdjacentReviewFile(-1);
    if (previousFile) {
      openFilePopover(previousFile);
      scrollToGitHubFile(previousFile);
    }
  },
  async onProviderChange(provider: ProviderName) {
    if (state.health?.provider === provider) {
      return;
    }

    update({ loadingAction: "provider", bridgeError: undefined });
    try {
      const settings = await client.setProvider({ provider });
      currentAnalysis = null;
      analysisRunId += 1;
      fileAnalysisByFile = {};
      fileQuestionByFile = {};
      questionDraftByFile = {};
      isFilePopoverOpen = false;
      isFilePopoverExpanded = false;
      selectedTextForPopover = "";
      applyRiskBadges(null);
      applyFileReviewControls(null, state.reviewedFiles, null);
      update({
        health: state.health ? { ...state.health, provider: settings.provider } : await client.health(),
        availableProviders: settings.providers,
        analysis: null,
        explainByFile: {},
        testsByFile: {},
        preApproval: null,
        activeFile: null,
        activeGuideSection: "understanding",
        loadedGuideSections: {},
        loadingGuideSections: {},
        streamingUnderstanding: null
      });
    } catch (error) {
      update({ bridgeError: error instanceof Error ? error.message : "Failed to switch provider." });
    } finally {
      update({ loadingAction: null });
    }
  },
  onSelectGuideSection(section: GuideSectionId) {
    update({ activeGuideSection: section });
    void loadGuideSection(section);
  },
  onLoadGuideSection(section: GuideSectionId) {
    void loadGuideSection(section);
  }
});

const filePopover = new FilePopover({
  onClose: closeFilePopover,
  onToggleExpanded() {
    isFilePopoverExpanded = !isFilePopoverExpanded;
    render();
  },
  onAnalyseFile(file) {
    void analyseFile(file);
  },
  onAskFileQuestion(file, question) {
    void askFileQuestion(file, question);
  },
  onQuestionDraftChange(file, question) {
    questionDraftByFile = {
      ...questionDraftByFile,
      [file]: question
    };
  },
  onExplainFile(file) {
    void explainFile(file);
  },
  onSuggestTests(file) {
    void suggestTests(file);
  },
  onToggleReviewed(file) {
    void toggleReviewed(file);
  },
  onPreApprovalCheck() {
    void panelCallbacksPreApproval();
  }
});

async function panelCallbacksPreApproval(): Promise<void> {
  const identity = getRequestIdentity();
  if (!identity) {
    return;
  }

  update({ loadingAction: "pre-approval", bridgeError: undefined });
  try {
    const preApproval: PreApprovalCheckResponse = await client.preApprovalCheck({
      ...identity,
      reviewedFiles: state.reviewedFiles
    });
    update({ preApproval });
  } catch (error) {
    update({ bridgeError: error instanceof Error ? error.message : "Failed to run pre-approval check." });
  } finally {
    update({ loadingAction: null });
  }
}

function update(patch: Partial<PanelState>): void {
  Object.assign(state, patch);
  render();
}

function render(): void {
  const analysedFiles = Object.keys(fileAnalysisByFile);
  panel.render({ ...state, analysedFiles });
  applyPageEnhancements();
  filePopover.render({
    isOpen: isFilePopoverOpen,
    file: state.activeFile,
    anchorRect: state.activeFile ? getGitHubFileHeaderRect(state.activeFile) : null,
    analysis: state.analysis,
    fileAnalysis: state.activeFile ? fileAnalysisByFile[state.activeFile] : undefined,
    questionAnswer: state.activeFile ? fileQuestionByFile[state.activeFile] : undefined,
    questionDraft: state.activeFile ? questionDraftByFile[state.activeFile] ?? "" : "",
    explanation: state.activeFile ? state.explainByFile[state.activeFile] : undefined,
    tests: state.activeFile ? state.testsByFile[state.activeFile] : undefined,
    preApproval: state.preApproval,
    reviewed: state.activeFile ? state.reviewedFiles.includes(state.activeFile) : false,
    loadingAction: state.loadingAction,
    selectedText: selectedTextForPopover,
    expanded: isFilePopoverExpanded,
    provider: state.health?.provider
  });
}

function applyPageEnhancements(): void {
  applyRiskBadges(currentAnalysis);
  applyFileReviewControls(currentAnalysis, state.reviewedFiles, state.activeFile, Object.keys(fileAnalysisByFile));
}

function getReviewQueue(): string[] {
  const analysis = state.analysis;
  if (!analysis) {
    return [];
  }

  const analysedFiles = new Set([
    ...analysis.changedFiles.map((file) => file.file),
    ...analysis.reviewOrder.map((file) => file.file)
  ]);
  const domFiles = getGitHubFileHeaders()
    .map((file) => file.file)
    .filter((file) => analysedFiles.has(file));

  if (domFiles.length > 0) {
    return [...new Set(domFiles)];
  }

  const providerFiles =
    analysis.changedFiles.length > 0
      ? analysis.changedFiles.map((file) => file.file)
      : analysis.reviewOrder.map((file) => file.file);
  return [...new Set(providerFiles)];
}

function getAdjacentReviewFile(direction: 1 | -1): string | null {
  const queue = getReviewQueue();
  if (queue.length === 0) {
    return null;
  }

  const currentIndex = state.activeFile ? queue.indexOf(state.activeFile) : 0;
  const nextIndex = Math.min(Math.max((currentIndex < 0 ? 0 : currentIndex) + direction, 0), queue.length - 1);
  return queue[nextIndex] ?? null;
}

function ensureSelectionToolbar(): HTMLDivElement {
  let toolbar = document.getElementById(DOM_IDS.selectionToolbar) as HTMLDivElement | null;
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = DOM_IDS.selectionToolbar;
    toolbar.className = "rg-review-guide__selection-toolbar";
    toolbar.innerHTML = `<button type="button" data-rg-selection-action="review">Review selection</button>`;
    document.body.appendChild(toolbar);
  }

  return toolbar;
}

function hideSelectionToolbar(): void {
  const toolbar = document.getElementById(DOM_IDS.selectionToolbar);
  toolbar?.classList.remove("rg-review-guide__selection-toolbar--open");
}

function showSelectionToolbar(): void {
  if (!state.analysis) {
    hideSelectionToolbar();
    return;
  }

  const selection = window.getSelection();
  const selectedText = selection?.toString().trim() ?? "";
  if (!selection || selectedText.length < 2 || selection.rangeCount === 0) {
    hideSelectionToolbar();
    return;
  }

  const file = getCurrentGitHubFileInViewport();
  if (!file || !getReviewQueue().includes(file)) {
    hideSelectionToolbar();
    return;
  }

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    hideSelectionToolbar();
    return;
  }

  const toolbar = ensureSelectionToolbar();
  toolbar.dataset.rgFile = file;
  toolbar.dataset.rgSelectedText = selectedText.slice(0, 2000);
  toolbar.style.left = `${Math.min(Math.max(rect.left, 16), window.innerWidth - 180)}px`;
  toolbar.style.top = `${Math.max(rect.top - 42, 12)}px`;
  toolbar.classList.add("rg-review-guide__selection-toolbar--open");
}

async function loadBridgeState(pr: PullRequestIdentity): Promise<void> {
  update({ bridgeStatus: "loading", bridgeError: undefined });

  try {
    const [health, binding, reviewedFiles] = await Promise.all([
      client.health(),
      client.getRepoBinding(pr),
      getReviewedFiles(pr)
    ]);
    const providerSettings = await client.getProvider();
    applyHealthState(health);
    update({
      bridgeStatus: "connected",
      binding,
      reviewedFiles,
      health: { ...health, provider: providerSettings.provider },
      availableProviders: providerSettings.providers
    });
  } catch (error) {
    update({
      bridgeStatus: "error",
      bridgeError: error instanceof Error ? error.message : "Failed to reach the bridge."
    });
  }
}

function applyHealthState(health: HealthResponse): void {
  update({ health });
}

async function syncPageState(): Promise<void> {
  const pr = parseGitHubPrUrl(window.location.href);
  if (!pr) {
    currentAnalysis = null;
    currentPrKey = "";
    analysisRunId += 1;
    hideFloatingButton();
    update({
      pr: null,
      analysis: null,
      binding: undefined,
      explainByFile: {},
      testsByFile: {},
      activeFile: null,
      activeGuideSection: "understanding",
      loadedGuideSections: {},
      loadingGuideSections: {},
      streamingUnderstanding: null,
      baseBranchHintInput: "",
      preApproval: null
    });
    baseBranchEdited = false;
    fileAnalysisByFile = {};
    fileQuestionByFile = {};
    questionDraftByFile = {};
    applyRiskBadges(null);
    applyFileReviewControls(null, [], null);
    closeFilePopover();
    hideSelectionToolbar();
    return;
  }

  ensureFloatingButton(() => {
    state.isOpen = !state.isOpen;
    render();
  });

  const detectedBaseBranch = getGitHubPrBaseBranch();
  const prKey = `${pr.host}/${pr.owner}/${pr.repo}#${pr.prNumber}`;
  const isNewPr = prKey !== currentPrKey;
  const baseBranchHintInput = isNewPr
    ? detectedBaseBranch ?? ""
    : baseBranchEdited
      ? state.baseBranchHintInput ?? ""
      : detectedBaseBranch ?? state.baseBranchHintInput ?? "";
  const prWithBaseBranch = baseBranchHintInput.trim() ? { ...pr, baseBranchHint: baseBranchHintInput.trim() } : pr;

  if (isNewPr) {
    currentPrKey = prKey;
    currentAnalysis = null;
    analysisRunId += 1;
    baseBranchEdited = false;
    update({
      pr: prWithBaseBranch,
      baseBranchHintInput,
      analysis: null,
      explainByFile: {},
      testsByFile: {},
      preApproval: null,
      activeFile: null,
      activeGuideSection: "understanding",
      loadedGuideSections: {},
      loadingGuideSections: {},
      streamingUnderstanding: null,
      localRepoPathInput: "",
      reviewedFiles: []
    });
    fileAnalysisByFile = {};
    fileQuestionByFile = {};
    questionDraftByFile = {};
    await loadBridgeState(pr);
    applyPageEnhancements();
    return;
  }

  update({ pr: prWithBaseBranch, baseBranchHintInput });
  applyPageEnhancements();
}

function scheduleSync(): void {
  if (refreshTimer) {
    window.clearTimeout(refreshTimer);
  }

  refreshTimer = window.setTimeout(() => {
    void syncPageState();
  }, 150);
}

function isReviewGuideMutation(mutation: MutationRecord): boolean {
  const target = mutation.target instanceof HTMLElement ? mutation.target : mutation.target.parentElement;
  if (target?.closest(`#${DOM_IDS.panel}, #${DOM_IDS.button}, #${DOM_IDS.popover}, #${DOM_IDS.selectionToolbar}`)) {
    return true;
  }

  const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return changedNodes.length > 0 && changedNodes.every((node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    return Boolean(
      node.closest(
        `#${DOM_IDS.panel}, #${DOM_IDS.button}, #${DOM_IDS.popover}, #${DOM_IDS.selectionToolbar}, .rg-review-guide-file-action, .rg-review-guide-badge`
      ) ||
        node.id === DOM_IDS.panel ||
        node.id === DOM_IDS.button ||
        node.id === DOM_IDS.popover ||
        node.id === DOM_IDS.selectionToolbar
    );
  });
}

function installGitHubNavigationHooks(): void {
  const eventName = "rg-review-guide:navigation";
  const wrapHistoryMethod = (method: "pushState" | "replaceState") => {
    const original = history[method];
    history[method] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(eventName));
      return result;
    };
  };

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
  window.addEventListener("popstate", () => scheduleSync());
  window.addEventListener(eventName, () => scheduleSync());
}

ensureFloatingButton(() => {
  state.isOpen = !state.isOpen;
  render();
});

const observer = new MutationObserver((mutations) => {
  if (mutations.every(isReviewGuideMutation)) {
    return;
  }

  scheduleSync();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

installGitHubNavigationHooks();
document.addEventListener("click", (event) => {
  const fileButton = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-rg-file-review]");
  if (fileButton?.dataset.rgFile) {
    event.preventDefault();
    openFilePopover(fileButton.dataset.rgFile);
    return;
  }

  const selectionButton = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-rg-selection-action='review']");
  if (selectionButton) {
    const toolbar = document.getElementById(DOM_IDS.selectionToolbar) as HTMLDivElement | null;
    const file = toolbar?.dataset.rgFile;
    if (file) {
      openFilePopover(file, toolbar?.dataset.rgSelectedText ?? "");
      hideSelectionToolbar();
    }
  }
});
document.addEventListener("mouseup", () => {
  window.setTimeout(showSelectionToolbar, 0);
});
chrome.runtime.onMessage.addListener((message) => {
  if (isAnalyzeSelectedFileMessage(message)) {
    openSelectedFileFromText(message.selectedText);
  }
});
void syncPageState();
