# PR Review Guide

PR Review Guide is a local-first GitHub pull request review assistant.

It is a Chrome browser extension plus a localhost bridge. The extension adds an interactive review UI to GitHub PR pages. The bridge binds a GitHub repo to your local checkout, prepares a safe temporary git worktree for the PR, then asks an existing local coding agent such as GitHub Copilot CLI or Claude Code to produce structured review guidance.

The product is intentionally not a custom code-review intelligence engine. Its job is orchestration, safety, and UX.

## What You Get

- A floating **Review Guide** button on GitHub PR pages.
- A right-side panel with provider selection, repo binding, review queue, and analyzed files.
- File-by-file analysis from the GitHub UI.
- Highlight/right-click flow for analyzing a selected file path.
- A focused file popover with summary, PR context, risks, review checks, suggested tests, and an ask box.
- Reviewed/unreviewed tracking for the current PR.
- Local bridge logs showing worktree reuse, provider session reuse, and context-pack decisions.
- Safe temporary worktrees so your main local checkout is not mutated.

## Architecture

```text
GitHub PR page
  -> Chrome extension
  -> Local bridge on 127.0.0.1:8787
  -> Saved repo binding
  -> Temporary PR worktree
  -> Provider adapter
       - mock
       - claude-code
       - copilot-cli
  -> Validated structured JSON
  -> Extension renders review guidance
```

## Repository Layout

```text
extension/  Manifest V3 browser extension and GitHub UI adapter
bridge/     Node/TypeScript localhost bridge and provider orchestration
shared/     Shared TypeScript contracts
```

## Prerequisites

- Node.js `20.19+` or `22.12+`
- npm
- git
- Chrome or another Chromium browser that supports unpacked Manifest V3 extensions
- A local clone of the GitHub repository you want to review

Optional provider tools:

- GitHub Copilot CLI: `copilot`
- Claude Code CLI: `claude`

The `mock` provider works without external AI tooling.

## Quick Start

Clone and install:

```sh
git clone <this-repo-url>
cd PR-review-agent
nvm install
nvm use
npm install
```

Build everything:

```sh
npm run build
```

Start the local bridge:

```sh
npm run start -w bridge
```

The bridge listens only on:

```text
http://127.0.0.1:8787
```

Check it:

```sh
curl http://127.0.0.1:8787/health
```

Example response:

```json
{
  "ok": true,
  "service": "review-guide-bridge",
  "version": "0.1.0",
  "provider": "mock"
}
```

## Load The Chrome Extension

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select `extension/dist`.
6. Open a GitHub PR page.
7. Click the floating **Review Guide** button.

After code changes, click **Reload** on the unpacked extension and refresh the GitHub PR page.

## First Use On A PR

1. Open a GitHub PR page, for example:

   ```text
   https://github.com/{owner}/{repo}/pull/{number}
   ```

2. Click **Review Guide**.
3. Confirm the detected repo details.
4. If the repo is not bound, enter your local checkout path.
5. Click **Connect repo**.
6. Choose a provider from the dropdown.
7. Analyze a file from the panel, the GitHub file header, or the highlight/right-click flow.

The extension never reads your filesystem. The bridge owns all filesystem and git access.

## Repo Binding

Bindings are stored locally in:

```text
~/.review-guide/config.json
```

Example:

```json
{
  "provider": "copilot-cli",
  "bindings": {
    "github.com/iag-loyalty/rewards-service": {
      "localPath": "/Users/you/dev/rewards-service",
      "remoteUrl": "git@github.com:iag-loyalty/rewards-service.git"
    }
  },
  "security": {
    "relaxedLocalhostOnly": true
  }
}
```

The bridge validates that:

- the path exists
- the path is a git repository
- at least one remote matches the GitHub repo

These are treated as equivalent:

```text
git@github.com:iag-loyalty/rewards-service.git
https://github.com/iag-loyalty/rewards-service.git
https://github.com/iag-loyalty/rewards-service
```

## Temporary Worktree Safety

The bridge does not checkout, reset, clean, patch, or mutate your main working copy.

For each PR, it prepares a managed worktree under:

