import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/providers/MockProvider";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe"
  });
}

async function makeChangedRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "review-guide-provider-"));
  git(repoPath, ["init"]);
  git(repoPath, ["config", "user.name", "Review Guide Test"]);
  git(repoPath, ["config", "user.email", "review-guide@example.test"]);

  await fs.writeFile(path.join(repoPath, "README.md"), "Initial\n", "utf8");
  git(repoPath, ["add", "README.md"]);
  git(repoPath, ["commit", "-m", "Initial commit"]);

  await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "src", "api.ts"), "export const api = 1;\n", "utf8");
  await fs.writeFile(path.join(repoPath, "package.json"), "{\"name\":\"demo\"}\n", "utf8");
  git(repoPath, ["add", "src/api.ts", "package.json"]);
  git(repoPath, ["commit", "-m", "PR change"]);

  return repoPath;
}

describe("MockProvider", () => {
  it("returns deterministic structured guidance from git diff metadata", async () => {
    const repoPath = await makeChangedRepo();
    const provider = new MockProvider();

    const result = await provider.analysePr({
      host: "github.com",
      owner: "iag-loyalty",
      repo: "rewards-service",
      prNumber: 123,
      worktreePath: repoPath,
      baseRef: "HEAD~1",
      headRef: "HEAD"
    });

    expect(result.changedFiles.map((file) => file.file).sort()).toEqual(["package.json", "src/api.ts"]);
    expect(result.reviewOrder[0].risk).toBe("high");
    expect(result.summary).toContain("Mock provider reviewed 2 changed file");
  });

  it("supports explain-file and pre-approval checks", async () => {
    const repoPath = await makeChangedRepo();
    const provider = new MockProvider();

    await expect(
      provider.explainFile({
        host: "github.com",
        owner: "iag-loyalty",
        repo: "rewards-service",
        prNumber: 123,
        worktreePath: repoPath,
        baseRef: "HEAD~1",
        headRef: "HEAD",
        file: "src/api.ts"
      })
    ).resolves.toMatchObject({
      file: "src/api.ts"
    });

    await expect(
      provider.preApprovalCheck({
        host: "github.com",
        owner: "iag-loyalty",
        repo: "rewards-service",
        prNumber: 123,
        worktreePath: repoPath,
        baseRef: "HEAD~1",
        headRef: "HEAD",
        reviewedFiles: ["src/api.ts"]
      })
    ).resolves.toMatchObject({
      recommendation: "request_changes"
    });
  });

  it("supports file analysis and concise file questions", async () => {
    const repoPath = await makeChangedRepo();
    const provider = new MockProvider();
    const input = {
      host: "github.com",
      owner: "iag-loyalty",
      repo: "rewards-service",
      prNumber: 123,
      worktreePath: repoPath,
      baseRef: "HEAD~1",
      headRef: "HEAD",
      file: "src/api.ts"
    } as const;

    await expect(provider.analyseFile(input)).resolves.toMatchObject({
      file: "src/api.ts",
      prContext: expect.stringContaining("PR #123")
    });

    await expect(
      provider.askFileQuestion({
        ...input,
        question: "What should I verify?"
      })
    ).resolves.toMatchObject({
      file: "src/api.ts",
      confidence: "medium"
    });
  });
});
