import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertManagedWorktreePath,
  getManagedWorktreePath,
  isManagedWorktreePath,
  preparePrWorktree
} from "../src/worktree";
import { normalizeGitRemoteUrl } from "../src/repoBinding";

const originalHome = process.env.REVIEW_GUIDE_HOME;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe"
  }).trim();
}

interface WorktreeFixture {
  localPath: string;
  remoteUrl: string;
  identity: {
    host: string;
    owner: string;
    repo: string;
    prNumber: number;
  };
}

async function makeRepoWithPrRef(): Promise<WorktreeFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-guide-worktree-repo-"));
  const remotePath = path.join(root, "remote.git");
  const localPath = path.join(root, "local");
  const remoteUrl = `file://localhost${remotePath}`;
  const remoteKey = normalizeGitRemoteUrl(remoteUrl);
  if (!remoteKey) {
    throw new Error(`Unable to normalize test remote URL: ${remoteUrl}`);
  }
  const [host, owner, repo] = remoteKey.split("/");

  git(root, ["init", "--bare", remotePath]);
  git(root, ["clone", remotePath, localPath]);
  git(localPath, ["config", "user.name", "Review Guide Test"]);
  git(localPath, ["config", "user.email", "review-guide@example.test"]);
  git(localPath, ["remote", "set-url", "origin", remoteUrl]);

  await fs.writeFile(path.join(localPath, "README.md"), "Initial\n", "utf8");
  git(localPath, ["add", "README.md"]);
  git(localPath, ["commit", "-m", "Initial commit"]);
  git(localPath, ["push", "origin", "HEAD:main"]);
  git(localPath, ["remote", "set-head", "origin", "main"]);

  git(localPath, ["checkout", "-b", "feature"]);
  await fs.writeFile(path.join(localPath, "feature.txt"), "First PR head\n", "utf8");
  git(localPath, ["add", "feature.txt"]);
  git(localPath, ["commit", "-m", "First PR head"]);
  git(localPath, ["push", "origin", "HEAD:refs/pull/123/head"]);

  return {
    localPath,
    remoteUrl,
    identity: {
      host,
      owner,
      repo,
      prNumber: 123
    }
  };
}

async function prepareFixtureWorktree(fixture: WorktreeFixture) {
  return preparePrWorktree(
    {
      ...fixture.identity,
      localPath: fixture.localPath,
      remoteUrl: fixture.remoteUrl
    },
    fixture.identity
  );
}

describe("managed worktree paths", () => {
  let reviewGuideHome: string;

  beforeEach(async () => {
    reviewGuideHome = await fs.mkdtemp(path.join(os.tmpdir(), "review-guide-home-"));
    process.env.REVIEW_GUIDE_HOME = reviewGuideHome;
  });

  afterEach(() => {
    process.env.REVIEW_GUIDE_HOME = originalHome;
  });

  it("generates deterministic PR worktree paths", () => {
    expect(
      getManagedWorktreePath({
        host: "github.com",
        owner: "iag-loyalty",
        repo: "rewards-service",
        prNumber: 123
      })
    ).toBe(path.join(reviewGuideHome, "worktrees", "github.com", "iag-loyalty", "rewards-service", "pr-123"));
  });

  it("guards deletion to children of the managed worktree root", () => {
    const managedPrPath = path.join(reviewGuideHome, "worktrees", "github.com", "owner", "repo", "pr-1");

    expect(isManagedWorktreePath(managedPrPath)).toBe(true);
    expect(isManagedWorktreePath(path.join(reviewGuideHome, "worktrees"))).toBe(false);
    expect(() => assertManagedWorktreePath(path.join(os.tmpdir(), "outside-review-guide"))).toThrow(
      "Refusing to remove unmanaged worktree path"
    );
  });

  it("reuses an existing managed PR worktree when the fetched PR ref SHA is unchanged", async () => {
    const fixture = await makeRepoWithPrRef();
    const first = await prepareFixtureWorktree(fixture);
    const markerPath = path.join(first.worktreePath, ".review-guide-reuse-marker");
    const excludePathRaw = git(first.worktreePath, ["rev-parse", "--git-path", "info/exclude"]);
    const excludePath = path.isAbsolute(excludePathRaw)
      ? excludePathRaw
      : path.resolve(first.worktreePath, excludePathRaw);
    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    await fs.appendFile(excludePath, "\n.review-guide-reuse-marker\n", "utf8");
    await fs.writeFile(markerPath, "kept\n", "utf8");
    const canonicalWorktreePath = await fs.realpath(first.worktreePath);
    expect(git(first.worktreePath, ["status", "--porcelain"])).toBe("");
    expect(git(fixture.localPath, ["worktree", "list", "--porcelain"])).toContain(
      `worktree ${canonicalWorktreePath}`
    );
    expect(git(first.worktreePath, ["rev-parse", "HEAD"])).toBe(
      git(fixture.localPath, ["rev-parse", "refs/review-guide/pr-123"])
    );

    const second = await prepareFixtureWorktree(fixture);

    await expect(fs.readFile(markerPath, "utf8")).resolves.toBe("kept\n");
    expect(second.worktreePath).toBe(first.worktreePath);
  });

  it("recreates the managed PR worktree when the fetched PR ref SHA changes", async () => {
    const fixture = await makeRepoWithPrRef();
    const first = await prepareFixtureWorktree(fixture);
    const markerPath = path.join(first.worktreePath, ".review-guide-reuse-marker");
    await fs.writeFile(markerPath, "removed\n", "utf8");

    git(fixture.localPath, ["checkout", "feature"]);
    await fs.writeFile(path.join(fixture.localPath, "feature.txt"), "Second PR head\n", "utf8");
    git(fixture.localPath, ["add", "feature.txt"]);
    git(fixture.localPath, ["commit", "-m", "Second PR head"]);
    git(fixture.localPath, ["push", "--force", "origin", "HEAD:refs/pull/123/head"]);

    const second = await prepareFixtureWorktree(fixture);

    await expect(fs.stat(markerPath)).rejects.toThrow();
    expect(git(second.worktreePath, ["rev-parse", "HEAD"])).toBe(git(fixture.localPath, ["rev-parse", "HEAD"]));
  });
});
