import fs from "node:fs/promises";
import path from "node:path";
import type { FileContextPack, PrContextChangedFile, PrContextPack, RiskLevel } from "@review-guide/shared";
import { parseNumstatOutput, runCommand } from "./git.js";

const MAX_FILE_DIFF_CHARS = 12_000;
const MAX_PR_FILE_DIFF_CHARS = 4_000;
const MAX_DIFF_STAT_CHARS = 4_000;
const MAX_CHANGED_FILES = 80;
const MAX_PR_CHANGED_FILES = 120;
const MAX_RELATED_FILES = 12;
const MAX_TEST_FILES = 12;
const MAX_PACKAGE_SCRIPTS = 12;
const MAX_IMPORT_HINTS = 12;
const MAX_CALLER_HINTS = 10;
const MAX_PR_RISK_FILES = 8;
const MAX_PR_SAMPLED_DIFFS = 3;
const MAX_PR_DIRECTORY_SUMMARY = 12;

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

function isSkimCandidate(value: string): boolean {
  return /(readme|\.md$|\.test\.|\.spec\.|stories\.|fixtures\/|__snapshots__|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)/i.test(
    value
  );
}

function getRiskSignals(file: string, additions: number, deletions: number): string[] {
  const lower = file.toLowerCase();
  const signals = new Set<string>();
  const totalChanges = additions + deletions;

  if (/(auth|security|permission|token|session)/.test(lower)) signals.add("auth");
  if (/(schema|migration|database|sql|model)/.test(lower)) signals.add("schema");
  if (/(config|env|workflow|docker|terraform|helm|package\.json|lock)/.test(lower)) signals.add("config");
  if (/(api|route|controller|client|request|response)/.test(lower)) signals.add("API contract");
  if (/(cache|queue|async|worker|lock|retry)/.test(lower)) signals.add("concurrency");
  if (/(service|domain|balance|loyalty|payment|order|price)/.test(lower)) signals.add("business logic");
  if (/(tsx|jsx|component|dashboard|view|page)/.test(lower)) signals.add("UI");
  if (isLikelyTestFile(lower)) signals.add("tests");
  if (/(error|exception|fallback|retry)/.test(lower)) signals.add("error handling");
  if (totalChanges >= 200) signals.add("large diff");

  return signals.size > 0 ? [...signals] : ["scoped code change"];
}

function getHeuristicRisk(
  file: string,
  additions: number,
  deletions: number
): Pick<PrContextChangedFile, "heuristicRisk" | "riskReason" | "riskSignals" | "skimCandidate"> {
  const lower = file.toLowerCase();
  const totalChanges = additions + deletions;
  const riskSignals = getRiskSignals(file, additions, deletions);
  const skimCandidate = isSkimCandidate(file);

  if (/(auth|security|schema|migration|config|workflow|package\.json|lock|docker|terraform|helm|env)/.test(lower)) {
    return {
      heuristicRisk: "high",
      riskReason: "Filename or path suggests auth, schema, config, dependency, or deployment impact.",
      riskSignals,
      skimCandidate
    };
  }

  if (totalChanges >= 200 || /(api|service|controller|store|reducer|database|cache|repository)/.test(lower)) {
    return {
      heuristicRisk: "medium",
      riskReason: "File has shared runtime surface area or a larger diff.",
      riskSignals,
      skimCandidate
    };
  }

  return {
    heuristicRisk: skimCandidate ? "low" : "low",
    riskReason: skimCandidate
      ? "File looks safe to skim unless it contradicts PR intent."
      : "File looks scoped by filename and diff size heuristics.",
    riskSignals,
    skimCandidate
  };
}

