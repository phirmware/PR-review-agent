import type {
  AnalyseFileProviderInput,
  AnalyseFileResponse,
  AnalysePrProviderInput,
  AnalysePrResponse,
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
  ProviderName,
  SuggestTestsProviderInput,
  SuggestTestsResponse
} from "@review-guide/shared";

export interface ReviewAgentProvider {
  name: ProviderName;
  analysePr(input: AnalysePrProviderInput): Promise<AnalysePrResponse>;
  analysePrPlan(input: AnalysePrPlanProviderInput): Promise<AnalysePrPlanResponse>;
  analysePrHeatmap(input: AnalysePrHeatmapProviderInput): Promise<AnalysePrHeatmapResponse>;
  analysePrTrace(input: AnalysePrTraceProviderInput): Promise<AnalysePrTraceResponse>;
  analysePrWorries(input: AnalysePrWorriesProviderInput): Promise<AnalysePrWorriesResponse>;
  analyseFile(input: AnalyseFileProviderInput): Promise<AnalyseFileResponse>;
  askFileQuestion(input: AskFileQuestionProviderInput): Promise<AskFileQuestionResponse>;
  explainFile(input: ExplainFileProviderInput): Promise<ExplainFileResponse>;
  suggestTests(input: SuggestTestsProviderInput): Promise<SuggestTestsResponse>;
  preApprovalCheck(input: PreApprovalProviderInput): Promise<PreApprovalCheckResponse>;
}
