// Must be the first import: ESM evaluates every import before this module's
// body, and mcp.config.ts reads GITHUB_TOKEN as soon as it loads.
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator, formatError } from './utils/index.js';

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main() {
  const [owner, repo, prStr] = process.argv.slice(2);

  if (!owner || !repo || !prStr) {
    console.error('Usage: npm run dev <owner> <repo> <pr-number>');
    process.exit(1);
  }

  const prNumber = parseInt(prStr, 10);
  if (!/^\d+$/.test(prStr) || prNumber <= 0) {
    console.error(`Invalid PR number "${prStr}": it must be a positive integer.`);
    process.exit(1);
  }

  const useBedrock = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  if (useBedrock) {
    if (!process.env.AWS_REGION) {
      console.error('AWS_REGION must be set when using AWS Bedrock.');
      process.exit(1);
    }
    // The Claude Code process only talks to Bedrock when this is set.
    process.env.CLAUDE_CODE_USE_BEDROCK ??= '1';
    console.log('Using AWS Bedrock authentication');
  } else if (process.env.ANTHROPIC_API_KEY) {
    console.log('Using Anthropic API authentication');
  } else {
    console.error(`No authentication configured. Set one of these:
  - Anthropic API: ANTHROPIC_API_KEY
  - AWS Bedrock:   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION`);
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_MODEL) {
    console.error(`ANTHROPIC_MODEL is not set. Set it to a model ID in your provider's format:
  - Anthropic API: ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
  - AWS Bedrock:   ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0`);
    process.exit(1);
  }

  try {
    const orchestrator = new CodeReviewOrchestrator();
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    const generator = new ReportGenerator();
    const baseName = path.join('reports', `${owner}_${repo}_${prNumber}`);
    const outputs: Array<[string, string]> = [
      [`${baseName}.md`, generator.generateMarkdownReport(report)],
      [`${baseName}.html`, generator.generateHTMLReport(report)],
      [`${baseName}.json`, generator.generateJSONReport(report)]
    ];

    await mkdir('reports', { recursive: true });
    for (const [file, content] of outputs) {
      await writeFile(file, content, 'utf8');
    }

    console.log('\nReports written:');
    for (const [file] of outputs) {
      console.log(`  ${file}`);
    }

    const { summary } = report;
    console.log(
      `\nReviewed ${summary.totalFiles} files: score ${summary.overallScore}/100, ` +
      `${summary.criticalIssues} critical issues, ${summary.highPriorityTests} high-priority test gaps, ` +
      `${summary.refactoringOpportunities} refactoring opportunities.`
    );
  } catch (error) {
    console.error(`Error: ${formatError(error)}`);
    // process.exit() would cut off winston before it writes the failure to logs/.
    process.exitCode = 1;
  }
}

main();
