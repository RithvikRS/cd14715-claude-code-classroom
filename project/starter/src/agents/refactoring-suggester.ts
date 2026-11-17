import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { GITHUB_TOOLS } from '../config/mcp.config.js';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/index.js';

export const refactoringSuggester: AgentDefinition = {
  description: 'Suggests concrete refactorings with before/after snippets for one pull request file. Use it for every reviewed file, passing owner, repo, file path, head SHA and patch.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill', ...GITHUB_TOOLS],
  // 'inherit' uses ANTHROPIC_MODEL, so Bedrock model IDs work too.
  model: 'inherit'
};
