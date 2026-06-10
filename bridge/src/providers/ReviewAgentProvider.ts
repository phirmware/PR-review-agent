import type {
  AnalyseFileProviderInput,
  AnalyseFileResponse,
  AnalysePrProviderInput,
  AnalysePrResponse,
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
  analysePrTrace(input: AnalysePrTraceProviderInput): Promise<AnalysePrTraceResponse>;
  analysePrWorries(input: AnalysePrWorriesProviderInput): Promise<AnalysePrWorriesResponse>;
  analyseFile(input: AnalyseFileProviderInput): Promise<AnalyseFileResponse>;
  askFileQuestion(input: AskFileQuestionProviderInput): Promise<AskFileQuestionResponse>;
  explainFile(input: ExplainFileProviderInput): Promise<ExplainFileResponse>;
  suggestTests(input: SuggestTestsProviderInput): Promise<SuggestTestsResponse>;
  preApprovalCheck(input: PreApprovalProviderInput): Promise<PreApprovalCheckResponse>;
}
