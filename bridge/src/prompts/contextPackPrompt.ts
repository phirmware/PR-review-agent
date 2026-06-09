import type { FileContextPack } from "@review-guide/shared";

export function renderFileContextPack(contextPack?: FileContextPack): string {
  if (!contextPack) {
    return "";
  }

  return `Precomputed context pack:
Use this first. Only inspect more of the repository if this context is insufficient.

${JSON.stringify(contextPack, null, 2)}`;
}
