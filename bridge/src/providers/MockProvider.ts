import path from "node:path";
import type {
  AnalyseFileProviderInput,
  AnalyseFileResponse,
  AnalysePrProviderInput,
  AnalysePrResponse,
  AnalysePrStreamEmit,
  AnalysePrHeatmapProviderInput,
  AnalysePrHeatmapResponse,
  AnalysePrPlanProviderInput,
  AnalysePrPlanResponse,
  AnalysePrTraceProviderInput,
  AnalysePrTraceResponse,
  AnalysePrWorriesProviderInput,
  AnalysePrWorriesResponse,
  AskFileQuestionProviderInput,
  AskFileQuestionResponse,
  ExplainFileProviderInput,
  ExplainFileResponse,
  PreApprovalCheckResponse,
  PreApprovalProviderInput,
  RiskLevel,
  SuggestTestsProviderInput,
  SuggestTestsResponse
} from "@review-guide/shared";
import { runCommand, parseNumstatOutput } from "../git.js";
import type { ReviewAgentProvider } from "./ReviewAgentProvider.js";

const riskScore: Record<RiskLevel, number> = { high: 3, medium: 2, low: 1 };

function getRiskForFile(file: string, additions: number, deletions: number): { risk: RiskLevel; reason: string } {
  const lower = file.toLowerCase();
  const totalChanges = additions + deletions;

  if (/(auth|security|schema|migration|config|workflow|package\.json|lock|docker|terraform|helm|env)/.test(lower)) {
    return {
      risk: "high",
      reason: "Touches config, auth, schema, or deployment-sensitive code that can affect behavior beyond a single file."
    };
  }

  if (totalChanges >= 200 || /(api|service|controller|store|reducer|database)/.test(lower)) {
    return {
      risk: "medium",
      reason: "This file has enough surface area or shared runtime impact that it deserves a closer pass."
    };
  }

  return {
    risk: "low",
    reason: "This change looks scoped and is unlikely to affect many execution paths by itself."
  };
}

function getSignalsForFile(file: string, additions: number, deletions: number): string[] {
  const lower = file.toLowerCase();
  const signals = new Set<string>();
  const totalChanges = additions + deletions;

  if (/(auth|security|permission|token|session)/.test(lower)) {
    signals.add("auth");
  }
  if (/(schema|migration|database|sql|model)/.test(lower)) {
    signals.add("schema");
  }
  if (/(config|env|workflow|docker|terraform|helm|package\.json|lock)/.test(lower)) {
    signals.add("config");
  }
  if (/(api|route|controller|client|request|response)/.test(lower)) {
    signals.add("API contract");
  }
  if (/(cache|queue|async|worker|lock|retry)/.test(lower)) {
    signals.add("concurrency");
  }
  if (/(service|domain|balance|loyalty|payment|order|price)/.test(lower)) {
    signals.add("business logic");
  }
  if (/(tsx|jsx|component|dashboard|view|page)/.test(lower)) {
    signals.add("UI");
  }
  if (/(\.test\.|\.spec\.|fixture|mock|snapshot)/.test(lower)) {
    signals.add("tests");
  }
  if (/(error|exception|fallback|retry)/.test(lower)) {
    signals.add("error handling");
  }
  if (totalChanges >= 200) {
    signals.add("large diff");
  }

  return signals.size > 0 ? [...signals] : ["scoped code change"];
}

function isSkimFile(file: string): boolean {
  return /(readme|\.md$|\.test\.|\.spec\.|stories\.|fixtures\/|__snapshots__|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)/i.test(
    file
  );
}

