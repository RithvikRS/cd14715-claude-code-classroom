import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';
import { codeQualityAnalyzer, refactoringSuggester, testCoverageAnalyzer } from './agents/index.js';
import { ESLINT_TOOLS, GITHUB_TOOLS, mcpServersConfig } from './config/mcp.config.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import { ReviewReportJSONSchema, ReviewReportSchema } from './types/index.js';
import type { ReviewReport } from './types/index.js';
import { ErrorCodes, RateLimiter, ReviewError, withRetry, withTimeout } from './utils/index.js';
import type { RateLimiterConfig } from './utils/index.js';
import { logAgentStart, logReviewComplete, logReviewError, logReviewStart } from './utils/logger.js';

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  rateLimits?: Partial<RateLimiterConfig>;
  /** Total number of attempts, including the first. */
  maxRetries?: number;
}

const SUBAGENTS: Record<string, AgentDefinition> = {
  'code-quality-analyzer': codeQualityAnalyzer,
  'test-coverage-analyzer': testCoverageAnalyzer,
  'refactoring-suggester': refactoringSuggester
};

// Subagents run under the orchestrator's permissions, so this list also has to
// cover every tool they call.
const ALLOWED_TOOLS = ['Task', 'Skill', 'Read', 'Grep', 'Glob', ...GITHUB_TOOLS, ...ESLINT_TOOLS];

// Rough cost of one PR review. release() replaces it with the real usage.
const ESTIMATED_TOKENS = 10000;

// Each attempt runs three subagents for every changed file.
const TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  readonly rateLimiter: RateLimiter;
  private readonly maxRetries: number;

  constructor(options: OrchestratorOptions = {}) {
    this.rateLimiter = new RateLimiter(options.rateLimits);
    this.maxRetries = options.maxRetries ?? 3;
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startedAt = Date.now();
    logReviewStart(owner, repo, prNumber);

    await this.rateLimiter.acquire(ESTIMATED_TOKENS);
    let tokensUsed: number | undefined;
    try {
      const report = await withRetry(async () => {
        const abortController = new AbortController();
        const result = await withTimeout(
          () => this.runQuery(owner, repo, prNumber, abortController),
          TIMEOUT_MS,
          `Review of ${owner}/${repo}#${prNumber} timed out after ${TIMEOUT_MS / 1000}s`
        ).catch((error: unknown) => {
          // withTimeout only stops waiting. Kill the Claude Code process so it
          // doesn't keep running alongside the next attempt.
          abortController.abort();
          throw error;
        });
        tokensUsed = (tokensUsed ?? 0) + result.usage.input_tokens + result.usage.output_tokens;
        return parseReport(result);
      }, this.maxRetries);

      const finished: ReviewReport = {
        ...report,
        pullRequest: { owner, repo, number: prNumber },
        summary: summarize(report.fileReviews),
        metadata: {
          analyzedAt: new Date().toISOString(),
          duration: Date.now() - startedAt,
          agentVersions: Object.fromEntries(
            Object.entries(SUBAGENTS).map(([name, agent]) => [name, agent.model ?? 'inherit'])
          )
        }
      };

      logReviewComplete(owner, repo, prNumber, finished.summary.overallScore, finished.metadata.duration);
      return finished;
    } catch (error) {
      logReviewError(owner, repo, prNumber, error as Error);
      throw error;
    } finally {
      this.rateLimiter.release(tokensUsed);
    }
  }

  private async runQuery(
    owner: string,
    repo: string,
    prNumber: number,
    abortController: AbortController
  ): Promise<SDKResultMessage> {
    const messages = query({
      prompt: buildOrchestratorPrompt(owner, repo, prNumber),
      options: {
        abortController,
        model: process.env.ANTHROPIC_MODEL,
        // Skills are loaded from .claude/skills under cwd.
        cwd: process.env.PROJECT_ROOT || process.cwd(),
        settingSources: ['project'],
        agents: SUBAGENTS,
        mcpServers: mcpServersConfig,
        allowedTools: ALLOWED_TOOLS,
        permissionMode: 'dontAsk',
        outputFormat: { type: 'json_schema', schema: ReviewReportJSONSchema },
        maxTurns: 50
      }
    });

    for await (const message of messages) {
      if (message.type === 'system' && message.subtype === 'init') {
        const github = message.mcp_servers.find(server => server.name === 'github');
        if (github?.status === 'failed') {
          throw new ReviewError(
            'GitHub MCP server failed to start',
            ErrorCodes.GITHUB_API_ERROR,
            { mcpServers: message.mcp_servers }
          );
        }
      } else if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use' && block.name === 'Task') {
            const input = block.input as AgentInput;
            // The orchestrator prompt gives every subagent a "File: <path>" line.
            const file = /^\s*File: (.+)$/m.exec(input.prompt)?.[1] ?? input.description;
            logAgentStart(input.subagent_type, file);
          }
        }
      } else if (message.type === 'result') {
        return message;
      }
    }

    throw new ReviewError('Review ended without a result message', ErrorCodes.AGENT_FAILED);
  }
}

function parseReport(result: SDKResultMessage): ReviewReport {
  if (result.subtype !== 'success') {
    const details = result.errors.length > 0 ? `: ${result.errors.join('; ')}` : '';
    throw new ReviewError(
      `Review stopped with ${result.subtype}${details}`,
      ErrorCodes.AGENT_FAILED,
      { subtype: result.subtype, errors: result.errors }
    );
  }

  if (result.structured_output === undefined) {
    throw new ReviewError(
      `Review finished without structured output. Final message: ${result.result}`,
      ErrorCodes.STRUCTURED_OUTPUT_FAILED
    );
  }

  const parsed = ReviewReportSchema.safeParse(result.structured_output);
  if (!parsed.success) {
    const paths = parsed.error.issues.slice(0, 3).map(issue => issue.path.join('.'));
    throw new ReviewError(
      `Structured output does not match the report schema at ${paths.join(', ')}`,
      ErrorCodes.VALIDATION_FAILED,
      { issues: parsed.error.issues }
    );
  }

  return parsed.data;
}

function summarize(fileReviews: ReviewReport['fileReviews']): ReviewReport['summary'] {
  const totalScore = fileReviews.reduce((sum, review) => sum + review.codeQuality.overallScore, 0);
  const issues = fileReviews.flatMap(review => review.codeQuality.issues);
  const untestedPaths = fileReviews.flatMap(review => review.testCoverage.untestedPaths);

  return {
    totalFiles: fileReviews.length,
    // Every file was skipped (lockfiles, binaries, deletions), so nothing was marked down.
    overallScore: fileReviews.length > 0 ? Math.round(totalScore / fileReviews.length) : 100,
    criticalIssues: issues.filter(issue => issue.severity === 'critical').length,
    highPriorityTests: untestedPaths.filter(path => path.priority === 'critical' || path.priority === 'high').length,
    refactoringOpportunities: fileReviews.reduce((sum, review) => sum + review.refactorings.suggestions.length, 0)
  };
}
