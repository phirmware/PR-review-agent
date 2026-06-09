import fs from "node:fs/promises";
import path from "node:path";
import type { RepoBindingKey } from "@review-guide/shared";
import { AppError } from "./errors.js";
import { runCommand } from "./git.js";

export interface GitRemote {
  name: string;
  url: string;
}

export interface RepoBindingValidationSuccess {
  ok: true;
  localPath: string;
  remoteUrl: string;
  remoteName: string;
}

export interface RepoBindingValidationFailure {
  ok: false;
  error: string;
  detectedRemotes?: string[];
  warning?: string;
}

export type RepoBindingValidationResult = RepoBindingValidationSuccess | RepoBindingValidationFailure;

export function normalizeGitRemoteUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim().replace(/\/+$/, "").replace(/\.git$/i, "");

  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/(.+)$/i);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}/${sshMatch[3]}`.toLowerCase();
  }

  const sshProtocolMatch = trimmed.match(/^ssh:\/\/git@([^/]+)\/([^/]+)\/(.+)$/i);
  if (sshProtocolMatch) {
    return `${sshProtocolMatch[1]}/${sshProtocolMatch[2]}/${sshProtocolMatch[3]}`.toLowerCase();
  }

  try {
    const parsed = new URL(trimmed);
    const [, owner, repo] = parsed.pathname.split("/");
    if (!owner || !repo) {
      return null;
    }

    return `${parsed.host}/${owner}/${repo}`.toLowerCase();
  } catch {
    return null;
  }
}

export function repoIdentityToRemoteKey(identity: RepoBindingKey): string {
  return `${identity.host}/${identity.owner}/${identity.repo}`.toLowerCase();
}

export async function listGitRemotes(localPath: string): Promise<GitRemote[]> {
  const result = await runCommand("git", ["remote", "-v"], { cwd: localPath });
  const uniqueRemotes = new Map<string, GitRemote>();

  for (const line of result.stdout.split("\n")) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match) {
      continue;
    }

    const [_, name, url] = match;
    uniqueRemotes.set(`${name}:${url}`, { name, url });
  }

  return [...uniqueRemotes.values()];
}

export async function validateRepoBinding(
  localPathInput: string,
  identity: RepoBindingKey
): Promise<RepoBindingValidationResult> {
  const localPath = path.resolve(localPathInput.trim());

  if (!localPathInput.trim()) {
    return {
      ok: false,
      error: "Please enter a local repository path."
    };
  }

  try {
    const stats = await fs.stat(localPath);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        error: "The selected path is not a directory."
      };
    }
  } catch {
    return {
      ok: false,
      error: "The selected folder does not exist."
    };
  }

  const isGitRepo = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: localPath,
    allowNonZeroExit: true
  });

  if (isGitRepo.exitCode !== 0 || isGitRepo.stdout !== "true") {
    return {
      ok: false,
      error: "The selected folder is not a git repository."
    };
  }

  const remotes = await listGitRemotes(localPath);
  const expectedRemoteKey = repoIdentityToRemoteKey(identity);
  const matchingRemote = remotes.find((remote) => normalizeGitRemoteUrl(remote.url) === expectedRemoteKey);

  if (!matchingRemote) {
    return {
      ok: false,
      error: `The selected folder is a git repository, but its remote does not match ${identity.host}/${identity.owner}/${identity.repo}.`,
      detectedRemotes: remotes.map((remote) => remote.url),
      warning: remotes.length > 0 ? "Select the matching repository checkout before binding." : undefined
    };
  }

  return {
    ok: true,
    localPath,
    remoteUrl: matchingRemote.url,
    remoteName: matchingRemote.name
  };
}

export async function assertBoundRepoPath(localPath: string): Promise<void> {
  try {
    await fs.access(localPath);
  } catch {
    throw new AppError(`The bound local repository path no longer exists: ${localPath}`, 400);
  }
}
