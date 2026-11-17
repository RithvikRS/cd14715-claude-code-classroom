import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  NonNullableUsage,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage
} from '@anthropic-ai/claude-agent-sdk';
import { CodeReviewOrchestrator } from '../src/orchestrator.js';
import { logAgentStart } from '../src/utils/logger.js';
import { codeQualityAnalyzer, refactoringSuggester, testCoverageAnalyzer } from '../src/agents/index.js';
import { GITHUB_TOOLS, mcpServersConfig } from '../src/config/mcp.config.js';
import { ReviewReportJSONSchema, ReviewReportSchema } from '../src/types/index.js';
import type { ReviewReport } from '../src/types/index.js';
import { ErrorCodes, ReviewError } from '../src/utils/index.js';
import { DEFAULT_RATE_LIMITS } from '../src/utils/rate-limiter.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

// The real logger writes to logs/ in the project and to the console.
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logReviewStart: vi.fn(),
  logReviewComplete: vi.fn(),
  logReviewError: vi.fn(),
  logAgentStart: vi.fn()
}));

/**
 * Tests for CodeReviewOrchestrator
 *
 * The SDK's query() is mocked to replay a fixed list of messages, so no
 * Claude Code process or MCP server is started.
 */

const OWNER = 'acme';
const REPO = 'widgets';
const PR_NUMBER = 42;
const SESSION = { uuid: '00000000-0000-4000-8000-000000000000', session_id: 'test-session' } as const;

const fileReviews: ReviewReport['fileReviews'] = [
  {
    file: 'src/auth.ts',
    codeQuality: {
      file: 'src/auth.ts',
      issues: [
        {
          line: 12,
          severity: 'critical',
          category: 'security',
          description: 'Password is compared with ==, which leaks timing information',
          suggestion: 'Use crypto.timingSafeEqual'
        },
        {
          line: 30,
          severity: 'medium',
          category: 'maintainability',
          description: 'login() mixes validation and persistence',
          suggestion: 'Move validation into its own function'
        }
      ],
      overallScore: 60,
      summary: 'Works, but the password check is unsafe.'
    },
    testCoverage: {
      file: 'src/auth.ts',
      hasTests: true,
      testFiles: ['src/auth.test.ts'],
      untestedPaths: [
        {
          type: 'branch',
          location: 'login() lines 18-22',
          priority: 'critical',
          reasoning: 'The locked-account branch is never exercised',
          suggestedTest: 'it rejects a locked account'
        },
        {
          type: 'function',
          location: 'formatUser() line 40',
          priority: 'low',
          reasoning: 'Simple formatting helper',
          suggestedTest: 'it formats the display name'
        }
      ],
      coverageEstimate: 55,
      summary: 'The happy path is tested; error branches are not.'
    },
    refactorings: {
      file: 'src/auth.ts',
      suggestions: [
        {
          type: 'extract-function',
          location: 'login() lines 25-38',
          impact: 'medium',
          description: 'Extract the validation block',
          before: 'if (!email) { ... }',
          after: 'validateCredentials(email, password);',
          benefits: 'login() reads as a sequence of steps'
        },
        {
          type: 'modernize',
          location: 'loadUser() line 45',
          impact: 'low',
          description: 'Replace the promise chain with async/await',
          before: 'return db.find(id).then(user => user);',
          after: 'return await db.find(id);',
          benefits: 'Easier to follow'
        }
      ],
      summary: 'Two small refactorings.'
    }
  },
  {
    file: 'src/format.ts',
    codeQuality: {
      file: 'src/format.ts',
      issues: [
        {
          line: 5,
          severity: 'high',
          category: 'bug-risk',
          description: 'toFixed() is called on a value that may be undefined',
          suggestion: 'Handle the undefined case first'
        }
      ],
      overallScore: 85,
      summary: 'Small file with one likely bug.'
    },
    testCoverage: {
      file: 'src/format.ts',
      hasTests: false,
      testFiles: [],
      untestedPaths: [
        {
          type: 'edge-case',
          location: 'formatPrice() line 5',
          priority: 'high',
          reasoning: 'Undefined input crashes',
          suggestedTest: 'it returns an empty string for undefined'
        }
      ],
      coverageEstimate: 0,
      summary: 'No tests.'
    },
    refactorings: {
      file: 'src/format.ts',
      suggestions: [
        {
          type: 'simplify',
          location: 'formatPrice() lines 3-9',
          impact: 'low',
          description: 'Collapse the nested ifs into early returns',
          before: 'if (a) { if (b) { ... } }',
          after: 'if (!a) return ""; if (!b) return "";',
          benefits: 'Less nesting'
        }
      ],
      summary: 'One simplification.'
    }
  }
];

