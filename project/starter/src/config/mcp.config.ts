/**
 * Model Context Protocol (MCP) server configurations
 *
 * Required MCP Servers:
 * 1. GitHub - For PR/repo operations
 * 2. ESLint - For code linting and style analysis
 *
 * Documentation:
 * - MCP Protocol: https://modelcontextprotocol.io
 * - GitHub MCP: https://github.com/github/github-mcp-server
 * - ESLint MCP: https://eslint.org/docs/latest/use/mcp
 */

import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

// On Windows npx is a .cmd shim, which can't be spawned without going through cmd.
const npx = (...args: string[]) =>
  process.platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'npx', ...args] }
    : { command: 'npx', args };

export const mcpServersConfig = {
  /**
   * GitHub MCP Server
   * Provides tools for GitHub API operations
   *
   * GITHUB_TOKEN is optional (recommended for private repos and higher rate limits).
   * The server expects it as GITHUB_PERSONAL_ACCESS_TOKEN.
   */
  github: {
    type: 'stdio',
    ...npx('-y', '@modelcontextprotocol/server-github'),
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || '' }
  },

  /**
   * ESLint MCP Server
   * Provides tools for linting and code quality analysis
   */
  eslint: {
    type: 'stdio',
    ...npx('-y', '@eslint/mcp@latest'),
    env: {}
  }
} satisfies Record<string, McpServerConfig>;

export const GITHUB_TOOLS = [
  'mcp__github__get_pull_request',
  'mcp__github__get_pull_request_files',
  'mcp__github__get_file_contents',
  'mcp__github__search_code'
];

export const ESLINT_TOOLS = ['mcp__eslint__lint-files'];
