import fs from "node:fs/promises";
import path from "node:path";
import type { PreparePrWorktreeResponse, PullRequestIdentity, RepoBinding } from "@review-guide/shared";
import { getWorktreesRoot } from "./config.js";
import { AppError } from "./errors.js";
import { runCommand } from "./git.js";
import { listGitRemotes, normalizeGitRemoteUrl, repoIdentityToRemoteKey } from "./repoBinding.js";

function resolveManagedWorktreePath(identity: PullRequestIdentity): string {
  return path.join(
    getWorktreesRoot(),
    identity.host,
    identity.owner,
    identity.repo,
    `pr-${identity.prNumber}`
  );
}

export function getManagedWorktreePath(identity: PullRequestIdentity): string {
  return path.resolve(resolveManagedWorktreePath(identity));
}

export function isManagedWorktreePath(targetPath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const managedRoot = path.resolve(getWorktreesRoot());
  const relativePath = path.relative(managedRoot, resolvedTarget);
  return Boolean(relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export function assertManagedWorktreePath(targetPath: string): void {
  if (!isManagedWorktreePath(targetPath)) {
    throw new AppError(`Refusing to remove unmanaged worktree path: ${targetPath}`, 400);
  }
}

async function getMatchingRemoteName(binding: RepoBinding): Promise<string> {
  const remotes = await listGitRemotes(binding.localPath);
  const expected = repoIdentityToRemoteKey(binding);
  const match = remotes.find((remote) => normalizeGitRemoteUrl(remote.url) === expected);

  if (!match) {
    throw new AppError(
      `The bound repository remotes no longer match ${binding.host}/${binding.owner}/${binding.repo}.`,
      400,
      { detectedRemotes: remotes.map((remote) => remote.url) }
    );
  }

  return match.name;
}

async function resolveDefaultBaseBranch(localPath: string, remoteName: string): Promise<string | null> {
  const symbolicHead = await runCommand(
    "git",
    ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remoteName}/HEAD`],
    { cwd: localPath, allowNonZeroExit: true }
  );

  if (symbolicHead.exitCode === 0 && symbolicHead.stdout.includes("/")) {
    return symbolicHead.stdout.split("/").slice(1).join("/");
  }

  const remoteShow = await runCommand("git", ["remote", "show", remoteName], {
    cwd: localPath,
    allowNonZeroExit: true
  });

  const match = remoteShow.stdout.match(/HEAD branch:\s+([^\n]+)/);
  return match?.[1] ?? null;
}

function normalizeBaseBranchHint(baseBranchHint: string | undefined, remoteName: string): string | null {
  let branch = baseBranchHint?.trim();
  if (!branch) {
    return null;
  }

  if (branch.startsWith(`${remoteName}/`)) {
    branch = branch.slice(remoteName.length + 1);
  }

  if (branch.startsWith("refs/heads/")) {
    branch = branch.slice("refs/heads/".length);
  }

  const invalid =
    !branch ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.startsWith(".") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.includes("@{") ||
    branch.endsWith(".lock") ||
    /[\s\\~^:?*[\]\x00-\x1f\x7f]/.test(branch);

  if (invalid) {
    throw new AppError(`Invalid base branch hint: ${baseBranchHint}`, 400);
  }

  return branch;
}

async function resolvePrBaseRef(
  binding: RepoBinding,
  remoteName: string,
  prNumber: number,
  baseBranchHint?: string
): Promise<string> {
  const normalizedHint = normalizeBaseBranchHint(baseBranchHint, remoteName);
  if (normalizedHint) {
    console.log(`[bridge:worktree] using base branch hint ${normalizedHint} for ${binding.owner}/${binding.repo}#${prNumber}`);
    return `${remoteName}/${normalizedHint}`;
  }

  const ghResult = await runCommand(
    "gh",
    ["pr", "view", String(prNumber), "--repo", `${binding.owner}/${binding.repo}`, "--json", "baseRefName"],
    { cwd: binding.localPath, allowNonZeroExit: true, timeoutMs: 20_000 }
  );

  if (ghResult.exitCode === 0 && ghResult.stdout) {
    try {
      const parsed = JSON.parse(ghResult.stdout) as { baseRefName?: string };
      if (parsed.baseRefName) {
        return `${remoteName}/${parsed.baseRefName}`;
      }
    } catch {
      // fall through to git-only resolution
    }
  }

  const defaultBranch = await resolveDefaultBaseBranch(binding.localPath, remoteName);
  if (defaultBranch) {
    return `${remoteName}/${defaultBranch}`;
  }

  throw new AppError(
    "Unable to resolve the PR base branch automatically. Ensure gh is authenticated or your remote HEAD is configured.",
    500
  );
}

async function removeRegisteredWorktree(mainRepoPath: string, worktreePath: string): Promise<void> {
  if (await isRegisteredWorktree(mainRepoPath, worktreePath)) {
    await runCommand("git", ["worktree", "remove", "--force", worktreePath], { cwd: mainRepoPath });
  }
}

async function canonicalPath(targetPath: string): Promise<string> {
  return fs.realpath(targetPath).catch(() => path.resolve(targetPath));
}

async function getRegisteredWorktreePaths(mainRepoPath: string): Promise<string[]> {
  const list = await runCommand("git", ["worktree", "list", "--porcelain"], {
    cwd: mainRepoPath,
    allowNonZeroExit: true
  });

  return list.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.replace(/^worktree\s+/, ""));
}

