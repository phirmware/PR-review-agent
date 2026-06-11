import type {
  AnalyseFileRequest,
  AnalyseFileResponse,
  AnalysePrHeatmapResponse,
  AnalysePrPlanResponse,
  AnalysePrResponse,
  AnalysePrStreamEvent,
  AnalysePrTraceResponse,
  AnalysePrWorriesResponse,
  AskFileQuestionRequest,
  AskFileQuestionResponse,
  BindRepoRequest,
  BindRepoResponse,
  ExplainFileRequest,
  ExplainFileResponse,
  HealthResponse,
  PreApprovalCheckRequest,
  PreApprovalCheckResponse,
  ProviderSettingsResponse,
  PullRequestIdentity,
  RepoBindingLookupResponse,
  UpdateProviderRequest,
  SuggestTestsRequest,
  SuggestTestsResponse
} from "@review-guide/shared";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";

export class ApiClient {
  constructor(private readonly baseUrl = DEFAULT_BASE_URL) {}

  private async requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${pathname}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {})
        }
      });
    } catch {
      throw new Error("Bridge unreachable. Start the local review-guide bridge on localhost.");
    }

    const payload = (await response.json()) as T & { ok?: boolean; error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? `Bridge request failed with status ${response.status}`);
    }

    return payload;
  }

  health(): Promise<HealthResponse> {
    return this.requestJson("/health");
  }

  getProvider(): Promise<ProviderSettingsResponse> {
    return this.requestJson("/provider");
  }

  setProvider(request: UpdateProviderRequest): Promise<ProviderSettingsResponse> {
    return this.requestJson("/provider", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  getRepoBinding(identity: Omit<PullRequestIdentity, "prNumber">): Promise<RepoBindingLookupResponse> {
    const searchParams = new URLSearchParams(identity);
    return this.requestJson(`/repo-binding?${searchParams.toString()}`);
  }

  bindRepo(request: BindRepoRequest): Promise<BindRepoResponse> {
    return this.requestJson("/bind-repo", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  analysePr(identity: PullRequestIdentity): Promise<AnalysePrResponse> {
    return this.requestJson("/analyse-pr", {
      method: "POST",
      body: JSON.stringify(identity)
    });
  }

  async analysePrStream(
    identity: PullRequestIdentity,
    onEvent: (event: AnalysePrStreamEvent) => void
  ): Promise<AnalysePrResponse> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/analyse-pr-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(identity)
      });
    } catch {
      throw new Error("Bridge unreachable. Start the local review-guide bridge on localhost.");
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Bridge stream request failed with status ${response.status}`);
    }

    if (!response.body) {
      throw new Error("Bridge stream response was not readable.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: AnalysePrResponse | null = null;

    const parseLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      const event = JSON.parse(trimmed) as AnalysePrStreamEvent;
      onEvent(event);
      if (event.type === "error") {
        throw new Error(event.error);
      }
      if (event.type === "final") {
        finalResult = event.result;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n");
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        parseLine(line);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      parseLine(buffer);
    }

    if (!finalResult) {
      throw new Error("Bridge stream ended before returning a final analysis.");
    }

    return finalResult;
  }

  analysePrPlan(identity: PullRequestIdentity): Promise<AnalysePrPlanResponse> {
    return this.requestJson("/analyse-pr-plan", {
      method: "POST",
      body: JSON.stringify(identity)
    });
  }

  analysePrHeatmap(identity: PullRequestIdentity): Promise<AnalysePrHeatmapResponse> {
    return this.requestJson("/analyse-pr-heatmap", {
      method: "POST",
      body: JSON.stringify(identity)
    });
  }

  analysePrTrace(identity: PullRequestIdentity): Promise<AnalysePrTraceResponse> {
    return this.requestJson("/analyse-pr-trace", {
      method: "POST",
      body: JSON.stringify(identity)
    });
  }

  analysePrWorries(identity: PullRequestIdentity): Promise<AnalysePrWorriesResponse> {
    return this.requestJson("/analyse-pr-worries", {
      method: "POST",
      body: JSON.stringify(identity)
    });
  }

  analyseFile(request: AnalyseFileRequest): Promise<AnalyseFileResponse> {
    return this.requestJson("/analyse-file", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  askFileQuestion(request: AskFileQuestionRequest): Promise<AskFileQuestionResponse> {
    return this.requestJson("/ask-file-question", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  explainFile(request: ExplainFileRequest): Promise<ExplainFileResponse> {
    return this.requestJson("/explain-file", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  suggestTests(request: SuggestTestsRequest): Promise<SuggestTestsResponse> {
    return this.requestJson("/suggest-tests", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  preApprovalCheck(request: PreApprovalCheckRequest): Promise<PreApprovalCheckResponse> {
    return this.requestJson("/pre-approval-check", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }
}
