import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { GITHUB_TOOLS } from '../config/mcp.config.js';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/index.js';

export const testCoverageAnalyzer: AgentDefinition = {
  description: 'Finds the existing tests for one pull request file and lists untested code paths by priority. Use it for every reviewed file, passing owner, repo, file path, head SHA and patch.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill', ...GITHUB_TOOLS],
  // 'inherit' uses ANTHROPIC_MODEL, so Bedrock model IDs work too.
  model: 'inherit'
};