async function isRegisteredWorktree(mainRepoPath: string, worktreePath: string): Promise<boolean> {
  const targetResolved = path.resolve(worktreePath);
  const targetCanonical = await canonicalPath(worktreePath);
  const registeredPaths = await getRegisteredWorktreePaths(mainRepoPath);

  for (const registeredPath of registeredPaths) {
    const registeredResolved = path.resolve(registeredPath);
    const registeredCanonical = await canonicalPath(registeredPath);
    if (
      registeredResolved === targetResolved ||
      registeredResolved === targetCanonical ||
      registeredCanonical === targetResolved ||
      registeredCanonical === targetCanonical
    ) {
      return true;
    }
  }

  return false;
}

function extractMainRepoPathFromGitdir(gitdirPath: string): string | null {
  const normalized = path.resolve(gitdirPath);
  if (!normalized.includes(`${path.sep}.git${path.sep}worktrees${path.sep}`)) {
    return null;
  }

  return path.resolve(normalized, "../../..");
}

async function inferMainRepoPathFromWorktree(worktreePath: string): Promise<string | null> {
  const gitFilePath = path.join(worktreePath, ".git");
  try {
    const raw = await fs.readFile(gitFilePath, "utf8");
    const match = raw.match(/^gitdir:\s+(.+)$/m);
    if (!match) {
      return null;
    }

    return extractMainRepoPathFromGitdir(match[1].trim());
  } catch {
    return null;
  }
}

async function resolveGitSha(cwd: string, ref: string): Promise<string | null> {
  const result = await runCommand("git", ["rev-parse", "--verify", ref], {
    cwd,
    allowNonZeroExit: true
  });

  return result.exitCode === 0 && result.stdout ? result.stdout : null;
}

async function canReuseManagedWorktree(
  mainRepoPath: string,
  worktreePath: string,
  expectedHeadSha: string
): Promise<boolean> {
  assertManagedWorktreePath(worktreePath);

  const stats = await fs.stat(worktreePath).catch(() => null);
  if (!stats?.isDirectory()) {
    console.log(`[bridge:worktree] no existing managed worktree at ${worktreePath}; creating fresh worktree`);
    return false;
  }

  if (!(await isRegisteredWorktree(mainRepoPath, worktreePath))) {
    console.log(`[bridge:worktree] existing path is not a registered git worktree: ${worktreePath}; recreating`);
    return false;
  }

  const existingHeadSha = await resolveGitSha(worktreePath, "HEAD");
  if (existingHeadSha !== expectedHeadSha) {
    console.log(
      `[bridge:worktree] PR head changed for ${worktreePath}; existing=${existingHeadSha ?? "unknown"} expected=${expectedHeadSha}; recreating`
    );
    return false;
  }

  const status = await runCommand("git", ["status", "--porcelain"], {
    cwd: worktreePath,
    allowNonZeroExit: true
  });
  if (status.exitCode !== 0) {
    console.log(`[bridge:worktree] unable to read worktree status for ${worktreePath}; recreating`);
    return false;
  }

  if (status.stdout) {
    console.log(`[bridge:worktree] managed worktree has local changes; recreating ${worktreePath}`);
    return false;
  }

  console.log(`[bridge:worktree] reusing worktree; PR head SHA unchanged (${expectedHeadSha}) at ${worktreePath}`);
  return true;
}

