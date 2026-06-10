export type RiskLevel = "low" | "medium" | "high";
export type ReviewBadgeLevel = RiskLevel | "skim";
export type ProviderName = "mock" | "claude-code" | "copilot-cli";
export type PreApprovalRecommendation = "approve" | "comment" | "request_changes";

export interface PullRequestIdentity {
  host: string;
  owner: string;
  repo: string;
  prNumber: number;
  baseBranchHint?: string;
}

export interface RepoBindingKey {
  host: string;
  owner: string;
  repo: string;
}

export interface RepoBinding extends RepoBindingKey {
  localPath: string;
  remoteUrl: string;
}

export interface RepoBindingLookupResponse {
  found: boolean;
  localPath?: string;
  remoteUrl?: string;
  suggestions?: string[];
}

export interface BindRepoRequest extends RepoBindingKey {
  localPath: string;
}

export interface BindRepoSuccessResponse {
  ok: true;
  message: string;
}

export interface BindRepoFailureResponse {
  ok: false;
  error: string;
  detectedRemotes?: string[];
  warning?: string;
}

export type BindRepoResponse = BindRepoSuccessResponse | BindRepoFailureResponse;

export interface PreparePrWorktreeRequest extends PullRequestIdentity {}

export interface PreparePrWorktreeResponse {
  ok: true;
  mainRepoPath: string;
  worktreePath: string;
  baseRef: string;
  headRef: string;
  prRef: string;
}

export interface ChangedFileSummary {
  file: string;
  additions: number;
  deletions: number;
  risk: RiskLevel;
  reason: string;
  signals?: string[];
}

export interface ReviewOrderItem {
  file: string;
  risk: RiskLevel;
  reason: string;
  suggestedAction: string;
}

export interface PrUnderstanding {
  purpose: string;
  affectedSystems: string[];
  potentialRisks: string[];
  keyBehaviorChanges: string[];
}

export interface ReviewPlanStep {
  title: string;
  reason: string;
  files: string[];
  suggestedFocus: string;
}

export interface ImpactChain {
  title: string;
  nodes: string[];
  explanation: string;
  risk: RiskLevel;
}

export interface ReviewWorry {
  title: string;
  reason: string;
  files: string[];
  suggestedCheck: string;
  risk: RiskLevel;
}

export interface AnalysePrResponse {
  summary: string;
  prUnderstanding: PrUnderstanding;
  reviewPlan: ReviewPlanStep[];
  reviewOrder: ReviewOrderItem[];
  skimFiles: string[];
  suggestedChecks: string[];
  changedFiles: ChangedFileSummary[];
  impactChains: ImpactChain[];
  worries: ReviewWorry[];
}

export interface AnalysePrPlanRequest extends PullRequestIdentity {}

export interface AnalysePrPlanResponse {
  reviewPlan: ReviewPlanStep[];
}

export interface AnalysePrHeatmapRequest extends PullRequestIdentity {}

export interface AnalysePrHeatmapResponse {
  reviewOrder: ReviewOrderItem[];
  skimFiles: string[];
  suggestedChecks: string[];
  changedFiles: ChangedFileSummary[];
}

export interface AnalysePrTraceRequest extends PullRequestIdentity {}

export interface AnalysePrTraceResponse {
  impactChains: ImpactChain[];
}

export interface AnalysePrWorriesRequest extends PullRequestIdentity {}

export interface AnalysePrWorriesResponse {
  worries: ReviewWorry[];
}

export interface ExplainFileRequest extends PullRequestIdentity {
  file: string;
}

export interface ExplainFileResponse {
  file: string;
  explanation: string;
  thingsToCheck: string[];
  possibleCallers: string[];
  suggestedTests: string[];
}

export interface AnalyseFileRequest extends PullRequestIdentity {
  file: string;
}