function buildSuggestedChecks(files: string[]): string[] {
  const checks = new Set<string>();

  if (files.some((file) => /(package\.json|lock|pnpm|yarn)/i.test(file))) {
    checks.add("Reinstall dependencies and confirm the lockfile matches the intended package changes.");
  }
  if (files.some((file) => /(schema|migration|database|sql)/i.test(file))) {
    checks.add("Verify schema or migration changes are backward compatible and exercised in a representative environment.");
  }
  if (files.some((file) => /(config|env|workflow|docker|terraform|helm)/i.test(file))) {
    checks.add("Confirm environment, deployment, or CI configuration changes were validated outside the happy path.");
  }
  if (files.some((file) => /(api|route|controller)/i.test(file))) {
    checks.add("Check API contract changes, error handling, and any downstream consumers impacted by the new behavior.");
  }

  checks.add("Compare the highest-risk files first, then confirm relevant tests cover the changed behavior.");
  return [...checks];
}

async function getChangedFiles(baseRef: string, worktreePath: string) {
  const numstat = await runCommand("git", ["diff", "--numstat", `${baseRef}...HEAD`], {
    cwd: worktreePath
  });

  return parseNumstatOutput(numstat.stdout).map((entry) => ({
    ...entry,
    ...getRiskForFile(entry.file, entry.additions, entry.deletions),
    signals: getSignalsForFile(entry.file, entry.additions, entry.deletions)
  }));
}

function inferAffectedSystems(files: string[]): string[] {
  const systems = new Set<string>();

  for (const file of files) {
    const lower = file.toLowerCase();
    if (/(api|route|controller|client)/.test(lower)) {
      systems.add("API layer");
    }
    if (/(cache|store|repository|database|schema|migration)/.test(lower)) {
      systems.add("Data/cache layer");
    }
    if (/(service|domain|balance|loyalty|payment|order|price)/.test(lower)) {
      systems.add("Business logic");
    }
    if (/(tsx|jsx|component|dashboard|view|page)/.test(lower)) {
      systems.add("User interface");
    }
    if (/(config|env|workflow|docker|terraform|helm|package\.json|lock)/.test(lower)) {
      systems.add("Build, config, or deployment");
    }
    if (/(\.test\.|\.spec\.|fixture|mock|snapshot)/.test(lower)) {
      systems.add("Test coverage");
    }
  }

  return systems.size > 0 ? [...systems] : ["Changed project files"];
}

function buildPrUnderstanding(changedFiles: Awaited<ReturnType<typeof getChangedFiles>>): AnalysePrResponse["prUnderstanding"] {
  const files = changedFiles.map((file) => file.file);
  const highestRisk = [...changedFiles].sort((left, right) => riskScore[right.risk] - riskScore[left.risk])[0];

  return {
    purpose:
      highestRisk && highestRisk.risk !== "low"
        ? `This PR changes ${files.length} file(s), with the highest review attention on ${highestRisk.file}.`
        : `This PR makes a scoped change across ${files.length} file(s).`,
    affectedSystems: inferAffectedSystems(files),
    potentialRisks:
      changedFiles.length > 0
        ? [...new Set(changedFiles.flatMap((file) => file.signals).slice(0, 6))].map(
            (signal) => `Review ${signal} implications in the changed files.`
          )
        : ["No changed files were detected by git diff metadata."],
    keyBehaviorChanges: changedFiles.slice(0, 5).map((file) => `${file.file}: ${file.additions} additions, ${file.deletions} deletions.`)
  };
}

function buildReviewPlan(reviewOrder: AnalysePrResponse["reviewOrder"]): AnalysePrResponse["reviewPlan"] {
  if (reviewOrder.length === 0) {
    return [
      {
        title: "Confirm the diff is empty or metadata-only",
        reason: "The mock provider did not find changed files from git diff metadata.",
        files: [],
        suggestedFocus: "Check the PR branch and base ref are correct."
      }
    ];
  }

  return reviewOrder.slice(0, 6).map((item, index) => ({
    title: `${index + 1}. Review ${path.basename(item.file)}`,
    reason: item.reason,
    files: [item.file],
    suggestedFocus: item.suggestedAction
  }));
}

