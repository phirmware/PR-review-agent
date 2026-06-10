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
  ProviderExecutionInput,
  SuggestTestsProviderInput,
  SuggestTestsResponse
} from "@review-guide/shared";
import type { z } from "zod";
import { AppError } from "../errors.js";
import { runCommand } from "../git.js";
import {
  analysePrResponseSchema,
  analysePrHeatmapResponseSchema,
  analysePrPlanResponseSchema,
  analysePrTraceResponseSchema,
  analysePrWorriesResponseSchema,
  analyseFileResponseSchema,
  askFileQuestionResponseSchema,
  explainFileResponseSchema,
  extractJsonPayload,
  preApprovalCheckResponseSchema,
  suggestTestsResponseSchema
} from "../schemas.js";
import { buildAnalysePrPrompt } from "../prompts/analysePrPrompt.js";
import { buildAnalysePrHeatmapPrompt } from "../prompts/analysePrHeatmapPrompt.js";
import { buildAnalysePrPlanPrompt } from "../prompts/analysePrPlanPrompt.js";
import { buildAnalysePrTracePrompt } from "../prompts/analysePrTracePrompt.js";
import { buildAnalysePrWorriesPrompt } from "../prompts/analysePrWorriesPrompt.js";
import { buildAnalyseFilePrompt } from "../prompts/analyseFilePrompt.js";
import { buildAskFileQuestionPrompt } from "../prompts/askFileQuestionPrompt.js";
import { buildExplainFilePrompt } from "../prompts/explainFilePrompt.js";
import { buildSuggestTestsPrompt } from "../prompts/suggestTestsPrompt.js";
import { buildPreApprovalPrompt } from "../prompts/preApprovalPrompt.js";
import { getProviderSessionId } from "./providerSession.js";
import type { ReviewAgentProvider } from "./ReviewAgentProvider.js";

function getClaudeCommandArgs(prompt: string, sessionId: string | null): string[] {
  const configuredArgs = process.env.REVIEW_GUIDE_CLAUDE_ARGS?.trim();
  const prefixArgs = configuredArgs
    ? configuredArgs.split(/\s+/)
    : [...(sessionId ? ["--session-id", sessionId] : []), "-p"];
  return [...prefixArgs, prompt];
}

async function runClaude(prompt: string, input: ProviderExecutionInput): Promise<string> {
  // This provider can send repository context to an external service depending on the user's Claude Code setup.
  const command = process.env.REVIEW_GUIDE_CLAUDE_COMMAND ?? "claude";
  const sessionId = await getProviderSessionId("claude-code", input);
  console.log(
    `[bridge:provider] invoking claude-code in ${input.worktreePath}${sessionId ? ` with session id ${sessionId}` : " without session id"}`
  );
  const result = await runCommand(command, getClaudeCommandArgs(prompt, sessionId), {
    cwd: input.worktreePath,
    timeoutMs: 120_000
  });

  if (!result.stdout) {
    throw new AppError("Claude Code did not return any output.", 500);
  }

  return result.stdout;
}

function parseClaudeJson<T>(raw: string, schema: z.ZodType<T>, task: string): T {
  try {
    return schema.parse(JSON.parse(extractJsonPayload(raw)));
  } catch (error) {
    throw new AppError(`Claude Code returned malformed JSON for ${task}.`, 502, {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

export class ClaudeCodeProvider implements ReviewAgentProvider {
  name = "claude-code" as const;

  async analysePr(input: AnalysePrProviderInput): Promise<AnalysePrResponse> {
    const raw = await runClaude(buildAnalysePrPrompt(input), input);
    return parseClaudeJson(raw, analysePrResponseSchema, "analyse-pr");
  }

  async analysePrPlan(input: AnalysePrPlanProviderInput): Promise<AnalysePrPlanResponse> {
    const raw = await runClaude(buildAnalysePrPlanPrompt(input), input);
    return parseClaudeJson(raw, analysePrPlanResponseSchema, "analyse-pr-plan");
  }

  async analysePrHeatmap(input: AnalysePrHeatmapProviderInput): Promise<AnalysePrHeatmapResponse> {
    const raw = await runClaude(buildAnalysePrHeatmapPrompt(input), input);
    return parseClaudeJson(raw, analysePrHeatmapResponseSchema, "analyse-pr-heatmap");
  }

  async analysePrTrace(input: AnalysePrTraceProviderInput): Promise<AnalysePrTraceResponse> {
    const raw = await runClaude(buildAnalysePrTracePrompt(input), input);
    return parseClaudeJson(raw, analysePrTraceResponseSchema, "analyse-pr-trace");
  }

  async analysePrWorries(input: AnalysePrWorriesProviderInput): Promise<AnalysePrWorriesResponse> {
    const raw = await runClaude(buildAnalysePrWorriesPrompt(input), input);
    return parseClaudeJson(raw, analysePrWorriesResponseSchema, "analyse-pr-worries");
  }

  async analyseFile(input: AnalyseFileProviderInput): Promise<AnalyseFileResponse> {
    const raw = await runClaude(buildAnalyseFilePrompt(input), input);
    return parseClaudeJson(raw, analyseFileResponseSchema, "analyse-file");
  }

  async askFileQuestion(input: AskFileQuestionProviderInput): Promise<AskFileQuestionResponse> {
    const raw = await runClaude(buildAskFileQuestionPrompt(input), input);
    return parseClaudeJson(raw, askFileQuestionResponseSchema, "ask-file-question");
  }

  async explainFile(input: ExplainFileProviderInput): Promise<ExplainFileResponse> {
    const raw = await runClaude(buildExplainFilePrompt(input), input);
    return parseClaudeJson(raw, explainFileResponseSchema, "explain-file");
  }

  async suggestTests(input: SuggestTestsProviderInput): Promise<SuggestTestsResponse> {
    const raw = await runClaude(buildSuggestTestsPrompt(input), input);
    return parseClaudeJson(raw, suggestTestsResponseSchema, "suggest-tests");
  }

  async preApprovalCheck(input: PreApprovalProviderInput): Promise<PreApprovalCheckResponse> {
    const raw = await runClaude(buildPreApprovalPrompt(input), input);
    return parseClaudeJson(raw, preApprovalCheckResponseSchema, "pre-approval-check");
  }
}
