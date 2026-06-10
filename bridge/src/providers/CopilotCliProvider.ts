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
import { buildAnalyseFilePrompt } from "../prompts/analyseFilePrompt.js";
import { buildAnalysePrHeatmapPrompt } from "../prompts/analysePrHeatmapPrompt.js";
import { buildAnalysePrPlanPrompt } from "../prompts/analysePrPlanPrompt.js";
import { buildAnalysePrPrompt } from "../prompts/analysePrPrompt.js";
import { buildAnalysePrTracePrompt } from "../prompts/analysePrTracePrompt.js";
import { buildAnalysePrWorriesPrompt } from "../prompts/analysePrWorriesPrompt.js";
import { buildAskFileQuestionPrompt } from "../prompts/askFileQuestionPrompt.js";
import { buildExplainFilePrompt } from "../prompts/explainFilePrompt.js";
import { buildPreApprovalPrompt } from "../prompts/preApprovalPrompt.js";
import { buildSuggestTestsPrompt } from "../prompts/suggestTestsPrompt.js";
import {
  analyseFileResponseSchema,
  analysePrHeatmapResponseSchema,
  analysePrPlanResponseSchema,
  analysePrResponseSchema,
  analysePrTraceResponseSchema,
  analysePrWorriesResponseSchema,
  askFileQuestionResponseSchema,
  explainFileResponseSchema,
  extractJsonPayload,
  preApprovalCheckResponseSchema,
  suggestTestsResponseSchema
} from "../schemas.js";
import { getProviderSessionId } from "./providerSession.js";
import type { ReviewAgentProvider } from "./ReviewAgentProvider.js";

function getCopilotCommandArgs(prompt: string, sessionId: string | null): string[] {
  const configuredArgs = process.env.REVIEW_GUIDE_COPILOT_ARGS?.trim();
  if (configuredArgs) {
    const args = configuredArgs.split(/\s+/);
    return args.some((arg) => arg.includes("{prompt}"))
      ? args.map((arg) => arg.replaceAll("{prompt}", prompt))
      : [...args, prompt];
  }

  return [
    "--silent",
    "--no-color",
    ...(sessionId ? ["--session-id", sessionId] : []),
    "-p",
    prompt,
    "--allow-tool",
    "shell(git)",
    "--allow-tool",
    "shell(rg)"
  ];
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

async function runCopilot(prompt: string, input: ProviderExecutionInput): Promise<string> {
  // This provider can send repository context to GitHub Copilot depending on the user's local Copilot CLI setup.
  const command = process.env.REVIEW_GUIDE_COPILOT_COMMAND ?? "copilot";
  const sessionId = await getProviderSessionId("copilot-cli", input);
  console.log(
    `[bridge:provider] invoking copilot-cli in ${input.worktreePath}${sessionId ? ` with session id ${sessionId}` : " without session id"}`
  );

  try {
    const result = await runCommand(command, getCopilotCommandArgs(prompt, sessionId), {
      cwd: input.worktreePath,
      timeoutMs: 180_000
    });

    if (!result.stdout) {
      throw new AppError("Copilot CLI did not return any output.", 500);
    }

    return stripAnsi(result.stdout);
  } catch (error) {
    if (error instanceof AppError && /Copilot CLI not installed|Required command is unavailable: copilot/i.test(error.message)) {
      throw new AppError(
        "Copilot CLI is unavailable. Install the `copilot` command or set REVIEW_GUIDE_COPILOT_COMMAND to its absolute path.",
        500,
        error.details
      );
    }

    throw error;
  }
}

function parseCopilotJson<T>(raw: string, schema: z.ZodType<T>, task: string): T {
  try {
    return schema.parse(JSON.parse(extractJsonPayload(stripAnsi(raw))));
  } catch (error) {
    throw new AppError(`Copilot CLI returned malformed JSON for ${task}.`, 502, {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

export class CopilotCliProvider implements ReviewAgentProvider {
  name = "copilot-cli" as const;

  async analysePr(input: AnalysePrProviderInput): Promise<AnalysePrResponse> {
    const raw = await runCopilot(buildAnalysePrPrompt(input), input);
    return parseCopilotJson(raw, analysePrResponseSchema, "analyse-pr");
  }

  async analysePrPlan(input: AnalysePrPlanProviderInput): Promise<AnalysePrPlanResponse> {
    const raw = await runCopilot(buildAnalysePrPlanPrompt(input), input);
    return parseCopilotJson(raw, analysePrPlanResponseSchema, "analyse-pr-plan");
  }

  async analysePrHeatmap(input: AnalysePrHeatmapProviderInput): Promise<AnalysePrHeatmapResponse> {
    const raw = await runCopilot(buildAnalysePrHeatmapPrompt(input), input);
    return parseCopilotJson(raw, analysePrHeatmapResponseSchema, "analyse-pr-heatmap");
  }

  async analysePrTrace(input: AnalysePrTraceProviderInput): Promise<AnalysePrTraceResponse> {
    const raw = await runCopilot(buildAnalysePrTracePrompt(input), input);
    return parseCopilotJson(raw, analysePrTraceResponseSchema, "analyse-pr-trace");
  }

  async analysePrWorries(input: AnalysePrWorriesProviderInput): Promise<AnalysePrWorriesResponse> {
    const raw = await runCopilot(buildAnalysePrWorriesPrompt(input), input);
    return parseCopilotJson(raw, analysePrWorriesResponseSchema, "analyse-pr-worries");
  }

  async analyseFile(input: AnalyseFileProviderInput): Promise<AnalyseFileResponse> {
    const raw = await runCopilot(buildAnalyseFilePrompt(input), input);
    return parseCopilotJson(raw, analyseFileResponseSchema, "analyse-file");
  }

  async askFileQuestion(input: AskFileQuestionProviderInput): Promise<AskFileQuestionResponse> {
    const raw = await runCopilot(buildAskFileQuestionPrompt(input), input);
    return parseCopilotJson(raw, askFileQuestionResponseSchema, "ask-file-question");
  }

  async explainFile(input: ExplainFileProviderInput): Promise<ExplainFileResponse> {
    const raw = await runCopilot(buildExplainFilePrompt(input), input);
    return parseCopilotJson(raw, explainFileResponseSchema, "explain-file");
  }

  async suggestTests(input: SuggestTestsProviderInput): Promise<SuggestTestsResponse> {
    const raw = await runCopilot(buildSuggestTestsPrompt(input), input);
    return parseCopilotJson(raw, suggestTestsResponseSchema, "suggest-tests");
  }

  async preApprovalCheck(input: PreApprovalProviderInput): Promise<PreApprovalCheckResponse> {
    const raw = await runCopilot(buildPreApprovalPrompt(input), input);
    return parseCopilotJson(raw, preApprovalCheckResponseSchema, "pre-approval-check");
  }
}