function buildReviewOrder(changedFiles: Awaited<ReturnType<typeof getChangedFiles>>): AnalysePrResponse["reviewOrder"] {
  return [...changedFiles]
    .sort((left, right) => {
      return (
        riskScore[right.risk] - riskScore[left.risk] ||
        right.additions +
          right.deletions -
          (left.additions + left.deletions)
      );
    })
    .map((file) => ({
      file: file.file,
      risk: file.risk,
      reason: file.reason,
      suggestedAction:
        file.risk === "high"
          ? "Read the full diff and verify downstream impact before skimming supporting files."
          : file.risk === "medium"
            ? "Review the diff with nearby callers or tests open."
            : "Skim the diff after the higher-risk files are understood."
    }));
}

function buildHeatmap(changedFiles: Awaited<ReturnType<typeof getChangedFiles>>): AnalysePrHeatmapResponse {
  return {
    reviewOrder: buildReviewOrder(changedFiles),
    skimFiles: changedFiles.filter((file) => isSkimFile(file.file)).map((file) => file.file),
    suggestedChecks: buildSuggestedChecks(changedFiles.map((file) => file.file)),
    changedFiles: changedFiles.map(({ file, additions, deletions, risk, reason, signals }) => ({
      file,
      additions,
      deletions,
      risk,
      reason,
      signals
    }))
  };
}

function buildImpactChains(changedFiles: Awaited<ReturnType<typeof getChangedFiles>>): AnalysePrResponse["impactChains"] {
  const runtimeFiles = changedFiles.filter((file) => !isSkimFile(file.file));
  const chainFiles = (runtimeFiles.length > 0 ? runtimeFiles : changedFiles)
    .sort((left, right) => riskScore[right.risk] - riskScore[left.risk])
    .slice(0, 4);

  if (chainFiles.length === 0) {
    return [];
  }

  return [
    {
      title: "Likely changed-file impact path",
      nodes: chainFiles.map((file) => file.file),
      explanation:
        "The mock provider builds this chain from changed-file risk order only. A real provider will inspect local code to infer deeper dependency flow.",
      risk: chainFiles[0].risk
    }
  ];
}

function buildWorries(changedFiles: Awaited<ReturnType<typeof getChangedFiles>>): AnalysePrResponse["worries"] {
  const riskyFiles = changedFiles.filter((file) => file.risk !== "low").slice(0, 5);

  if (riskyFiles.length === 0) {
    return [
      {
        title: "Regression coverage",
        reason: "Even scoped changes can regress expected behavior if no focused test covers the changed path.",
        files: changedFiles.slice(0, 3).map((file) => file.file),
        suggestedCheck: "Confirm at least one relevant automated or manual check covers the changed behavior.",
        risk: "low"
      }
    ];
  }

  return riskyFiles.map((file) => ({
    title: `Verify ${path.basename(file.file)}`,
    reason: file.reason,
    files: [file.file],
    suggestedCheck: `Check the ${file.signals.join(", ")} implications and confirm relevant tests or smoke checks exist.`,
    risk: file.risk
  }));
}

async function getPossibleCallers(file: string, worktreePath: string): Promise<string[]> {
  const baseName = path.parse(file).name;
  const grep = await runCommand("git", ["grep", "-n", baseName, "--", "."], {
    cwd: worktreePath,
    allowNonZeroExit: true
  });

  const callers = grep.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(":").slice(0, 2).join(":"))
    .filter((line) => !line.startsWith(`${file}:`))
    .slice(0, 5);

  return callers;
}

async function getFileDiffSummary(baseRef: string, worktreePath: string, file: string): Promise<string[]> {
  const diff = await runCommand("git", ["diff", `${baseRef}...HEAD`, "--", file], {
    cwd: worktreePath,
    allowNonZeroExit: true
  });
  const addedLines = diff.stdout.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const removedLines = diff.stdout.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  const summary = [`Changed ${file} with ${addedLines} added line(s) and ${removedLines} removed line(s).`];

  if (addedLines > removedLines) {
    summary.push("The diff appears to add or expand behavior in this file.");
  } else if (removedLines > addedLines) {
    summary.push("The diff appears to remove or simplify behavior in this file.");
  } else {
    summary.push("The diff changes this file without a strong add/remove skew.");
  }

  return summary;
}

export class MockProvider implements ReviewAgentProvider {
  name = "mock" as const;

