import type { PullRequestIdentity } from "@review-guide/shared";

export function parseGitHubPrUrl(input: string | URL): PullRequestIdentity | null {
  const url = typeof input === "string" ? new URL(input) : input;
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/(?:files|changes))?\/?$/);

  if (!match) {
    return null;
  }

  return {
    host: url.host,
    owner: decodeURIComponent(match[1]),
    repo: decodeURIComponent(match[2]),
    prNumber: Number(match[3])
  };
}
