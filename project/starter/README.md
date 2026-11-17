# Multi-Agent Code Review Orchestrator

A command-line tool that reviews a GitHub pull request with Claude. It reads the PR through the GitHub MCP server, has three subagents review every changed file for code quality, test coverage and refactoring opportunities, and writes the combined review as Markdown, HTML and JSON reports. It is built on the Claude Agent SDK as the capstone project for the Udacity cd14715 course.

## How it works

`src/main.ts` checks the arguments and environment, then `src/orchestrator.ts` runs one Agent SDK `query()` session:

1. The orchestrator prompt (`src/prompts/orchestrator.prompt.ts`) fetches the PR and its changed files through the GitHub MCP server. Removed files, binary files, lockfiles and generated or minified files are skipped.
2. For each remaining file, the orchestrator starts three subagents in the same turn with the Task tool, so they run in parallel:
   - `code-quality-analyzer`: security, performance, maintainability and bug-risk issues, plus a 0-100 score
   - `test-coverage-analyzer`: finds the existing tests and lists untested code paths by priority
   - `refactoring-suggester`: refactorings with before and after snippets

   The agent definitions are in `src/agents/` and their prompts in `src/prompts/`.
3. Each subagent reads the whole file at the PR's head commit and loads Claude Skills from `.claude/skills/` based on the file extension: `typescript-patterns` (.ts, .tsx), `javascript-best-practices` (.js, .jsx, .mjs, .cjs) or `python-code-review` (.py). The code quality agent also loads `security-analysis` for every file.
4. The orchestrator returns the report as structured output, using a JSON Schema generated from the Zod schemas in `src/types/`. The result is validated with Zod again, and the summary numbers are recomputed in code instead of being taken from the model.

Other details:

- MCP servers (`src/config/mcp.config.ts`): GitHub (`@modelcontextprotocol/server-github`) and ESLint (`@eslint/mcp`), both started with `npx -y`. On Windows they are launched through `cmd /c` automatically. The code quality agent only calls ESLint when the file exists on local disk.
- Tools are limited to an allowlist (Task, Skill, Read, Grep, Glob, four GitHub tools and ESLint's `lint-files`) with `permissionMode: 'dontAsk'`, which denies anything not on the list. The project does not use `bypassPermissions`.
- Each review goes through a rate limiter, a 20-minute timeout per attempt, and up to 3 attempts with exponential backoff (`src/utils/`).
- The subagents use `model: 'inherit'`, so `ANTHROPIC_MODEL` sets the model for every agent.

## Prerequisites

- Node.js 20.19+, 22.13+ or 24+. `package.json` says >=18, but the test runner (Vitest 4) and the ESLint MCP server need these versions.
- npm. The MCP servers are started with npx, which downloads them on the first run.
- Claude access through one of: the Vocareum workspace, your own Anthropic API key, a Vocareum key, or AWS Bedrock.
- A GitHub personal access token (optional, recommended).

## Setup

### Install

The repository uses npm workspaces, so install dependencies from the repository root.

In the Vocareum workspace:

```bash
cd /voc/work/cd14715-claude-code-classroom
npm install
cd project/starter
cp .env.example .env
```

On your own machine:

```bash
git clone https://github.com/RithvikRS/cd14715-claude-code-classroom.git
cd cd14715-claude-code-classroom
npm install
cd project/starter
cp .env.example .env
```

### Configure .env

The CLI loads `.env` from the current directory, so keep it in `project/starter` and run commands from there. Variables already set in your shell take precedence over `.env`.

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes, unless using Bedrock | Anthropic API key. |
| `ANTHROPIC_BASE_URL` | Only for a Vocareum key outside the workspace | API endpoint. |
| `ANTHROPIC_MODEL` | Yes | Model for the orchestrator and all subagents, for example `claude-sonnet-4-5-20250929`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | Only for Bedrock | When both keys are set, Bedrock is used instead of the Anthropic API, and `AWS_REGION` is required. |
| `GITHUB_TOKEN` | No, recommended | Passed to the GitHub MCP server. Without it GitHub allows 60 requests an hour and code search doesn't work. The `repo` scope is only needed for private repositories. |
| `PROJECT_ROOT` | No | Absolute path to `project/starter` (the folder with `.claude/skills/`). Used as the agent's working directory. Defaults to the current directory. |
| `LOG_LEVEL` | No | `error`, `warn`, `info` (default) or `debug`. |
| `NODE_ENV` | No | `production` turns off log output to the console. The files in `logs/` are still written. |

Set up authentication for your environment:

- **Vocareum workspace:** `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` are already in the environment, so don't add them to `.env`. Set `ANTHROPIC_MODEL`. The `PROJECT_ROOT` line in `.env.example` already points at the workspace path.
- **Your own Anthropic key:** set `ANTHROPIC_API_KEY=sk-ant-...` and `ANTHROPIC_MODEL`. Change `PROJECT_ROOT` to your own path or delete the line, since the Vocareum path won't exist on your machine.
- **A Vocareum key on your own machine:** a key that starts with `voc-` only works through the Vocareum proxy. Set `ANTHROPIC_API_KEY=voc-...`, `ANTHROPIC_BASE_URL=https://claude.vocareum.com` and `ANTHROPIC_MODEL`, and fix `PROJECT_ROOT` as above.
- **AWS Bedrock:** set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_REGION`, plus `AWS_SESSION_TOKEN` if your credentials are temporary, and use a Bedrock model ID such as `ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0`. The CLI sets `CLAUDE_CODE_USE_BEDROCK=1` for you.

## Usage

Run from `project/starter`:

```bash
# Run the TypeScript source directly
npm run dev -- <owner> <repo> <pr-number>

# Or compile to dist/ and run the compiled code
npm run build
npm start <owner> <repo> <pr-number>
```

Example, reviewing PR 1 of `udacity/cd14715-simple-todo-app`:

```bash
npm run dev -- udacity cd14715-simple-todo-app 1
```

The PR number must be a positive integer. The CLI prints which authentication it is using (`Using Anthropic API authentication` or `Using AWS Bedrock authentication`), then log lines while the review runs, and ends with the report paths and a summary. For the example above:

```
Reports written:
  reports/udacity_cd14715-simple-todo-app_1.md
  reports/udacity_cd14715-simple-todo-app_1.html
  reports/udacity_cd14715-simple-todo-app_1.json

Reviewed 1 files: score 72/100, 0 critical issues, 5 high-priority test gaps, 8 refactoring opportunities.
```

- **Reports** are written to `reports/<owner>_<repo>_<pr-number>` as `.md`, `.html` and `.json`. Running the same PR again overwrites them. The `reports/` folder already contains the reviews of `udacity/cd14715-simple-todo-app` PRs 1, 2 and 3.
- **Logs** go to `logs/combined.log` (everything) and `logs/error.log` (errors only) as JSON lines, and to the console unless `NODE_ENV=production`. With `LOG_LEVEL=debug`, each subagent is also logged as it starts, with the file it is reviewing.
- **Run time:** single-file PRs took between 101 and 259 seconds in four test runs. Every extra file adds three more subagent runs.

## Testing

```bash
npm test             # run the tests once (vitest run)
npm run test:watch   # rerun on changes
npm run lint         # type check (tsc --noEmit)
```

The Agent SDK is mocked, so the tests make no API calls.

- `tests/schemas.test.ts`: the Zod schemas and the JSON Schemas generated from them.
- `tests/orchestrator.test.ts`: the options passed to `query()`, report aggregation and validation, and failure handling.

The current result is 48 passed and 1 skipped. The skipped test reviews a real PR (`octocat/Hello-World` #1) and only runs if you remove its `it.skip`. The tests don't read `.env`, so export the credentials and `ANTHROPIC_MODEL` in your shell first. For Bedrock, also export `CLAUDE_CODE_USE_BEDROCK=1`, which only the CLI sets for you.

## Project structure

```
project/starter/
  .claude/skills/              Skills the subagents load, one SKILL.md per folder
    javascript-best-practices/
    python-code-review/
    security-analysis/
    typescript-patterns/
  reports/                     Generated reports
  src/
    main.ts                    CLI entry point: checks arguments and environment, writes reports
    orchestrator.ts            Runs the query() session and validates the report
    agents/                    Subagent definitions (prompt, tools, model)
    config/mcp.config.ts       GitHub and ESLint MCP servers and their tool lists
    prompts/                   Orchestrator and subagent prompts
    types/                     Zod schemas and the JSON Schemas generated from them
    utils/                     Logger, report generator, rate limiter, retry and timeout helpers
  tests/
    orchestrator.test.ts
    schemas.test.ts
  .env.example
  package.json
  tsconfig.json
```

`logs/` and `dist/` are created when you run or build the project and are ignored by git.

## Troubleshooting

**`No authentication configured. Set one of these:`**
Neither `ANTHROPIC_API_KEY` nor both AWS keys were found. Check `.env`, and make sure you run the command from `project/starter`, because `.env` is read from the current directory.

**`AWS_REGION must be set when using AWS Bedrock.`**
Both AWS keys are set, so the CLI uses Bedrock. Add `AWS_REGION`, or remove the AWS keys to use the Anthropic API.

**`Failed to spawn Claude Code process: spawn ... ENOENT`**
`PROJECT_ROOT` points to a folder that doesn't exist, usually the Vocareum path from `.env.example`. Set it to your `project/starter` path or delete the line. The message names the Node executable, but the missing path is the working directory.

**GitHub rate limits or failed code searches**
Set `GITHUB_TOKEN`. When code search fails, the test coverage agent checks the `tests/` and `test/` directories instead.

**The first run is slow, or the GitHub MCP server fails to start**
npx downloads both MCP servers the first time, which makes the first run slower. If the GitHub server can't start, the run stops after three attempts with:

```
Error: [RETRY_EXHAUSTED] Failed after 3 attempts: [GITHUB_API_ERROR] GitHub MCP server failed to start
```

Check that `npx` works and can reach the npm registry.

## Resources

- [Claude Agent SDK documentation](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK for TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [ESLint MCP server](https://eslint.org/docs/latest/use/mcp)
- [Zod](https://zod.dev/)
