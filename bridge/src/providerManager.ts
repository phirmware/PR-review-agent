import type { ProviderName } from "@review-guide/shared";
import { ConfigStore } from "./configStore.js";
import { AppError } from "./errors.js";
import { ClaudeCodeProvider } from "./providers/ClaudeCodeProvider.js";
import { CopilotCliProvider } from "./providers/CopilotCliProvider.js";
import { MockProvider } from "./providers/MockProvider.js";
import type { ReviewAgentProvider } from "./providers/ReviewAgentProvider.js";

export class ProviderManager {
  constructor(private readonly configStore: ConfigStore) {}

  async getSelectedProviderName(): Promise<ProviderName> {
    return this.configStore.getProvider();
  }

  async getSelectedProvider(): Promise<ReviewAgentProvider> {
    const provider = await this.getSelectedProviderName();

    switch (provider) {
      case "mock":
        return new MockProvider();
      case "claude-code":
        return new ClaudeCodeProvider();
      case "copilot-cli":
        return new CopilotCliProvider();
      default:
        throw new AppError(`Unsupported provider configured: ${provider satisfies never}`, 500);
    }
  }
}