  async analysePr(input: AnalysePrProviderInput): Promise<AnalysePrResponse> {
    const changedFiles = await getChangedFiles(input.baseRef, input.worktreePath);
    const filesByRisk = changedFiles.reduce(
      (accumulator, file) => {
        accumulator[file.risk] += 1;
        return accumulator;
      },
      { low: 0, medium: 0, high: 0 }
    );

    return {
      summary: `Mock provider reviewed ${changedFiles.length} changed file(s): ${filesByRisk.high} high-risk, ${filesByRisk.medium} medium-risk, and ${filesByRisk.low} low-risk. Use this as deterministic development guidance until a local coding-agent provider is enabled.`,
      prUnderstanding: buildPrUnderstanding(changedFiles),
      reviewPlan: [],
      reviewOrder: [],
      skimFiles: [],
      suggestedChecks: [],
      changedFiles: [],
      impactChains: [],
      worries: []
    };
  }

  async analysePrStream(input: AnalysePrProviderInput, emit: AnalysePrStreamEmit): Promise<AnalysePrResponse> {
    const result = await this.analysePr(input);
    emit({
      type: "partial",
      field: "summary",
      text: result.summary
    });
    emit({
      type: "partial",
      field: "purpose",
      text: result.prUnderstanding.purpose
    });
    emit({
      type: "partial",
      field: "affectedSystems",
      items: result.prUnderstanding.affectedSystems
    });
    emit({
      type: "partial",
      field: "potentialRisks",
      items: result.prUnderstanding.potentialRisks
    });
    emit({
      type: "partial",
      field: "keyBehaviorChanges",
      items: result.prUnderstanding.keyBehaviorChanges
    });
    return result;
  }

  async analysePrPlan(input: AnalysePrPlanProviderInput): Promise<AnalysePrPlanResponse> {
    const changedFiles = await getChangedFiles(input.baseRef, input.worktreePath);
    return {
      reviewPlan: buildReviewPlan(buildReviewOrder(changedFiles))
    };
  }

  async analysePrHeatmap(input: AnalysePrHeatmapProviderInput): Promise<AnalysePrHeatmapResponse> {
    const changedFiles = await getChangedFiles(input.baseRef, input.worktreePath);
    return buildHeatmap(changedFiles);
  }

  async analysePrTrace(input: AnalysePrTraceProviderInput): Promise<AnalysePrTraceResponse> {
    const changedFiles = await getChangedFiles(input.baseRef, input.worktreePath);
    return {
      impactChains: buildImpactChains(changedFiles)
    };
  }

  async analysePrWorries(input: AnalysePrWorriesProviderInput): Promise<AnalysePrWorriesResponse> {
    const changedFiles = await getChangedFiles(input.baseRef, input.worktreePath);
    return {
      worries: buildWorries(changedFiles)
    };
  }

  async explainFile(input: ExplainFileProviderInput): Promise<ExplainFileResponse> {
    const changedFiles = await getChangedFiles(input.baseRef, input.worktreePath);
    const fileSummary = changedFiles.find((file) => file.file === input.file);
    const callers = await getPossibleCallers(input.file, input.worktreePath);
    const riskSummary = fileSummary ? `${fileSummary.risk}-risk` : "changed";

    return {
      file: input.file,
      explanation: `This ${riskSummary} file changed in PR #${input.prNumber}. The mock provider recommends reviewing the diff in context, then checking nearby callers and tests because this guidance is intentionally deterministic rather than model-generated.`,
      thingsToCheck: [
        "Confirm the diff matches the intended behavior change for this file.",
        "Verify any side effects on callers, configuration, or data flow are covered in the review.",
        "Check whether an adjacent test should change alongside this file."
      ],
      possibleCallers: callers.length > 0 ? callers : ["No obvious callers found from a simple local name search."],
      suggestedTests: [
        `Run focused tests that exercise ${path.basename(input.file)} if the repository already has them.`,
        "Add a targeted regression test for the changed behavior when the file affects shared runtime paths."
      ]
    };
  }