```text
~/.review-guide/worktrees/{host}/{owner}/{repo}/pr-{prNumber}
```

Provider commands run inside this temporary PR worktree.

Safe git operations in the bound repo include:

- `git remote -v`
- `git fetch`
- `git rev-parse`
- `git worktree list`
- `git worktree add`
- `git worktree remove` only for managed worktree paths
- `git diff`

## Providers

The active provider can be switched from the extension UI.

Supported providers:

- `mock` - deterministic local provider for development and tests.
- `claude-code` - runs local Claude Code from the temporary worktree.
- `copilot-cli` - runs local GitHub Copilot CLI from the temporary worktree.

### Copilot CLI

Default command:

```text
copilot --silent --no-color --session-id <stable-pr-session> -p <prompt> --allow-tool shell(git) --allow-tool shell(rg)
```

If `copilot` is not on the bridge process `PATH`, set:

```sh
REVIEW_GUIDE_COPILOT_COMMAND=/absolute/path/to/copilot
```

Optional custom args:

```sh
REVIEW_GUIDE_COPILOT_ARGS='--silent --no-color -p {prompt} --allow-tool shell(git) --allow-tool shell(rg)'
```

### Claude Code

Default command:

```text
claude --session-id <stable-pr-session> -p <prompt>
```

Overrides:

```sh
REVIEW_GUIDE_CLAUDE_COMMAND=claude
REVIEW_GUIDE_CLAUDE_ARGS="-p"
```

Custom args replace the default args, so include provider-specific session flags yourself if you want session reuse with custom commands.

### Provider Sessions

By default, real providers use deterministic session IDs keyed by:

```text
provider + host + owner + repo + PR number + base ref + worktree HEAD SHA
```

That lets Copilot or Claude reuse provider-side session context across repeated requests for the same PR head. When the PR changes, the worktree HEAD SHA changes and a fresh provider session is used automatically.

Disable provider session reuse:

```sh
REVIEW_GUIDE_PROVIDER_SESSIONS=0
```

## Extension Workflows

Common review flow:

1. Open a PR.
2. Click **Review Guide**.
3. Select `copilot-cli`, `claude-code`, or `mock`.
4. Click **Analyse PR** for a high-level review map, or analyze files one by one.
5. Open file analysis from:
   - the panel file list
   - the GitHub file header button
   - highlighted file path plus right-click **Analyze selected file**
6. Ask follow-up questions in the file popover.
7. Mark files reviewed.
8. Run a pre-approval check.

Analyzed files are kept in memory for the current page session. If you close the file popover or panel without refreshing the page, the **Analyzed files** section can reopen them instantly.

## Bridge API

Implemented endpoints:

- `GET /health`
- `GET /provider`
- `POST /provider`
- `GET /repo-binding?host=github.com&owner=OWNER&repo=REPO`
- `POST /bind-repo`
- `POST /prepare-pr-worktree`
- `POST /analyse-pr`
- `POST /analyse-file`
- `POST /ask-file-question`
- `POST /explain-file`
- `POST /suggest-tests`
- `POST /pre-approval-check`
- `POST /cleanup-worktrees`

All provider responses are parsed and validated with Zod before they are returned to the extension.

## Latency Optimizations

Initial file-level provider requests could take around **60 seconds or more** because every request paid several repeated costs:

- git worktree remove/add
- fresh provider conversation/session
- agent discovery across the repo

The bridge now includes three optimizations that can bring repeated file-level latency down toward the **~20 second range** in local testing, depending on provider, repo size, file complexity, and provider availability.

This is not a guaranteed SLA, but it is the intended performance direction.

### 1. SHA-Based Worktree Reuse

The bridge still fetches the PR ref to learn the latest PR head SHA.

Then it compares:

```text
fetched PR ref SHA
existing managed worktree HEAD SHA
```

If they match and the managed worktree is clean and registered, it reuses the existing worktree. If the PR changed, it recreates only that managed worktree path.

Example logs:

```text
[bridge:worktree] fetching PR ref pull/131/head -> refs/review-guide/pr-131
[bridge:worktree] reusing worktree; PR head SHA unchanged (...) at ...
```