export async function removeManagedWorktreePath(worktreePath: string, mainRepoPath?: string): Promise<void> {
  assertManagedWorktreePath(worktreePath);

  const resolvedMainRepoPath = mainRepoPath ?? (await inferMainRepoPathFromWorktree(worktreePath));
  if (resolvedMainRepoPath) {
    await removeRegisteredWorktree(resolvedMainRepoPath, worktreePath);
  }

  await fs.rm(worktreePath, { recursive: true, force: true });
}

export async function preparePrWorktree(
  binding: RepoBinding,
  identity: PullRequestIdentity
): Promise<PreparePrWorktreeResponse> {
  const remoteName = await getMatchingRemoteName(binding);
  const baseRef = await resolvePrBaseRef(binding, remoteName, identity.prNumber, identity.baseBranchHint);
  const prRef = `refs/review-guide/pr-${identity.prNumber}`;
  const worktreePath = getManagedWorktreePath(identity);

  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  console.log(`[bridge:worktree] fetching base ref ${baseRef} for ${identity.owner}/${identity.repo}#${identity.prNumber}`);
  await runCommand("git", ["fetch", remoteName, baseRef.replace(`${remoteName}/`, "")], { cwd: binding.localPath });
  console.log(`[bridge:worktree] fetching PR ref pull/${identity.prNumber}/head -> ${prRef} (force-updating managed ref)`);
  await runCommand("git", ["fetch", remoteName, `+pull/${identity.prNumber}/head:${prRef}`], {
    cwd: binding.localPath
  });

  const prHeadSha = await resolveGitSha(binding.localPath, prRef);
  if (!prHeadSha) {
    throw new AppError(`Unable to resolve fetched PR ref: ${prRef}`, 500);
  }

  if (await canReuseManagedWorktree(binding.localPath, worktreePath, prHeadSha)) {
    return {
      ok: true,
      mainRepoPath: binding.localPath,
      worktreePath,
      baseRef,
      headRef: "HEAD",
      prRef
    };
  }

  await removeManagedWorktreePath(worktreePath, binding.localPath);
  console.log(`[bridge:worktree] creating managed worktree at ${worktreePath} for ${prRef}`);
  await runCommand("git", ["worktree", "add", "--force", worktreePath, prRef], { cwd: binding.localPath });

  return {
    ok: true,
    mainRepoPath: binding.localPath,
    worktreePath,
    baseRef,
    headRef: "HEAD",
    prRef
  };
}

async function collectCandidateWorktrees(rootDir: string): Promise<string[]> {
  const collected: string[] = [];

  async function walk(currentPath: string, depth: number): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name.startsWith("pr-")) {
        collected.push(entryPath);
        continue;
      }

      if (depth < 4) {
        await walk(entryPath, depth + 1);
      }
    }
  }

  await walk(rootDir, 0);
  return collected;
}

export async function cleanupOldManagedWorktrees(olderThanDays: number): Promise<string[]> {
  const root = getWorktreesRoot();
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const candidates = await collectCandidateWorktrees(root).catch(() => []);
  const removed: string[] = [];

  for (const candidate of candidates) {
    const stats = await fs.stat(candidate).catch(() => null);
    if (!stats || stats.mtimeMs > cutoff) {
      continue;
    }

    await removeManagedWorktreePath(candidate);
    removed.push(candidate);
  }

  return removed;
}
