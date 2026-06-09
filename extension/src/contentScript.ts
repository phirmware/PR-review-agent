import type {
  AnalyseFileResponse,
  AnalysePrResponse,
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
  getGitHubFileHeaderRect,
  getGitHubFileHeaders,
  hideFloatingButton,
  scrollToGitHubFile
} from "./githubDomAdapter.js";
import { resolveSelectedFilePath as resolveSelectedFilePathFromKnownFiles } from "./filePathResolver.js";
import { parseGitHubPrUrl } from "./githubPrParser.js";
import { ReviewPanel, type PanelState } from "./reviewPanel.js";
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

const state: PanelState = {
  isOpen: false,
  bridgeStatus: "idle",
  explainByFile: {},
  testsByFile: {},
  reviewedFiles: [],
  analysedFiles: [],
  activeFile: null,
  localRepoPathInput: ""
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

async function analyseFile(file: string): Promise<void> {
  if (!state.pr) {
    return;
  }

  update({ loadingAction: `analyse-file:${file}`, bridgeError: undefined });
  try {
    const analysis = await client.analyseFile({ ...state.pr, file });
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
  if (!state.pr || !question.trim()) {
    return;
  }

  update({ loadingAction: `ask:${file}`, bridgeError: undefined });
  try {
    const answer = await client.askFileQuestion({
      ...state.pr,
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
  if (!state.pr) {
    return;
  }

  update({ loadingAction: `explain:${file}`, bridgeError: undefined });
  try {
    const explanation: ExplainFileResponse = await client.explainFile({ ...state.pr, file });
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
  if (!state.pr) {
    return;
  }

  update({ loadingAction: `tests:${file}`, bridgeError: undefined });
  try {
    const tests: SuggestTestsResponse = await client.suggestTests({ ...state.pr, file });
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
    if (!state.pr) {
      return;
    }

    update({ loadingAction: "analyse", bridgeError: undefined });
    try {
      currentAnalysis = await client.analysePr(state.pr);
      update({
        analysis: currentAnalysis,
        activeFile: currentAnalysis.reviewOrder[0]?.file ?? currentAnalysis.changedFiles[0]?.file ?? null,
        preApproval: null
      });
      applyRiskBadges(currentAnalysis);
    } catch (error) {
      update({ bridgeError: error instanceof Error ? error.message : "Failed to analyse PR." });
    } finally {
      update({ loadingAction: null });
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
    if (!state.pr) {
      return;
    }

    update({ loadingAction: "pre-approval", bridgeError: undefined });
    try {
      const preApproval: PreApprovalCheckResponse = await client.preApprovalCheck({
        ...state.pr,
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
        activeFile: null
      });
    } catch (error) {
      update({ bridgeError: error instanceof Error ? error.message : "Failed to switch provider." });
    } finally {
      update({ loadingAction: null });
    }
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
  if (!state.pr) {
    return;
  }

  update({ loadingAction: "pre-approval", bridgeError: undefined });
  try {
    const preApproval: PreApprovalCheckResponse = await client.preApprovalCheck({
      ...state.pr,
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
    hideFloatingButton();
    update({
      pr: null,
      analysis: null,
      binding: undefined,
      explainByFile: {},
      testsByFile: {},
      activeFile: null,
      preApproval: null
    });
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

  const prKey = `${pr.host}/${pr.owner}/${pr.repo}#${pr.prNumber}`;
  update({ pr });

  if (prKey !== currentPrKey) {
    currentPrKey = prKey;
    currentAnalysis = null;
    update({
      analysis: null,
      explainByFile: {},
      testsByFile: {},
      preApproval: null,
      activeFile: null,
      localRepoPathInput: "",
      reviewedFiles: []
    });
    fileAnalysisByFile = {};
    fileQuestionByFile = {};
    questionDraftByFile = {};
    await loadBridgeState(pr);
  }

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
