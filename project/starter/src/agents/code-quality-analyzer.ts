import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { ESLINT_TOOLS, GITHUB_TOOLS } from '../config/mcp.config.js';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/index.js';

export const codeQualityAnalyzer: AgentDefinition = {
  description: 'Reviews one pull request file for security, performance, maintainability and bug-risk issues. Use it for every reviewed file, passing owner, repo, file path, head SHA and patch.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill', ...GITHUB_TOOLS, ...ESLINT_TOOLS],
  // 'inherit' uses ANTHROPIC_MODEL, so Bedrock model IDs work too.
  model: 'inherit'
};
