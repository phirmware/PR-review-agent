import type { PullRequestIdentity } from "@review-guide/shared";

const memoryStore = new Map<string, unknown>();

function getStorageArea(): chrome.storage.StorageArea | null {
  return globalThis.chrome?.storage?.local ?? null;
}

function getReviewedFilesKey(pr: PullRequestIdentity): string {
  return `reviewed:${pr.host}/${pr.owner}/${pr.repo}#${pr.prNumber}`;
}

export async function getReviewedFiles(pr: PullRequestIdentity): Promise<string[]> {
  const key = getReviewedFilesKey(pr);
  const storage = getStorageArea();
  if (!storage) {
    return (memoryStore.get(key) as string[] | undefined) ?? [];
  }

  const result = await storage.get(key);
  return (result[key] as string[] | undefined) ?? [];
}

export async function setReviewedFiles(pr: PullRequestIdentity, files: string[]): Promise<void> {
  const key = getReviewedFilesKey(pr);
  const storage = getStorageArea();
  if (!storage) {
    memoryStore.set(key, files);
    return;
  }

  await storage.set({ [key]: files });
}
