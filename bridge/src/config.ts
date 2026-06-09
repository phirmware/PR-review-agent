import os from "node:os";
import path from "node:path";

export const BRIDGE_VERSION = "0.1.0";
export const DEFAULT_BRIDGE_PORT = 8787;

export function getReviewGuideHome(): string {
  return path.resolve(process.env.REVIEW_GUIDE_HOME ?? path.join(os.homedir(), ".review-guide"));
}

export function getConfigPath(): string {
  return path.join(getReviewGuideHome(), "config.json");
}

export function getWorktreesRoot(): string {
  return path.join(getReviewGuideHome(), "worktrees");
}

export function getBridgePort(): number {
  const value = Number(process.env.REVIEW_GUIDE_PORT ?? DEFAULT_BRIDGE_PORT);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BRIDGE_PORT;
}