function riskRank(risk: RiskLevel): number {
  return risk === "high" ? 3 : risk === "medium" ? 2 : 1;
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

function findPrLikelyTestFiles(
  changedFiles: PrContextChangedFile[],
  allFiles: string[]
): string[] {
  const changedFileNames = changedFiles.map((file) => file.file);
  const changedTests = changedFileNames.filter(isLikelyTestFile);
  const topRuntimeFiles = changedFiles
    .filter((file) => !file.skimCandidate)
    .sort(
      (left, right) =>
        riskRank(right.heuristicRisk) - riskRank(left.heuristicRisk) ||
        right.additions + right.deletions - (left.additions + left.deletions)
    )
    .slice(0, 5);

  return unique([
    ...changedTests,
    ...topRuntimeFiles.flatMap((file) => findLikelyTestFiles(file.file, allFiles, changedFileNames))
  ]).slice(0, MAX_TEST_FILES);
}

function buildDirectorySummary(changedFiles: PrContextChangedFile[]): PrContextPack["directorySummary"] {
  const byDirectory = new Map<string, { files: number; additions: number; deletions: number }>();

  for (const file of changedFiles) {
    const directory = dirname(file.file) || "root";
    const current = byDirectory.get(directory) ?? { files: 0, additions: 0, deletions: 0 };
    byDirectory.set(directory, {
      files: current.files + 1,
      additions: current.additions + file.additions,
      deletions: current.deletions + file.deletions
    });
  }

  return [...byDirectory.entries()]
    .map(([directory, summary]) => ({ directory, ...summary }))
    .sort((left, right) => right.additions + right.deletions - (left.additions + left.deletions))
    .slice(0, MAX_PR_DIRECTORY_SUMMARY);
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

export async function buildPrContextPack(input: Omit<BuildFileContextPackInput, "file">): Promise<PrContextPack> {
  const startedAt = Date.now();
  const [numstatRaw, changedFilesRaw, diffStatRaw, allFilesRaw, packageScripts] = await Promise.all([
    runOptionalCommand("git", ["diff", "--numstat", `${input.baseRef}...HEAD`], input.worktreePath),
    runOptionalCommand("git", ["diff", "--name-only", `${input.baseRef}...HEAD`], input.worktreePath),
    runOptionalCommand("git", ["diff", "--stat", `${input.baseRef}...HEAD`], input.worktreePath),
    runOptionalCommand("git", ["ls-files"], input.worktreePath),
    readPackageScripts(input.worktreePath)
  ]);

  const changedFileOrder = changedFilesRaw.split("\n").filter(Boolean);
  const numstatByFile = new Map(parseNumstatOutput(numstatRaw).map((entry) => [entry.file, entry]));
  const changedFiles = changedFileOrder.slice(0, MAX_PR_CHANGED_FILES).map((file) => {
    const numstat = numstatByFile.get(file);
    const additions = numstat?.additions ?? 0;
    const deletions = numstat?.deletions ?? 0;
    return {
      file,
      additions,
      deletions,
      ...getHeuristicRisk(file, additions, deletions)
    };
  });

  const topRiskFiles = [...changedFiles]
    .sort(
      (left, right) =>
        riskRank(right.heuristicRisk) - riskRank(left.heuristicRisk) ||
        right.additions + right.deletions - (left.additions + left.deletions)
    )
    .slice(0, MAX_PR_RISK_FILES);
  const sampledFiles = topRiskFiles.filter((file) => !file.skimCandidate).slice(0, MAX_PR_SAMPLED_DIFFS);
  const sampledFileDiffs = await Promise.all(
    sampledFiles.map(async (file) => {
      const raw = await runOptionalCommand("git", ["diff", `${input.baseRef}...HEAD`, "--", file.file], input.worktreePath);
      const truncated = truncate(raw, MAX_PR_FILE_DIFF_CHARS);
      return {
        file: file.file,
        diff: truncated.text,
        truncated: truncated.truncated
      };
    })
  );
  const diffStat = truncate(diffStatRaw, MAX_DIFF_STAT_CHARS);
  const allFiles = allFilesRaw.split("\n").filter(Boolean);
  const contextPack: PrContextPack = {
    changedFileCount: changedFileOrder.length,
    changedFiles,
    topRiskFiles,
    sampledFileDiffs,
    skimCandidates: changedFiles.filter((file) => file.skimCandidate).map((file) => file.file).slice(0, MAX_TEST_FILES),
    likelyTestFiles: findPrLikelyTestFiles(changedFiles, allFiles),
    packageScripts,
    directorySummary: buildDirectorySummary(changedFiles),
    diffStat: diffStat.text,
    diffStatTruncated: diffStat.truncated,
    notes: [
      "This pack is a bounded starting map, not a complete review.",
      "Heuristic risk comes from filenames, diff size, and cheap metadata only.",
      "The provider should inspect additional diffs or files when high-risk or unclear areas need confirmation."
    ]
  };

  const sampledDiffChars = contextPack.sampledFileDiffs.reduce((total, file) => total + file.diff.length, 0);
  console.log(
    `[bridge:context] built PR context pack: changed=${contextPack.changedFileCount} included=${contextPack.changedFiles.length} risky=${contextPack.topRiskFiles.length} sampledDiffs=${contextPack.sampledFileDiffs.length} sampledDiffChars=${sampledDiffChars} in ${Date.now() - startedAt}ms`
  );

  return contextPack;
}