// Summary, pullRequest and metadata are deliberately wrong: the orchestrator
// has to replace them.
const modelReport: ReviewReport = {
  pullRequest: { owner: 'someone-else', repo: 'other', number: 1 },
  fileReviews,
  summary: { totalFiles: 99, overallScore: 0, criticalIssues: 0, highPriorityTests: 0, refactoringOpportunities: 0 },
  recommendations: [
    {
      priority: 'critical',
      category: 'security',
      description: 'Use a constant-time comparison for passwords',
      files: ['src/auth.ts']
    }
  ],
  metadata: { analyzedAt: '', duration: 0, agentVersions: {} }
};

function initMessage(githubStatus = 'connected'): SDKSystemMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'user',
    claude_code_version: '2.0.0',
    cwd: process.cwd(),
    tools: [],
    mcp_servers: [
      { name: 'github', status: githubStatus },
      { name: 'eslint', status: 'connected' }
    ],
    model: 'claude-sonnet-4-5-20250929',
    permissionMode: 'dontAsk',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    ...SESSION
  };
}

const usage = { input_tokens: 1200, output_tokens: 300 } as NonNullableUsage;

function successResult(structuredOutput: unknown): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1000,
    duration_api_ms: 800,
    is_error: false,
    num_turns: 6,
    result: 'Done.',
    total_cost_usd: 0.05,
    usage,
    modelUsage: {},
    permission_denials: [],
    structured_output: structuredOutput,
    ...SESSION
  };
}

function errorResult(): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'error_max_turns',
    duration_ms: 1000,
    duration_api_ms: 800,
    is_error: true,
    num_turns: 50,
    total_cost_usd: 0.05,
    usage,
    modelUsage: {},
    permission_denials: [],
    errors: ['Reached maximum number of turns (50)'],
    ...SESSION
  };
}

function mockRun(...messages: SDKMessage[]) {
  vi.mocked(query).mockImplementation(() => {
    async function* replay() {
      yield* messages;
    }
    return replay() as Query;
  });
}

function lastQueryCall() {
  const params = vi.mocked(query).mock.lastCall?.[0];
  if (!params) throw new Error('query() was not called');
  return { prompt: params.prompt, options: params.options ?? {} };
}

// withRetry wraps the final failure in RETRY_EXHAUSTED and keeps the original
// error as metadata.lastError.
async function lastAttemptError(review: Promise<ReviewReport>): Promise<unknown> {
  const error = await review.then(
    () => { throw new Error('Expected the review to fail'); },
    (rejection: unknown) => rejection
  );
  expect(error).toBeInstanceOf(ReviewError);
  expect(error).toHaveProperty('code', ErrorCodes.RETRY_EXHAUSTED);
  return (error as ReviewError).metadata?.lastError;
}

