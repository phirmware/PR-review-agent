import type { AnalysePrResponse, ReviewBadgeLevel } from "@review-guide/shared";

export const DOM_IDS = {
  button: "rg-review-guide-button",
  panel: "rg-review-guide-panel",
  popover: "rg-review-guide-popover",
  selectionToolbar: "rg-review-guide-selection-toolbar"
} as const;

const BADGE_CLASS = "rg-review-guide-badge";
const FILE_ACTION_CLASS = "rg-review-guide-file-action";

export interface GitHubFileHeader {
  file: string;
  header: HTMLElement;
  titleElement: HTMLElement;
}

export function ensureFloatingButton(onClick: () => void): HTMLButtonElement {
  let button = document.getElementById(DOM_IDS.button) as HTMLButtonElement | null;
  if (!button) {
    button = document.createElement("button");
    button.id = DOM_IDS.button;
    button.type = "button";
    button.className = "rg-review-guide__button";
    button.textContent = "Review Guide";
    document.body.appendChild(button);
  }

  button.onclick = onClick;
  button.hidden = false;
  return button;
}

export function hideFloatingButton(): void {
  const button = document.getElementById(DOM_IDS.button);
  if (button) {
    button.setAttribute("hidden", "true");
  }
}

export function ensurePanelElement(): HTMLDivElement {
  let panel = document.getElementById(DOM_IDS.panel) as HTMLDivElement | null;
  if (!panel) {
    panel = document.createElement("div");
    panel.id = DOM_IDS.panel;
    panel.className = "rg-review-guide__panel";
    document.body.appendChild(panel);
  }

  return panel;
}

export function getGitHubFileHeaders(): GitHubFileHeader[] {
  const selectors = [
    ".file-header[data-path]",
    "div.file-header[data-path]",
    ".js-file-header[data-path]"
  ];
  const matched = new Map<string, GitHubFileHeader>();

  for (const selector of selectors) {
    for (const header of document.querySelectorAll<HTMLElement>(selector)) {
      const file = header.getAttribute("data-path");
      if (!file || matched.has(file)) {
        continue;
      }

      const titleElement =
        header.querySelector<HTMLElement>("a.Link--primary, a[title], strong a, .Link--primary") ?? header;

      matched.set(file, { file, header, titleElement });
    }
  }

  return [...matched.values()];
}

export function applyRiskBadges(analysis: AnalysePrResponse | null): void {
  const badgeMap = new Map<string, ReviewBadgeLevel>();

  if (analysis) {
    for (const file of analysis.changedFiles) {
      badgeMap.set(file.file, file.risk);
    }
    for (const file of analysis.skimFiles) {
      badgeMap.set(file, "skim");
    }
  }

  for (const { file, titleElement } of getGitHubFileHeaders()) {
    const existingBadge = titleElement.parentElement?.querySelector<HTMLElement>(`.${BADGE_CLASS}`);
    const level = badgeMap.get(file);
    if (!level) {
      existingBadge?.remove();
      continue;
    }

    if (existingBadge) {
      if (existingBadge.dataset.rgLevel !== level) {
        existingBadge.className = `${BADGE_CLASS} ${BADGE_CLASS}--${level}`;
        existingBadge.textContent = level;
        existingBadge.dataset.rgLevel = level;
      }
      continue;
    }

    const badge = document.createElement("span");
    badge.className = `${BADGE_CLASS} ${BADGE_CLASS}--${level}`;
    badge.textContent = level;
    badge.dataset.rgLevel = level;
    titleElement.insertAdjacentElement("afterend", badge);
  }
}

export function applyFileReviewControls(
  analysis: AnalysePrResponse | null,
  reviewedFiles: string[],
  activeFile?: string | null,
  cachedAnalysedFiles: string[] = []
): void {
  const cachedAnalysedFileSet = new Set(cachedAnalysedFiles);
  const analysedFiles = new Set([
    ...(analysis?.changedFiles.map((file) => file.file) ?? []),
    ...(analysis?.reviewOrder.map((file) => file.file) ?? []),
    ...cachedAnalysedFileSet
  ]);
  const reviewedSet = new Set(reviewedFiles);

  for (const { file, titleElement } of getGitHubFileHeaders()) {
    const existingButton = titleElement.parentElement?.querySelector<HTMLButtonElement>(`.${FILE_ACTION_CLASS}`);
    if (!analysedFiles.has(file)) {
      existingButton?.remove();
      continue;
    }

    const isReviewed = reviewedSet.has(file);
    const isActive = activeFile === file;
    const hasCachedAnalysis = cachedAnalysedFileSet.has(file);
    const label = isReviewed ? "Reviewed" : isActive || hasCachedAnalysis ? "Open analysis" : "Analyze";
    const className = `${FILE_ACTION_CLASS}${isReviewed ? ` ${FILE_ACTION_CLASS}--reviewed` : ""}${
      isActive ? ` ${FILE_ACTION_CLASS}--active` : ""
    }`;

    if (existingButton) {
      existingButton.textContent = label;
      existingButton.className = className;
      existingButton.dataset.rgFile = file;
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className;
    button.dataset.rgFile = file;
    button.dataset.rgFileReview = "true";
    titleElement.parentElement?.appendChild(button);
  }
}

export function getCurrentGitHubFileInViewport(): string | null {
  const headers = getGitHubFileHeaders();
  if (headers.length === 0) {
    return null;
  }

  const anchorOffset = 140;
  const positionedHeaders = headers.map((item) => ({
    ...item,
    rect: item.header.getBoundingClientRect()
  }));

  const currentHeader = positionedHeaders
    .filter((item) => item.rect.top <= anchorOffset)
    .sort((left, right) => right.rect.top - left.rect.top)[0];

  if (currentHeader) {
    return currentHeader.file;
  }

  const nextHeader = positionedHeaders
    .filter((item) => item.rect.top > anchorOffset)
    .sort((left, right) => left.rect.top - right.rect.top)[0];

  return nextHeader?.file ?? null;
}

export function scrollToGitHubFile(file: string): void {
  const selector = `.file-header[data-path="${CSS.escape(file)}"], .js-file-header[data-path="${CSS.escape(file)}"]`;
  const element = document.querySelector<HTMLElement>(selector);
  element?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function getGitHubFileHeaderRect(file: string): DOMRect | null {
  const header = getGitHubFileHeaders().find((item) => item.file === file);
  return header?.header.getBoundingClientRect() ?? null;
}