export interface AnalyseFileResponse {
  file: string;
  summary: string[];
  prContext: string;
  risks: string[];
  reviewChecks: string[];
  suggestedTests: string[];
  suggestedComment?: string;
}

export interface AskFileQuestionRequest extends PullRequestIdentity {
  file: string;
  question: string;
  selectedText?: string;
}

export interface AskFileQuestionResponse {
  file: string;
  answer: string[];
  suggestedComment?: string;
  confidence: "low" | "medium" | "high";
}

export interface SuggestTestsRequest extends PullRequestIdentity {
  file: string;
}

export interface SuggestTestsResponse {
  suggestedTests: string[];
  commands: string[];
}

export interface PreApprovalCheckRequest extends PullRequestIdentity {
  reviewedFiles: string[];
}

export interface RemainingRisk {
  file: string;
  risk: RiskLevel;
  reason: string;
}

export interface PreApprovalCheckResponse {
  remainingRisks: RemainingRisk[];
  recommendation: PreApprovalRecommendation;
  summary: string;
}

export interface CleanupWorktreesRequest {
  olderThanDays: number;
}

export interface CleanupWorktreesResponse {
  ok: true;
  removed: string[];
}

export interface HealthResponse {
  ok: true;
  service: "review-guide-bridge";
  version: string;
  provider: ProviderName;
}

export interface ProviderSettingsResponse {
  provider: ProviderName;
  providers: ProviderName[];
}

export interface UpdateProviderRequest {
  provider: ProviderName;
}

export interface ProviderExecutionInput extends PullRequestIdentity {
  worktreePath: string;
  baseRef: string;
  headRef: string;
}

export interface FileContextPack {
  file: string;
  changedFiles: string[];
  relatedChangedFiles: string[];
  likelyTestFiles: string[];
  packageScripts: string[];
  diffStat: string;
  fileDiff: string;
  fileDiffTruncated: boolean;
  importHints: string[];
  callerHints: string[];
}

export interface PrContextChangedFile {
  file: string;
  additions: number;
  deletions: number;
  heuristicRisk: RiskLevel;
  riskReason: string;
  riskSignals: string[];
  skimCandidate: boolean;
}

export interface PrContextFileDiff {
  file: string;
  diff: string;
  truncated: boolean;
}

export interface PrContextDirectorySummary {
  directory: string;
  files: number;
  additions: number;
  deletions: number;
}

export interface PrContextPack {
  changedFileCount: number;
  changedFiles: PrContextChangedFile[];
  topRiskFiles: PrContextChangedFile[];
  sampledFileDiffs: PrContextFileDiff[];
  skimCandidates: string[];
  likelyTestFiles: string[];
  packageScripts: string[];
  directorySummary: PrContextDirectorySummary[];
  diffStat: string;
  diffStatTruncated: boolean;
  notes: string[];
}

export interface AnalysePrProviderInput extends ProviderExecutionInput {
  contextPack?: PrContextPack;
}

export interface AnalysePrPlanProviderInput extends AnalysePrProviderInput {}

export interface AnalysePrHeatmapProviderInput extends AnalysePrProviderInput {}

export interface AnalysePrTraceProviderInput extends AnalysePrProviderInput {}

export interface AnalysePrWorriesProviderInput extends AnalysePrProviderInput {}

export interface ExplainFileProviderInput extends ProviderExecutionInput {
  file: string;
  contextPack?: FileContextPack;
}

export interface AnalyseFileProviderInput extends ProviderExecutionInput {
  file: string;
  contextPack?: FileContextPack;
}

export interface AskFileQuestionProviderInput extends ProviderExecutionInput {
  file: string;
  question: string;
  selectedText?: string;
  contextPack?: FileContextPack;
}

export interface SuggestTestsProviderInput extends ProviderExecutionInput {
  file: string;
  contextPack?: FileContextPack;
}

export interface PreApprovalProviderInput extends ProviderExecutionInput {
  reviewedFiles: string[];
}
