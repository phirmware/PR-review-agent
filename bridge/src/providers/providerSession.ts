import { createHash } from "node:crypto";
import type { ProviderExecutionInput, ProviderName } from "@review-guide/shared";
import { runCommand } from "../git.js";

function uuidFromString(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function providerSessionsEnabled(): boolean {
  const raw = process.env.REVIEW_GUIDE_PROVIDER_SESSIONS?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

async function resolveGitSha(worktreePath: string, ref: string, fallback: string): Promise<string> {
  const result = await runCommand("git", ["rev-parse", "--verify", ref], {
    cwd: worktreePath,
    allowNonZeroExit: true
  });

  return result.exitCode === 0 && result.stdout ? result.stdout : fallback;
}

export async function getProviderSessionId(
  provider: ProviderName,
  input: ProviderExecutionInput
): Promise<string | null> {
  if (!providerSessionsEnabled()) {
    console.log(`[bridge:provider-session] sessions disabled for ${provider}; starting a fresh provider invocation`);
    return null;
  }

  const baseSha = await resolveGitSha(input.worktreePath, input.baseRef, `unknown-base:${input.baseRef}`);
  const headSha = await resolveGitSha(input.worktreePath, "HEAD", "unknown-head");
  const sessionId = uuidFromString(
    [
      "review-guide",
      provider,
      input.host,
      input.owner,
      input.repo,
      String(input.prNumber),
      input.baseRef,
      baseSha,
      headSha
    ].join(":")
  );
  console.log(
    `[bridge:provider-session] using deterministic session id ${sessionId} for ${provider} ${input.owner}/${input.repo}#${input.prNumber} base=${input.baseRef}@${baseSha} head=${headSha}`
  );
  return sessionId;
}
