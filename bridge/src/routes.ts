import path from "node:path";
import express from "express";
import type { z } from "zod";
import type {
  AnalysePrStreamEvent,
  BindRepoResponse,
  CleanupWorktreesResponse,
  HealthResponse,
  PreparePrWorktreeResponse,
  ProviderName,
  ProviderSettingsResponse,
  PullRequestIdentity,
  RepoBindingLookupResponse
} from "@review-guide/shared";
import { BRIDGE_VERSION } from "./config.js";
import { ConfigStore } from "./configStore.js";
import { buildFileContextPack, buildPrContextPack } from "./contextPack.js";
import { AppError, toErrorMessage } from "./errors.js";
import { ProviderManager } from "./providerManager.js";
import { assertBoundRepoPath, validateRepoBinding } from "./repoBinding.js";
import {
  analyseFileResponseSchema,
  analysePrHeatmapResponseSchema,
  analysePrPlanResponseSchema,
  analysePrTraceResponseSchema,
  analysePrWorriesResponseSchema,
  bindRepoRequestSchema,
  askFileQuestionRequestSchema,
  askFileQuestionResponseSchema,
  cleanupWorktreesRequestSchema,
  explainFileRequestSchema,
  analysePrResponseSchema,
  explainFileResponseSchema,
  preApprovalRequestSchema,
  preApprovalCheckResponseSchema,
  pullRequestIdentitySchema,
  repoIdentitySchema,
  suggestTestsResponseSchema,
  updateProviderRequestSchema
} from "./schemas.js";
import { cleanupOldManagedWorktrees, preparePrWorktree } from "./worktree.js";

const AVAILABLE_PROVIDERS: ProviderName[] = ["mock", "claude-code", "copilot-cli"];
const configStore = new ConfigStore();
const providerManager = new ProviderManager(configStore);

function sendError(response: express.Response, error: unknown) {
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  console.error("[bridge:error]", toErrorMessage(error), error instanceof AppError && error.details ? error.details : "");
  response.status(statusCode).json({
    ok: false,
    error: toErrorMessage(error),
    ...(error instanceof AppError && error.details ? { details: error.details } : {})
  });
}

function installRequestLogger(app: express.Express): void {
  app.use((request, response, next) => {
    const startedAt = Date.now();
    response.on("finish", () => {
      console.log(
        `[bridge] ${request.method} ${request.originalUrl} -> ${response.statusCode} ${Date.now() - startedAt}ms`
      );
    });
    next();
  });
}

function installCors(app: express.Express): void {
  app.use((request, response, next) => {
    const origin = request.get("origin");
    response.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }

    next();
  });
}

function validateProviderResult<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("Provider returned malformed structured output.", 502, {
      issues: parsed.error.issues
    });
  }

  return parsed.data;
}

function startStreamResponse(response: express.Response): void {
  response.status(200);
  response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.flushHeaders?.();
}

function writeStreamEvent(response: express.Response, event: AnalysePrStreamEvent): void {
  response.write(`${JSON.stringify(event)}\n`);
}

function sanitizeFilePath(worktreePath: string, file: string): string {
  if (path.isAbsolute(file)) {
    throw new AppError("File paths must be relative to the prepared worktree.", 400);
  }

  const resolved = path.resolve(worktreePath, file);
  if (!resolved.startsWith(`${path.resolve(worktreePath)}${path.sep}`) && resolved !== path.resolve(worktreePath)) {
    throw new AppError("File path escapes the prepared worktree.", 400);
  }

  return file.replace(/\\/g, "/");
}

async function resolvePreparedContext(identity: PullRequestIdentity): Promise<PreparePrWorktreeResponse> {
  const binding = await configStore.getBinding(identity.host, identity.owner, identity.repo);
  if (!binding) {
    throw new AppError(
      `No local repo binding exists for ${identity.host}/${identity.owner}/${identity.repo}.`,
      404
    );
  }

  await assertBoundRepoPath(binding.localPath);
  return preparePrWorktree(binding, identity);
}

