import fs from "node:fs/promises";
import path from "node:path";
import type { ProviderName, RepoBinding } from "@review-guide/shared";
import { getConfigPath } from "./config.js";

export interface StoredBinding {
  localPath: string;
  remoteUrl: string;
}

export interface BridgeConfig {
  provider: ProviderName;
  bindings: Record<string, StoredBinding>;
  security: {
    relaxedLocalhostOnly: boolean;
  };
}

export function getBindingId(host: string, owner: string, repo: string): string {
  return `${host.toLowerCase()}/${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

export const DEFAULT_CONFIG: BridgeConfig = {
  provider: "mock",
  bindings: {},
  security: {
    relaxedLocalhostOnly: true
  }
};

export class ConfigStore {
  constructor(private readonly configPath = getConfigPath()) {}

  async readConfig(): Promise<BridgeConfig> {
    try {
      const raw = await fs.readFile(this.configPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<BridgeConfig>;

      return {
        provider: parsed.provider ?? DEFAULT_CONFIG.provider,
        bindings: parsed.bindings ?? {},
        security: {
          relaxedLocalhostOnly: parsed.security?.relaxedLocalhostOnly ?? true
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...DEFAULT_CONFIG, bindings: {} };
      }

      throw error;
    }
  }

  async writeConfig(config: BridgeConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), "utf8");
  }

  async getProvider(): Promise<ProviderName> {
    const config = await this.readConfig();
    return config.provider;
  }

  async setProvider(provider: ProviderName): Promise<void> {
    const config = await this.readConfig();
    config.provider = provider;
    await this.writeConfig(config);
  }

  async getBinding(host: string, owner: string, repo: string): Promise<RepoBinding | null> {
    const config = await this.readConfig();
    const id = getBindingId(host, owner, repo);
    const binding = config.bindings[id];

    if (!binding) {
      return null;
    }

    return {
      host,
      owner,
      repo,
      localPath: binding.localPath,
      remoteUrl: binding.remoteUrl
    };
  }

  async setBinding(binding: RepoBinding): Promise<void> {
    const config = await this.readConfig();
    config.bindings[getBindingId(binding.host, binding.owner, binding.repo)] = {
      localPath: binding.localPath,
      remoteUrl: binding.remoteUrl
    };
    await this.writeConfig(config);
  }
}