  async analyseFile(input: AnalyseFileProviderInput): Promise<AnalyseFileResponse> {
    const changedFiles = await getChangedFiles(input.baseRef, input.worktreePath);
    const fileSummary = changedFiles.find((file) => file.file === input.file);
    const risk = fileSummary
      ? getRiskForFile(fileSummary.file, fileSummary.additions, fileSummary.deletions)
      : getRiskForFile(input.file, 0, 0);
    const callers = await getPossibleCallers(input.file, input.worktreePath);

    return {
      file: input.file,
      summary: await getFileDiffSummary(input.baseRef, input.worktreePath, input.file),
      prContext: `This file is one of ${changedFiles.length} changed file(s) in PR #${input.prNumber}. The mock provider relates it to the larger change through diff metadata only; a real coding-agent provider will inspect surrounding implementation and intent.`,
      risks: [
        risk.reason,
        "Check whether this file changes a shared path, public contract, deployment behavior, or test expectation."
      ],
      reviewChecks: [
        "Read the file diff against the PR intent.",
        callers.length > 0
          ? `Check likely caller(s): ${callers.slice(0, 3).join(", ")}.`
          : "Check nearby callers or integration points if this is runtime code.",
        "Confirm adjacent or focused tests cover the changed behavior."
      ],
      suggestedTests: [
        `Run or add focused tests that exercise ${path.basename(input.file)}.`,
        "Add a regression test for the changed behavior if this file affects runtime logic."
      ],
      suggestedComment:
        risk.risk === "high"
          ? `Can we confirm the ${input.file} change has been covered by a focused test or smoke check?`
          : undefined
    };
  }

  async askFileQuestion(input: AskFileQuestionProviderInput): Promise<AskFileQuestionResponse> {
    const changedFiles = await getChangedFiles(input.baseRef, input.worktreePath);
    const fileSummary = changedFiles.find((file) => file.file === input.file);
    const risk = fileSummary
      ? getRiskForFile(fileSummary.file, fileSummary.additions, fileSummary.deletions)
      : getRiskForFile(input.file, 0, 0);
    const question = input.question.trim();

    return {
      file: input.file,
      answer: [
        `For "${question}", the mock provider can only use diff metadata for ${input.file}.`,
        risk.reason,
        input.selectedText
          ? "The selected diff text should be checked against nearby code and tests before leaving a review comment."
          : "Use the file analysis and surrounding diff context to decide whether this needs a GitHub comment."
      ],
      suggestedComment:
        risk.risk === "high"
          ? `Can you add a little more context or test coverage for the risk in ${input.file}?`
          : undefined,
      confidence: "medium"
    };
  }

  async suggestTests(input: SuggestTestsProviderInput): Promise<SuggestTestsResponse> {
    const fileName = path.basename(input.file, path.extname(input.file));

    return {
      suggestedTests: [
        `Exercise the main success path touched by ${input.file}.`,
        `Exercise at least one failure or edge case introduced by the ${fileName} changes.`,
        "Confirm any contract, schema, or config changes are covered by a focused test or smoke check."
      ],
      commands: [
        "npm test",
        `git diff --name-only ${input.baseRef}...HEAD -- ${input.file}`
      ]
    };
  }

  async preApprovalCheck(input: PreApprovalProviderInput): Promise<PreApprovalCheckResponse> {
    const heatmap = await this.analysePrHeatmap(input);
    const remainingRisks = heatmap.changedFiles
      .filter((file) => !input.reviewedFiles.includes(file.file))
      .filter((file) => file.risk !== "low")
      .map(({ file, risk, reason }) => ({ file, risk, reason }));

    const recommendation =
      remainingRisks.some((file) => file.risk === "high")
        ? "request_changes"
        : remainingRisks.length > 0
          ? "comment"
          : "approve";

    return {
      remainingRisks,
      recommendation,
      summary:
        recommendation === "approve"
          ? "No high-risk unreviewed files remain according to the mock provider."
          : `There are ${remainingRisks.length} higher-risk file(s) still worth checking before approval.`
    };
  }
}
