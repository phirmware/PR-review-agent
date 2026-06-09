import fs from "node:fs/promises";
import path from "node:path";
import type { FileContextPack } from "@review-guide/shared";
import { runCommand } from "./git.js";

const MAX_FILE_DIFF_CHARS = 12_000;
const MAX_DIFF_STAT_CHARS = 4_000;
const MAX_CHANGED_FILES = 80;
const MAX_RELATED_FILES = 12;
const MAX_TEST_FILES = 12;
const MAX_PACKAGE_SCRIPTS = 12;
const MAX_IMPORT_HINTS = 12;
const MAX_CALLER_HINTS = 10;

interface BuildFileContextPackInput {
  worktreePath: string;
  baseRef: string;
  file: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function truncate(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }

  return {
    text: `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`,
    truncated: true
  };
}

function dirname(value: string): string {
  const dir = path.posix.dirname(value);
  return dir === "." ? "" : dir;
}

function topLevelDir(value: string): string {
  return value.split("/")[0] ?? "";
}

function basenameWithoutExtension(value: string): string {
  const base = path.posix.basename(value);
  return base.replace(/\.(test|spec)\.[cm]?[tj]sx?$/i, "").replace(/\.[^.]+$/i, "");
}

function normalizedToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isLikelyTestFile(value: string): boolean {
  return (
    /(^|\/)(__tests__|tests?|specs?)(\/|$)/i.test(value) ||
    /\.(test|spec)\.[cm]?[tj]sx?$/i.test(value) ||
    /(^|\/)test[-_.]/i.test(value)
  );
}

function findRelatedChangedFiles(file: string, changedFiles: string[]): string[] {
  const fileDir = dirname(file);
  const fileTopLevel = topLevelDir(file);

  return changedFiles
    .filter((changedFile) => changedFile !== file)
    .filter((changedFile) => dirname(changedFile) === fileDir || topLevelDir(changedFile) === fileTopLevel)
    .slice(0, MAX_RELATED_FILES);
}

function findLikelyTestFiles(file: string, allFiles: string[], changedFiles: string[]): string[] {
  const fileDir = dirname(file);
  const fileToken = normalizedToken(basenameWithoutExtension(file));
  const candidates = allFiles.filter(isLikelyTestFile);
  const changedSet = new Set(changedFiles);

  return candidates
    .map((candidate) => {
      const candidateToken = normalizedToken(candidate);
      let score = 0;
      if (changedSet.has(candidate)) score += 5;
      if (dirname(candidate) === fileDir) score += 4;
      if (candidateToken.includes(fileToken)) score += 3;
      if (topLevelDir(candidate) === topLevelDir(file)) score += 1;
      return { candidate, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate))
    .map((item) => item.candidate)
    .slice(0, MAX_TEST_FILES);
}

function extractImportHints(fileDiff: string): string[] {
  return unique(
    fileDiff
      .split("\n")
      .filter((line) => /^[+-]\s*(import|export|const\s+\S+\s*=\s*require|.*\sfrom\s["'])/.test(line))
      .map((line) => line.slice(0, 220))
  ).slice(0, MAX_IMPORT_HINTS);
}

async function runOptionalCommand(command: string, args: string[], cwd: string, timeoutMs = 10_000): Promise<string> {
  try {
    const result = await runCommand(command, args, {
      cwd,
      allowNonZeroExit: true,
      timeoutMs
    });
    return result.stdout;
  } catch {
    return "";
  }
}

async function readPackageScripts(worktreePath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(worktreePath, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    return Object.entries(parsed.scripts ?? {})
      .filter(([, value]) => typeof value === "string")
      .filter(([key]) => /(test|spec|lint|type|check|build|jest|vitest)/i.test(key))
      .map(([key, value]) => `${key}: ${value}`)
      .slice(0, MAX_PACKAGE_SCRIPTS);
  } catch {
    return [];
  }
}

async function findCallerHints(file: string, worktreePath: string): Promise<string[]> {
  const token = basenameWithoutExtension(file);
  if (token.length < 4) {
    return [];
  }

  const output = await runOptionalCommand(
    "rg",
    ["-n", "--fixed-strings", "-m", "1", "--glob", `!${file}`, token, "."],
    worktreePath,
    5_000
  );

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith(`${file}:`))
    .map((line) => line.slice(0, 240))
    .slice(0, MAX_CALLER_HINTS);
}

export async function buildFileContextPack(input: BuildFileContextPackInput): Promise<FileContextPack> {
  const startedAt = Date.now();
  const [changedFilesRaw, diffStatRaw, fileDiffRaw, allFilesRaw, packageScripts, callerHints] = await Promise.all([
    runOptionalCommand("git", ["diff", "--name-only", `${input.baseRef}...HEAD`], input.worktreePath),
    runOptionalCommand("git", ["diff", "--stat", `${input.baseRef}...HEAD`], input.worktreePath),
    runOptionalCommand("git", ["diff", `${input.baseRef}...HEAD`, "--", input.file], input.worktreePath),
    runOptionalCommand("git", ["ls-files"], input.worktreePath),
    readPackageScripts(input.worktreePath),
    findCallerHints(input.file, input.worktreePath)
  ]);

  const changedFiles = changedFilesRaw.split("\n").filter(Boolean).slice(0, MAX_CHANGED_FILES);
  const allFiles = allFilesRaw.split("\n").filter(Boolean);
  const diffStat = truncate(diffStatRaw, MAX_DIFF_STAT_CHARS).text;
  const fileDiff = truncate(fileDiffRaw, MAX_FILE_DIFF_CHARS);
  const contextPack: FileContextPack = {
    file: input.file,
    changedFiles,
    relatedChangedFiles: findRelatedChangedFiles(input.file, changedFiles),
    likelyTestFiles: findLikelyTestFiles(input.file, allFiles, changedFiles),
    packageScripts,
    diffStat,
    fileDiff: fileDiff.text,
    fileDiffTruncated: fileDiff.truncated,
    importHints: extractImportHints(fileDiffRaw),
    callerHints
  };

  console.log(
    `[bridge:context] built file context pack for ${input.file}: changed=${contextPack.changedFiles.length} related=${contextPack.relatedChangedFiles.length} tests=${contextPack.likelyTestFiles.length} callers=${contextPack.callerHints.length} diffChars=${contextPack.fileDiff.length}${contextPack.fileDiffTruncated ? " truncated" : ""} in ${Date.now() - startedAt}ms`
  );

  return contextPack;
}
