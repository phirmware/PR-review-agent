import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ConfigStore } from "../src/configStore";
import { normalizeGitRemoteUrl, validateRepoBinding } from "../src/repoBinding";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe"
  });
}

async function makeGitRepo(remoteUrl: string): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "review-guide-bind-"));
  git(repoPath, ["init"]);
  git(repoPath, ["remote", "add", "origin", remoteUrl]);
  return repoPath;
}

describe("repo binding", () => {
  it("normalizes common GitHub remote URL formats", () => {
    expect(normalizeGitRemoteUrl("git@github.com:iag-loyalty/rewards-service.git")).toBe(
      "github.com/iag-loyalty/rewards-service"
    );
    expect(normalizeGitRemoteUrl("https://github.com/iag-loyalty/rewards-service.git")).toBe(
      "github.com/iag-loyalty/rewards-service"
    );
    expect(normalizeGitRemoteUrl("https://github.com/iag-loyalty/rewards-service")).toBe(
      "github.com/iag-loyalty/rewards-service"
    );
  });

  it("validates a local git repo with a matching remote", async () => {
    const repoPath = await makeGitRepo("git@github.com:iag-loyalty/rewards-service.git");

    const result = await validateRepoBinding(repoPath, {
      host: "github.com",
      owner: "iag-loyalty",
      repo: "rewards-service"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.localPath).toBe(repoPath);
      expect(result.remoteName).toBe("origin");
    }
  });

  it("rejects a git repo whose remote does not match", async () => {
    const repoPath = await makeGitRepo("git@github.com:iag-loyalty/another-repo.git");

    const result = await validateRepoBinding(repoPath, {
      host: "github.com",
      owner: "iag-loyalty",
      repo: "rewards-service"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("remote does not match");
      expect(result.detectedRemotes).toEqual(["git@github.com:iag-loyalty/another-repo.git"]);
    }
  });

  it("reads and writes config bindings", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "review-guide-config-"));
    const store = new ConfigStore(path.join(tempDir, "config.json"));

    await store.setBinding({
      host: "github.com",
      owner: "iag-loyalty",
      repo: "rewards-service",
      localPath: "/tmp/rewards-service",
      remoteUrl: "git@github.com:iag-loyalty/rewards-service.git"
    });

    await expect(store.getBinding("github.com", "iag-loyalty", "rewards-service")).resolves.toEqual({
      host: "github.com",
      owner: "iag-loyalty",
      repo: "rewards-service",
      localPath: "/tmp/rewards-service",
      remoteUrl: "git@github.com:iag-loyalty/rewards-service.git"
    });
  });
});