export function createApp() {
  const app = express();
  installRequestLogger(app);
  installCors(app);
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_request, response) => {
    try {
      const payload: HealthResponse = {
        ok: true,
        service: "review-guide-bridge",
        version: BRIDGE_VERSION,
        provider: await providerManager.getSelectedProviderName()
      };
      response.json(payload);
    } catch (error) {
      sendError(response, error);
    }
  });

  app.get("/provider", async (_request, response) => {
    try {
      const payload: ProviderSettingsResponse = {
        provider: await providerManager.getSelectedProviderName(),
        providers: AVAILABLE_PROVIDERS
      };
      response.json(payload);
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/provider", async (request, response) => {
    try {
      const payload = updateProviderRequestSchema.parse(request.body);
      await configStore.setProvider(payload.provider);
      const result: ProviderSettingsResponse = {
        provider: payload.provider,
        providers: AVAILABLE_PROVIDERS
      };
      response.json(result);
    } catch (error) {
      sendError(response, error);
    }
  });

  app.get("/repo-binding", async (request, response) => {
    try {
      const identity = repoIdentitySchema.parse(request.query);
      const binding = await configStore.getBinding(identity.host, identity.owner, identity.repo);

      const payload: RepoBindingLookupResponse = binding
        ? {
            found: true,
            localPath: binding.localPath,
            remoteUrl: binding.remoteUrl
          }
        : {
            found: false,
            suggestions: []
          };

      response.json(payload);
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/bind-repo", async (request, response) => {
    try {
      const payload = bindRepoRequestSchema.parse(request.body);
      const validation = await validateRepoBinding(payload.localPath, payload);
      const result: BindRepoResponse = validation.ok
        ? {
            ok: true,
            message: `Bound ${payload.host}/${payload.owner}/${payload.repo} to ${validation.localPath}`
          }
        : {
            ok: false,
            error: validation.error,
            detectedRemotes: validation.detectedRemotes,
            warning: validation.warning
          };

      if (!validation.ok) {
        response.status(400).json(result);
        return;
      }

      await configStore.setBinding({
        ...payload,
        localPath: validation.localPath,
        remoteUrl: validation.remoteUrl
      });

      response.json(result);
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/prepare-pr-worktree", async (request, response) => {
    try {
      const identity = pullRequestIdentitySchema.parse(request.body);
      response.json(await resolvePreparedContext(identity));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/analyse-pr", async (request, response) => {
    try {
      const identity = pullRequestIdentitySchema.parse(request.body);
      const provider = await providerManager.getSelectedProvider();
      const prepared = await resolvePreparedContext(identity);
      const contextPack = await buildPrContextPack({
        worktreePath: prepared.worktreePath,
        baseRef: prepared.baseRef
      });
      const result = await provider.analysePr({
        ...identity,
        contextPack,
        worktreePath: prepared.worktreePath,
        baseRef: prepared.baseRef,
        headRef: prepared.headRef
      });
      response.json(validateProviderResult(analysePrResponseSchema, result));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/analyse-pr-stream", async (request, response) => {
    let streamStarted = false;
    const startedAt = Date.now();
    const elapsedMs = () => Date.now() - startedAt;

    try {
      const identity = pullRequestIdentitySchema.parse(request.body);
      const provider = await providerManager.getSelectedProvider();

      startStreamResponse(response);
      streamStarted = true;
      writeStreamEvent(response, {
        type: "status",
        stage: "prepare",
        message: "Preparing PR worktree.",
        elapsedMs: elapsedMs()
      });

      const prepared = await resolvePreparedContext(identity);
      writeStreamEvent(response, {
        type: "status",
        stage: "context",
        message: "Building PR context pack.",
        elapsedMs: elapsedMs()
      });

      const contextPack = await buildPrContextPack({
        worktreePath: prepared.worktreePath,
        baseRef: prepared.baseRef
      });

      const providerInput = {
        ...identity,
        contextPack,
        worktreePath: prepared.worktreePath,
        baseRef: prepared.baseRef,
        headRef: prepared.headRef
      };

      writeStreamEvent(response, {
        type: "status",
        stage: "provider",
        message: `Streaming ${provider.name} PR understanding.`,
        elapsedMs: elapsedMs()
      });

      const result = provider.analysePrStream
        ? await provider.analysePrStream(providerInput, (event) => writeStreamEvent(response, event))
        : await provider.analysePr(providerInput);
      const validated = validateProviderResult(analysePrResponseSchema, result);

      writeStreamEvent(response, {
        type: "status",
        stage: "final",
        message: "Validated PR understanding.",
        elapsedMs: elapsedMs()
      });
      writeStreamEvent(response, {
        type: "final",
        result: validated
      });
    } catch (error) {
      if (!streamStarted) {
        sendError(response, error);
        return;
      }

      writeStreamEvent(response, {
        type: "error",
        error: toErrorMessage(error)
      });
    } finally {
      if (streamStarted) {
        response.end();
      }
    }
  });

  app.post("/analyse-pr-plan", async (request, response) => {
    try {
      const identity = pullRequestIdentitySchema.parse(request.body);
      const provider = await providerManager.getSelectedProvider();
      const prepared = await resolvePreparedContext(identity);
      const contextPack = await buildPrContextPack({
        worktreePath: prepared.worktreePath,
        baseRef: prepared.baseRef
      });
      const result = await provider.analysePrPlan({
        ...identity,
        contextPack,
        worktreePath: prepared.worktreePath,
        baseRef: prepared.baseRef,
        headRef: prepared.headRef
      });
      response.json(validateProviderResult(analysePrPlanResponseSchema, result));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/analyse-pr-heatmap", async (request, response) => {
    try {
      const identity = pullRequestIdentitySchema.parse(request.body);
      const provider = await providerManager.getSelectedProvider();
      const prepared = await resolvePreparedContext(identity);
      const contextPack = await buildPrContextPack({
        worktreePath: prepared.worktreePath,
        baseRef: prepared.baseRef
      });
      const result = await provider.analysePrHeatmap({
        ...identity,
        contextPack,
        worktreePath: prepared.worktreePath,
        baseRef: prepared.baseRef,
        headRef: prepared.headRef
      });
      response.json(validateProviderResult(analysePrHeatmapResponseSchema, result));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/analyse-pr-trace", async (request, response) => {
    try {
      const identity = pullRequestIdentitySchema.parse(request.body);
      const provider = await providerManager.getSelectedProvider();
      const prepared = await resolvePreparedContext(identity);
      const contextPack = await buildPrContextPack({
        worktreePath: prepared.worktreePath,
        baseRef: prepared.baseRef
      });
      const result = await provider.analysePrTrace({
        ...identity,
        contextPack,
        worktreePath: prepared.worktreePath,
        baseRef: prepared.baseRef,
        headRef: prepared.headRef
      });
      response.json(validateProviderResult(analysePrTraceResponseSchema, result));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/analyse-pr-worries", async (request, response) => {
    try {
      const identity = pullRequestIdentitySchema.parse(request.body);
      const provider = await providerManager.getSelectedProvider();
      const prepared = await resolvePreparedContext(identity);
      const contextPack = await buildPrContextPack({
        worktreePath: prepared.worktreePath,
        baseRef: prepared.baseRef
      });
      const result = await provider.analysePrWorries({
        ...identity,
        contextPack,
        worktreePath: prepared.worktreePath,
        baseRef: prepared.baseRef,
        headRef: prepared.headRef
      });
      response.json(validateProviderResult(analysePrWorriesResponseSchema, result));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/explain-file", async (request, response) => {
    try {
      const identity = explainFileRequestSchema.parse(request.body);
      const provider = await providerManager.getSelectedProvider();
      const prepared = await resolvePreparedContext(identity);
      const file = sanitizeFilePath(prepared.worktreePath, identity.file);
      const contextPack = await buildFileContextPack({
          worktreePath: prepared.worktreePath,
          baseRef: prepared.baseRef,
          file
      });
      const result = await provider.explainFile({
          ...identity,
          file,
          contextPack,
          worktreePath: prepared.worktreePath,
          baseRef: prepared.baseRef,
          headRef: prepared.headRef
      });
      response.json(validateProviderResult(explainFileResponseSchema, result));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/analyse-file", async (request, response) => {
    try {
      const identity = explainFileRequestSchema.parse(request.body);
      const provider = await providerManager.getSelectedProvider();
      const prepared = await resolvePreparedContext(identity);
      const file = sanitizeFilePath(prepared.worktreePath, identity.file);
      const contextPack = await buildFileContextPack({
          worktreePath: prepared.worktreePath,
          baseRef: prepared.baseRef,
          file
      });
      const result = await provider.analyseFile({
          ...identity,
          file,
          contextPack,
          worktreePath: prepared.worktreePath,
          baseRef: prepared.baseRef,
          headRef: prepared.headRef
      });
      response.json(validateProviderResult(analyseFileResponseSchema, result));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/ask-file-question", async (request, response) => {
    try {
      const identity = askFileQuestionRequestSchema.parse(request.body);
      const provider = await providerManager.getSelectedProvider();
      const prepared = await resolvePreparedContext(identity);
      const file = sanitizeFilePath(prepared.worktreePath, identity.file);
      const contextPack = await buildFileContextPack({
          worktreePath: prepared.worktreePath,
          baseRef: prepared.baseRef,
          file
      });
      const result = await provider.askFileQuestion({
          ...identity,
          file,
          contextPack,
          worktreePath: prepared.worktreePath,
          baseRef: prepared.baseRef,
          headRef: prepared.headRef
      });
      response.json(validateProviderResult(askFileQuestionResponseSchema, result));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/suggest-tests", async (request, response) => {
    try {
      const identity = explainFileRequestSchema.parse(request.body);
      const provider = await providerManager.getSelectedProvider();
      const prepared = await resolvePreparedContext(identity);
      const file = sanitizeFilePath(prepared.worktreePath, identity.file);
      const contextPack = await buildFileContextPack({
          worktreePath: prepared.worktreePath,
          baseRef: prepared.baseRef,
          file
      });
      const result = await provider.suggestTests({
          ...identity,
          file,
          contextPack,
          worktreePath: prepared.worktreePath,
          baseRef: prepared.baseRef,
          headRef: prepared.headRef
      });
      response.json(validateProviderResult(suggestTestsResponseSchema, result));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/pre-approval-check", async (request, response) => {
    try {
      const identity = preApprovalRequestSchema.parse(request.body);
      const provider = await providerManager.getSelectedProvider();
      const prepared = await resolvePreparedContext(identity);
      const result = await provider.preApprovalCheck({
          ...identity,
          reviewedFiles: identity.reviewedFiles.map((file) => sanitizeFilePath(prepared.worktreePath, file)),
          worktreePath: prepared.worktreePath,
          baseRef: prepared.baseRef,
          headRef: prepared.headRef
      });
      response.json(validateProviderResult(preApprovalCheckResponseSchema, result));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.post("/cleanup-worktrees", async (request, response) => {
    try {
      const payload = cleanupWorktreesRequestSchema.parse(request.body);
      const result: CleanupWorktreesResponse = {
        ok: true,
        removed: await cleanupOldManagedWorktrees(payload.olderThanDays)
      };
      response.json(result);
    } catch (error) {
      sendError(response, error);
    }
  });

  return app;
}
