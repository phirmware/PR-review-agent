import type {
  AnalyseFileResponse,
  AnalysePrResponse,
  AskFileQuestionResponse,
  ExplainFileResponse,
  PreApprovalCheckResponse,
  ProviderName,
  SuggestTestsResponse
} from "@review-guide/shared";
import { DOM_IDS } from "./githubDomAdapter.js";

export interface FilePopoverState {
  isOpen: boolean;
  file?: string | null;
  anchorRect?: DOMRect | null;
  analysis?: AnalysePrResponse | null;
  fileAnalysis?: AnalyseFileResponse;
  questionAnswer?: AskFileQuestionResponse;
  questionDraft: string;
  explanation?: ExplainFileResponse;
  tests?: SuggestTestsResponse;
  preApproval?: PreApprovalCheckResponse | null;
  reviewed: boolean;
  loadingAction?: string | null;
  selectedText?: string;
  expanded: boolean;
  provider?: ProviderName;
}

export interface FilePopoverCallbacks {
  onClose(): void;
  onToggleExpanded(): void;
  onAnalyseFile(file: string): void;
  onAskFileQuestion(file: string, question: string): void;
  onQuestionDraftChange(file: string, question: string): void;
  onExplainFile(file: string): void;
  onSuggestTests(file: string): void;
  onToggleReviewed(file: string): void;
  onPreApprovalCheck(): void;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function ensurePopoverElement(): HTMLDivElement {
  let popover = document.getElementById(DOM_IDS.popover) as HTMLDivElement | null;
  if (!popover) {
    popover = document.createElement("div");
    popover.id = DOM_IDS.popover;
    popover.className = "rg-review-guide__popover";
    document.body.appendChild(popover);
  }

  return popover;
}

function renderList(items: string[]): string {
  return `<ul class="rg-review-guide__list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderLoading(message: string): string {
  return `<div class="rg-review-guide__loading">
    <span class="rg-review-guide__spinner" aria-hidden="true"></span>
    <span>${escapeHtml(message)}</span>
  </div>`;
}

function getProviderLabel(provider: ProviderName): string {
  switch (provider) {
    case "mock":
      return "Mock provider";
    case "claude-code":
      return "Claude Code";
    case "copilot-cli":
      return "Copilot CLI";
  }
}

export class FilePopover {
  private readonly element = ensurePopoverElement();
  private dragState: { pointerId: number; offsetX: number; offsetY: number } | null = null;
  private manualPosition: { file: string; left: number; top: number } | null = null;

  constructor(private readonly callbacks: FilePopoverCallbacks) {
    this.element.addEventListener("click", (event) => {
      const actionElement = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-rg-popover-action]");
      const action = actionElement?.dataset.rgPopoverAction;
      const file = actionElement?.dataset.rgFile;

      switch (action) {
        case "close":
          this.callbacks.onClose();
          break;
        case "toggle-expanded":
          this.callbacks.onToggleExpanded();
          break;
        case "analyse-file":
          if (file) {
            this.callbacks.onAnalyseFile(file);
          }
          break;
        case "ask": {
          if (file) {
            const input = this.element.querySelector<HTMLTextAreaElement>("[data-rg-question-input]");
            this.callbacks.onAskFileQuestion(file, input?.value ?? "");
          }
          break;
        }
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
        default:
          break;
      }
    });

    this.element.addEventListener("input", (event) => {
      const input = event.target as HTMLTextAreaElement | null;
      const file = input?.dataset.rgFile;
      if (input?.hasAttribute("data-rg-question-input") && file) {
        this.callbacks.onQuestionDraftChange(file, input.value);
      }
    });

    this.element.addEventListener("pointerdown", (event) => {
      const target = event.target as HTMLElement | null;
      const dragHandle = target?.closest<HTMLElement>("[data-rg-popover-drag-handle]");
      if (!dragHandle || target?.closest("button, input, select, textarea, a")) {
        return;
      }

      const rect = this.element.getBoundingClientRect();
      this.dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      this.element.classList.add("rg-review-guide__popover--dragging");
      this.element.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    this.element.addEventListener("pointermove", (event) => {
      if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
        return;
      }

      const rect = this.element.getBoundingClientRect();
      const maxLeft = Math.max(window.innerWidth - rect.width - 12, 12);
      const maxTop = Math.max(window.innerHeight - 80, 12);
      const left = Math.min(Math.max(event.clientX - this.dragState.offsetX, 12), maxLeft);
      const top = Math.min(Math.max(event.clientY - this.dragState.offsetY, 12), maxTop);
      this.manualPosition = {
        file: this.element.dataset.rgFile ?? "",
        left,
        top
      };
      this.element.style.left = `${left}px`;
      this.element.style.top = `${top}px`;
    });

    this.element.addEventListener("pointerup", (event) => {
      if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
        return;
      }

      this.element.releasePointerCapture(event.pointerId);
      this.element.classList.remove("rg-review-guide__popover--dragging");
      this.dragState = null;
    });

    this.element.addEventListener("pointercancel", (event) => {
      if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
        return;
      }

      this.element.classList.remove("rg-review-guide__popover--dragging");
      this.dragState = null;
    });
  }

  render(state: FilePopoverState): void {
    if (!state.isOpen || !state.file) {
      this.element.classList.remove("rg-review-guide__popover--open");
      this.element.innerHTML = "";
      this.manualPosition = null;
      return;
    }

    const file = state.file;
    const changedFile = state.analysis?.changedFiles.find((item) => item.file === file);
    const advice = state.analysis?.reviewOrder.find((item) => item.file === file);
    const risk = changedFile?.risk ?? advice?.risk ?? "low";
    const reason = advice?.reason ?? changedFile?.reason ?? "Analyze this file to review its PR changes.";
    const suggestedAction = advice?.suggestedAction ?? "Use the file analysis and ask box for focused review guidance.";
    const fileAnalysis = state.fileAnalysis;
    const questionAnswer = state.questionAnswer;
    const isAnalysing = state.loadingAction === `analyse-file:${file}`;
    const isAsking = state.loadingAction === `ask:${file}`;
    const providerLabel = getProviderLabel(state.provider ?? "mock");

    const anchor = state.anchorRect;
    const width = state.expanded ? Math.min(720, window.innerWidth - 32) : 430;
    const left = state.expanded
      ? Math.max((window.innerWidth - width) / 2, 16)
      : Math.min(Math.max(anchor ? anchor.left : window.innerWidth - width - 24, 16), window.innerWidth - width - 16);
    const top = state.expanded
      ? 72
      : Math.min(Math.max(anchor ? anchor.bottom + 8 : 92, 72), Math.max(window.innerHeight - 520, 72));
    const manualPosition = this.manualPosition?.file === file ? this.manualPosition : null;
    this.element.style.left = `${manualPosition?.left ?? left}px`;
    this.element.style.top = `${manualPosition?.top ?? top}px`;
    this.element.style.width = `${width}px`;
    this.element.dataset.rgFile = file;
    this.element.classList.toggle("rg-review-guide__popover--expanded", state.expanded);

    this.element.classList.add("rg-review-guide__popover--open");
    this.element.innerHTML = `
      <div class="rg-review-guide__popover-header" data-rg-popover-drag-handle="true" title="Drag to move file analysis">
        <div>
          <div class="rg-review-guide__popover-title">${escapeHtml(file)}</div>
          <div class="rg-review-guide__muted">
            ${changedFile ? `${changedFile.additions} additions, ${changedFile.deletions} deletions` : "Changed file"}
          </div>
        </div>
        <div class="rg-review-guide__popover-header-actions">
          <button data-rg-popover-action="toggle-expanded">${state.expanded ? "Collapse" : "Expand"}</button>
          <button data-rg-popover-action="close" aria-label="Close">Close</button>
        </div>
      </div>

      <div class="rg-review-guide__popover-risk">
        <span class="rg-review-guide__risk rg-review-guide__risk--${risk}">${risk}</span>
        <span>${escapeHtml(reason)}</span>
      </div>
      <div class="rg-review-guide__muted">${escapeHtml(suggestedAction)}</div>

      ${
        state.selectedText
          ? `<div class="rg-review-guide__selection-context">
              <strong>Selected diff text</strong>
              <div>${escapeHtml(state.selectedText.slice(0, 500))}${state.selectedText.length > 500 ? "..." : ""}</div>
            </div>`
          : ""
      }

      <div class="rg-review-guide__actions rg-review-guide__actions--wrap">
        <button data-rg-popover-action="analyse-file" data-rg-file="${escapeHtml(file)}" ${
          isAnalysing ? "disabled" : ""
        }>${isAnalysing ? "Analyzing..." : fileAnalysis ? "Refresh analysis" : "Analyze file"}</button>
        <button data-rg-popover-action="toggle-reviewed" data-rg-file="${escapeHtml(file)}">${
          state.reviewed ? "Mark unreviewed" : "Mark reviewed"
        }</button>
      </div>

      ${isAnalysing ? renderLoading(`${providerLabel} is analyzing this file. This can take 30-60 seconds.`) : ""}

      ${
        fileAnalysis
          ? `<div class="rg-review-guide__file-detail">
              <strong>What changed</strong>
              <div>${renderList(fileAnalysis.summary)}</div>
              <div class="rg-review-guide__subsection">
                <strong>In the larger PR</strong>
                <p>${escapeHtml(fileAnalysis.prContext)}</p>
              </div>
              <div class="rg-review-guide__subsection">
                <strong>Risks</strong>
                <div>${renderList(fileAnalysis.risks)}</div>
              </div>
              <div class="rg-review-guide__subsection">
                <strong>Review checks</strong>
                <div>${renderList(fileAnalysis.reviewChecks)}</div>
              </div>
              <div class="rg-review-guide__subsection">
                <strong>Suggested tests</strong>
                <div>${renderList(fileAnalysis.suggestedTests)}</div>
              </div>
              ${
                fileAnalysis.suggestedComment
                  ? `<div class="rg-review-guide__suggested-comment">
                      <strong>Possible GitHub comment</strong>
                      <div>${escapeHtml(fileAnalysis.suggestedComment)}</div>
                    </div>`
                  : ""
              }
            </div>`
          : `<div class="rg-review-guide__file-detail rg-review-guide__muted">Analyze this file to get a concise summary, risks, and review checks.</div>`
      }

      <div class="rg-review-guide__ask-box">
        <label for="rg-review-guide-question">Ask about this file</label>
        <textarea id="rg-review-guide-question" data-rg-question-input data-rg-file="${escapeHtml(
          file
        )}" rows="2" placeholder="Ask a focused question...">${escapeHtml(state.questionDraft)}</textarea>
        <button data-rg-popover-action="ask" data-rg-file="${escapeHtml(file)}" ${
          isAsking ? "disabled" : ""
        }>${isAsking ? "Asking..." : "Ask"}</button>
      </div>

      ${isAsking ? renderLoading(`${providerLabel} is answering your question.`) : ""}

      ${
        questionAnswer
          ? `<div class="rg-review-guide__file-detail">
              <strong>Answer</strong>
              <div>${renderList(questionAnswer.answer)}</div>
              <div class="rg-review-guide__muted">Confidence: ${escapeHtml(questionAnswer.confidence)}</div>
              ${
                questionAnswer.suggestedComment
                  ? `<div class="rg-review-guide__suggested-comment">
                      <strong>Suggested GitHub comment</strong>
                      <div>${escapeHtml(questionAnswer.suggestedComment)}</div>
                    </div>`
                  : ""
              }
            </div>`
          : ""
      }

      ${
        state.explanation
          ? `<div class="rg-review-guide__file-detail">
              <strong>Legacy explanation</strong>
              <p>${escapeHtml(state.explanation.explanation)}</p>
              <div>${renderList(state.explanation.thingsToCheck)}</div>
              <div class="rg-review-guide__subsection">
                <strong>Possible callers</strong>
                ${state.explanation.possibleCallers
                  .map((item) => `<div class="rg-review-guide__muted">${escapeHtml(item)}</div>`)
                  .join("")}
              </div>
            </div>`
          : ""
      }

      ${
        state.tests
          ? `<div class="rg-review-guide__file-detail">
              <strong>Suggested tests</strong>
              <div>${renderList(state.tests.suggestedTests)}</div>
              <div>${state.tests.commands
                .map((item) => `<code class="rg-review-guide__code">${escapeHtml(item)}</code>`)
                .join("")}</div>
            </div>`
          : ""
      }

      <div class="rg-review-guide__popover-footer">
        <button data-rg-popover-action="pre-approval">Run pre-approval check</button>
      </div>
    `;
  }
}