describe('CodeReviewOrchestrator', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    mockRun(initMessage(), successResult(modelReport));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('Configuration', () => {
    it('should initialize with default options', async () => {
      vi.stubEnv('ANTHROPIC_MODEL', 'claude-test-model');
      vi.stubEnv('PROJECT_ROOT', '/srv/review/project');

      const orchestrator = new CodeReviewOrchestrator();
      expect(orchestrator.rateLimiter.getStatus()).toEqual({
        activeRequests: 0,
        requestsInWindow: 0,
        tokensInWindow: 0,
        availableRequests: DEFAULT_RATE_LIMITS.maxRequestsPerMinute,
        availableTokens: DEFAULT_RATE_LIMITS.maxTokensPerMinute
      });

      await orchestrator.reviewPullRequest(OWNER, REPO, PR_NUMBER);

      const { options } = lastQueryCall();
      expect(options.model).toBe('claude-test-model');
      expect(options.cwd).toBe('/srv/review/project');
      expect(options.settingSources).toEqual(['project']);
      expect(options.permissionMode).toBe('dontAsk');
    });

    it('should accept custom rate limit configuration', async () => {
      const orchestrator = new CodeReviewOrchestrator({
        rateLimits: { maxRequestsPerMinute: 10, maxTokensPerMinute: 20000, maxConcurrent: 1 },
        maxRetries: 1
      });
      expect(orchestrator.rateLimiter.getStatus()).toMatchObject({
        availableRequests: 10,
        availableTokens: 20000
      });

      await orchestrator.reviewPullRequest(OWNER, REPO, PR_NUMBER);

      // The review counts against the custom window with the tokens from the result's usage.
      expect(orchestrator.rateLimiter.getStatus()).toEqual({
        activeRequests: 0,
        requestsInWindow: 1,
        tokensInWindow: 1500,
        availableRequests: 9,
        availableTokens: 18500
      });

      await orchestrator.rateLimiter.acquire();
      expect(orchestrator.rateLimiter.canProceed()).toBe(false);
      orchestrator.rateLimiter.release();
    });
  });

  describe('reviewPullRequest', () => {
    it('should fetch PR files from GitHub MCP', async () => {
      await new CodeReviewOrchestrator({ maxRetries: 1 }).reviewPullRequest(OWNER, REPO, PR_NUMBER);

      const { prompt, options } = lastQueryCall();
      expect(options.mcpServers).toBe(mcpServersConfig);
      expect(options.mcpServers).toHaveProperty('github');
      expect(options.allowedTools).toEqual(expect.arrayContaining(GITHUB_TOOLS));
      expect(prompt).toContain('mcp__github__get_pull_request_files');
      expect(prompt).toContain(`owner "${OWNER}", repo "${REPO}" and pull_number ${PR_NUMBER}`);
    });

    it('should spawn all 3 subagents in parallel', async () => {
      await new CodeReviewOrchestrator({ maxRetries: 1 }).reviewPullRequest(OWNER, REPO, PR_NUMBER);

      const { prompt, options } = lastQueryCall();
      expect(options.agents).toEqual({
        'code-quality-analyzer': codeQualityAnalyzer,
        'test-coverage-analyzer': testCoverageAnalyzer,
        'refactoring-suggester': refactoringSuggester
      });
      for (const agent of Object.values(options.agents ?? {})) {
        expect(agent.tools).toContain('Skill');
      }
      expect(options.allowedTools).toContain('Task');
      expect(options.allowedTools).toContain('Skill');
      expect(prompt).toContain('start all three subagents with the Task tool in the same turn so they run in parallel');
    });

    it('should log each subagent the orchestrator starts', async () => {
      const agentNames = ['code-quality-analyzer', 'test-coverage-analyzer', 'refactoring-suggester'];
      // Only the content blocks matter here; the rest of the API message is left out.
      const taskCalls = {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          content: agentNames.map(name => ({
            type: 'tool_use',
            id: `toolu_${name}`,
            name: 'Task',
            input: {
              subagent_type: name,
              description: 'Review src/auth.ts',
              prompt: `Owner: ${OWNER}\nRepo: ${REPO}\nFile: src/auth.ts\nHead SHA: abc123\nPatch:\n@@ -1 +1 @@`
            }
          }))
        },
        ...SESSION
      } as unknown as SDKAssistantMessage;
      mockRun(initMessage(), taskCalls, successResult(modelReport));

      await new CodeReviewOrchestrator({ maxRetries: 1 }).reviewPullRequest(OWNER, REPO, PR_NUMBER);

      expect(vi.mocked(logAgentStart).mock.calls).toEqual(agentNames.map(name => [name, 'src/auth.ts']));
    });

    it('should aggregate results into ReviewReport', async () => {
      const before = Date.now();
      const report = await new CodeReviewOrchestrator({ maxRetries: 1 })
        .reviewPullRequest(OWNER, REPO, PR_NUMBER);

      expect(report.pullRequest).toEqual({ owner: OWNER, repo: REPO, number: PR_NUMBER });
      expect(report.fileReviews).toEqual(fileReviews);
      expect(report.recommendations).toEqual(modelReport.recommendations);
      expect(report.summary).toEqual({
        totalFiles: 2,
        overallScore: 73,
        criticalIssues: 1,
        highPriorityTests: 2,
        refactoringOpportunities: 3
      });

      expect(new Date(report.metadata.analyzedAt).getTime()).toBeGreaterThanOrEqual(before);
      expect(report.metadata.duration).toBeGreaterThanOrEqual(0);
      expect(report.metadata.agentVersions).toEqual({
        'code-quality-analyzer': codeQualityAnalyzer.model,
        'test-coverage-analyzer': testCoverageAnalyzer.model,
        'refactoring-suggester': refactoringSuggester.model
      });
    });

    it('should validate output with Zod schema', async () => {
      const malformed = {
        ...modelReport,
        fileReviews: [{ ...fileReviews[0], codeQuality: { ...fileReviews[0]?.codeQuality, overallScore: 'high' } }]
      };
      mockRun(initMessage(), successResult(malformed));

      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1 });
      const error = await lastAttemptError(orchestrator.reviewPullRequest(OWNER, REPO, PR_NUMBER));

      expect(lastQueryCall().options.outputFormat).toEqual({ type: 'json_schema', schema: ReviewReportJSONSchema });
      expect(error).toBeInstanceOf(ReviewError);
      expect(error).toHaveProperty('code', ErrorCodes.VALIDATION_FAILED);
      expect((error as ReviewError).message).toContain('fileReviews.0.codeQuality.overallScore');
    });

    it('should fail when the run does not end in success', async () => {
      mockRun(initMessage(), errorResult());

      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1 });
      const error = await lastAttemptError(orchestrator.reviewPullRequest(OWNER, REPO, PR_NUMBER));

      expect(error).toHaveProperty('code', ErrorCodes.AGENT_FAILED);
      expect((error as ReviewError).message).toContain('error_max_turns');
      expect((error as ReviewError).message).toContain('Reached maximum number of turns');
      expect(orchestrator.rateLimiter.getStatus().activeRequests).toBe(0);
    });

    it('should fail when the result has no structured output', async () => {
      mockRun(initMessage(), successResult(undefined));

      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1 });
      const error = await lastAttemptError(orchestrator.reviewPullRequest(OWNER, REPO, PR_NUMBER));

      expect(error).toHaveProperty('code', ErrorCodes.STRUCTURED_OUTPUT_FAILED);
    });

    it('should fail when the GitHub MCP server fails to start', async () => {
      mockRun(initMessage('failed'), successResult(modelReport));

      const orchestrator = new CodeReviewOrchestrator({ maxRetries: 1 });
      const error = await lastAttemptError(orchestrator.reviewPullRequest(OWNER, REPO, PR_NUMBER));

      expect(error).toHaveProperty('code', ErrorCodes.GITHUB_API_ERROR);
    });
  });

  describe('Integration', () => {
    // These tests require actual API keys and should be skipped in CI
    it.skip('should review a real small PR', async () => {
      // NOTE: Only run manually with valid API keys
      const actual = await vi.importActual<typeof import('@anthropic-ai/claude-agent-sdk')>(
        '@anthropic-ai/claude-agent-sdk'
      );
      vi.mocked(query).mockImplementation(actual.query);

      // A one-file README change in GitHub's demo repository.
      const report = await new CodeReviewOrchestrator({ maxRetries: 1 })
        .reviewPullRequest('octocat', 'Hello-World', 1);

      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
      expect(report.fileReviews.length).toBeGreaterThan(0);
    }, 10 * 60 * 1000);
  });
});