### 2. Provider Session Reuse

Copilot and Claude receive stable provider session IDs for the same PR head.

This reduces repeated provider-side rediscovery without requiring us to keep an interactive CLI process running forever.

Example logs:

```text
[bridge:provider-session] reusing provider session <uuid> for copilot-cli org/repo#131 head=<sha>
[bridge:provider] invoking copilot-cli in ... with session <uuid>
```

### 3. File Context Packs

Before file-level provider calls, the bridge builds a compact context pack from cheap local commands:

- changed files
- related changed files
- likely test files
- useful package scripts
- diff stat
- capped file diff
- import/export hints
- lightweight caller hints

The prompt tells the provider to use this context first and only search more if needed.

Example log:

```text
[bridge:context] built file context pack for openapi.yaml: changed=18 related=4 tests=2 callers=0 diffChars=4200 in 85ms
```

## Logging

The bridge logs request timing and optimization decisions.

Useful examples:

```text
[bridge] POST /analyse-file -> 200 26300ms
[bridge:worktree] reusing worktree; PR head SHA unchanged (...)
[bridge:provider-session] reusing provider session <uuid> ...
[bridge:context] built file context pack for src/foo.ts ...
```

Timeout logs are intentionally shortened so they do not dump the full provider prompt.

## Security And Privacy

- The bridge listens on `127.0.0.1`, not a public interface.
- The extension only talks to the localhost bridge.
- The extension does not inspect local files.
- The extension stores only UI state such as reviewed files.
- Source code stays local with the `mock` provider.
- Claude Code and Copilot CLI may send code or repo context externally depending on your local provider configuration.
- Provider commands are fixed templates controlled by the bridge.
- File-specific requests are restricted to paths inside the prepared worktree.
- Localhost auth is relaxed for the MVP.

Review provider privacy behavior before enabling `claude-code` or `copilot-cli`.

## Development

Install:

```sh
npm install
```

Build:

```sh
npm run build
```

Typecheck:

```sh
npm run typecheck
```

Test:

```sh
npm test
```

Start bridge:

```sh
npm run start -w bridge
```

## Test Coverage

Current tests cover:

- GitHub PR URL parsing
- selected file path normalization
- GitHub DOM adapter behavior
- git remote URL normalization
- repo binding validation
- config read/write
- worktree path safety
- SHA-based worktree reuse
- provider session IDs
- context-pack discovery
- provider JSON extraction and validation
- MockProvider structured output
- bridge route response shapes

## Troubleshooting

### The extension does not show up on GitHub

- Confirm the unpacked extension points to `extension/dist`.
- Click **Reload** in `chrome://extensions`.
- Refresh the GitHub PR page.
- Confirm the URL is a GitHub PR URL.

### Bridge unreachable

Start the bridge:

```sh
npm run start -w bridge
```

Then check:

```sh
curl http://127.0.0.1:8787/health
```

### Copilot command not found

Find Copilot:

```sh
command -v copilot
```

If needed:

```sh
REVIEW_GUIDE_COPILOT_COMMAND=/absolute/path/to/copilot npm run start -w bridge
```

### Copilot authentication errors

Run:

```sh
copilot login
```

or start the bridge from a shell that has the required Copilot/GitHub token environment.

### Claude command not found

Find Claude:

```sh
command -v claude
```

If needed:

```sh
REVIEW_GUIDE_CLAUDE_COMMAND=/absolute/path/to/claude npm run start -w bridge
```

### File selection says no file was selected

Root-level paths such as `openapi.yaml` are supported. If selection still fails, select the exact path text from the GitHub file header or use the file's **Open analysis** button after PR analysis.

## Current MVP Limits

- GitHub Enterprise support is not complete; this pass targets `github.com`.
- PR base resolution prefers `gh pr view`, then falls back to the remote default branch.
- `claude-code` and `copilot-cli` depend on your local CLI setup and auth state.
- File context packs are built per request and are not cached yet.
- Full provider process reuse is not implemented yet; provider session reuse is the safer intermediate step.
- The UI is intentionally lightweight and not production-polished.
