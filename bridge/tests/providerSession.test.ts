import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getProviderSessionId } from "../src/providers/providerSession";

const originalProviderSessions = process.env.REVIEW_GUIDE_PROVIDER_SESSIONS;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe"
  }).trim();
}

async function makeRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "review-guide-session-"));
  git(repoPath, ["init"]);
  git(repoPath, ["config", "user.name", "Review Guide Test"]);
  git(repoPath, ["config", "user.email", "review-guide@example.test"]);
  await fs.writeFile(path.join(repoPath, "README.md"), "Initial\n", "utf8");
  git(repoPath, ["add", "README.md"]);
  git(repoPath, ["commit", "-m", "Initial commit"]);
  return repoPath;
}

describe("provider sessions", () => {
  afterEach(() => {
    process.env.REVIEW_GUIDE_PROVIDER_SESSIONS = originalProviderSessions;
  });

  it("generates a stable UUID for the same provider and PR head", async () => {
    const repoPath = await makeRepo();
    const input = {
      host: "github.com",
      owner: "iag-loyalty",
      repo: "rewards-service",
      prNumber: 123,
      worktreePath: repoPath,
      baseRef: "origin/main",
      headRef: "HEAD"
    };

    await expect(getProviderSessionId("copilot-cli", input)).resolves.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    await expect(getProviderSessionId("copilot-cli", input)).resolves.toBe(
      await getProviderSessionId("copilot-cli", input)
    );
    await expect(getProviderSessionId("claude-code", input)).resolves.not.toBe(
      await getProviderSessionId("copilot-cli", input)
    );
  });

  it("changes session ID when the worktree HEAD changes", async () => {
    const repoPath = await makeRepo();
    const input = {
      host: "github.com",
      owner: "iag-loyalty",
      repo: "rewards-service",
      prNumber: 123,
      worktreePath: repoPath,
      baseRef: "origin/main",
      headRef: "HEAD"
    };
    const first = await getProviderSessionId("copilot-cli", input);

    await fs.writeFile(path.join(repoPath, "README.md"), "Changed\n", "utf8");
    git(repoPath, ["add", "README.md"]);
    git(repoPath, ["commit", "-m", "Changed"]);

    await expect(getProviderSessionId("copilot-cli", input)).resolves.not.toBe(first);
  });

  it("changes session ID when the base ref moves and HEAD stays the same", async () => {
    const repoPath = await makeRepo();
    git(repoPath, ["branch", "base"]);
    git(repoPath, ["checkout", "-b", "feature"]);
    const input = {
      host: "github.com",
      owner: "iag-loyalty",
      repo: "rewards-service",
      prNumber: 123,
      worktreePath: repoPath,
      baseRef: "base",
      headRef: "HEAD"
    };
    const featureHead = git(repoPath, ["rev-parse", "HEAD"]);
    const first = await getProviderSessionId("copilot-cli", input);

    git(repoPath, ["checkout", "base"]);
    await fs.writeFile(path.join(repoPath, "base.txt"), "Base moved\n", "utf8");
    git(repoPath, ["add", "base.txt"]);
    git(repoPath, ["commit", "-m", "Move base"]);
    git(repoPath, ["checkout", "feature"]);

    expect(git(repoPath, ["rev-parse", "HEAD"])).toBe(featureHead);
    await expect(getProviderSessionId("copilot-cli", input)).resolves.not.toBe(first);
  });

  it("can be disabled with REVIEW_GUIDE_PROVIDER_SESSIONS=0", async () => {
    const repoPath = await makeRepo();
    process.env.REVIEW_GUIDE_PROVIDER_SESSIONS = "0";

    await expect(
      getProviderSessionId("copilot-cli", {
        host: "github.com",
        owner: "iag-loyalty",
        repo: "rewards-service",
        prNumber: 123,
        worktreePath: repoPath,
        baseRef: "origin/main",
        headRef: "HEAD"
      })
    ).resolves.toBeNull();
  });
});
