import type { FileContextPack, PrContextPack } from "@review-guide/shared";

export function renderFileContextPack(contextPack?: FileContextPack): string {
  if (!contextPack) {
    return "";
  }

  return `Precomputed context pack:
Use this first. Only inspect more of the repository if this context is insufficient.

${JSON.stringify(contextPack, null, 2)}`;
}

export function renderPrContextPack(contextPack?: PrContextPack): string {
  if (!contextPack) {
    return "";
  }

  return `Precomputed PR context pack:
Use this first to avoid rediscovering obvious PR shape, changed files, test hints, and likely risk areas.
This pack is a bounded starting map, not the source of truth.
Heuristic risk labels can be wrong or incomplete.
Inspect additional diffs, callers, and tests when a high-risk area, impact chain, or business implication is unclear.

${JSON.stringify(contextPack, null, 2)}`;
}
