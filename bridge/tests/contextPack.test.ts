import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFileContextPack, buildPrContextPack } from "../src/contextPack";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe"
  }).trim();
}

async function makeRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "review-guide-context-"));
  git(repoPath, ["init"]);
  git(repoPath, ["config", "user.name", "Review Guide Test"]);
  git(repoPath, ["config", "user.email", "review-guide@example.test"]);

  await fs.writeFile(path.join(repoPath, "README.md"), "Initial\n", "utf8");
  await fs.writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify({ scripts: { test: "vitest run", lint: "eslint .", start: "node server.js" } }, null, 2),
    "utf8"
  );
  git(repoPath, ["add", "README.md", "package.json"]);
  git(repoPath, ["commit", "-m", "Initial commit"]);

  await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "src", "helper.ts"), "export const helper = () => 1;\n", "utf8");
  await fs.writeFile(
    path.join(repoPath, "src", "api.ts"),
    "import { helper } from './helper';\nexport const api = () => helper();\n",
    "utf8"
  );
  await fs.writeFile(path.join(repoPath, "src", "api.test.ts"), "import { api } from './api';\napi();\n", "utf8");
  git(repoPath, ["add", "src"]);
  git(repoPath, ["commit", "-m", "PR change"]);

  return repoPath;
}

describe("buildFileContextPack", () => {
  it("builds a compact deterministic context pack for a changed file", async () => {
    const repoPath = await makeRepo();
    const contextPack = await buildFileContextPack({
      worktreePath: repoPath,
      baseRef: "HEAD~1",
      file: "src/api.ts"
    });

    expect(contextPack.file).toBe("src/api.ts");
    expect(contextPack.changedFiles).toEqual(["src/api.test.ts", "src/api.ts", "src/helper.ts"]);
    expect(contextPack.relatedChangedFiles).toContain("src/helper.ts");
    expect(contextPack.likelyTestFiles).toContain("src/api.test.ts");
    expect(contextPack.packageScripts).toContain("test: vitest run");
    expect(contextPack.packageScripts).toContain("lint: eslint .");
    expect(contextPack.packageScripts).not.toContain("start: node server.js");
    expect(contextPack.diffStat).toContain("src/api.ts");
    expect(contextPack.fileDiff).toContain("export const api");
    expect(contextPack.importHints).toContain("+import { helper } from './helper';");
    expect(contextPack.fileDiffTruncated).toBe(false);
  });
});

describe("buildPrContextPack", () => {
  it("builds a bounded PR-level context pack for overview analysis", async () => {
    const repoPath = await makeRepo();
    const contextPack = await buildPrContextPack({
      worktreePath: repoPath,
      baseRef: "HEAD~1"
    });

    expect(contextPack.changedFileCount).toBe(3);
    expect(contextPack.changedFiles.map((file) => file.file)).toEqual(["src/api.test.ts", "src/api.ts", "src/helper.ts"]);
    expect(contextPack.changedFiles.find((file) => file.file === "src/api.ts")?.riskSignals).toContain("API contract");
    expect(contextPack.topRiskFiles.length).toBeGreaterThan(0);
    expect(contextPack.sampledFileDiffs[0].diff).toContain("export const api");
    expect(contextPack.likelyTestFiles).toContain("src/api.test.ts");
    expect(contextPack.packageScripts).toContain("test: vitest run");
    expect(contextPack.packageScripts).not.toContain("start: node server.js");
    expect(contextPack.directorySummary[0]).toMatchObject({
      directory: "src",
      files: 3
    });
    expect(contextPack.notes.join(" ")).toContain("starting map");
  });
});
