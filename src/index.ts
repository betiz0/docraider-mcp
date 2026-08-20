import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { db } from './db/index.js';
import { createMcpServer } from './mcp/server.js';
import { applyConfig, loadConfig } from './config.js';

export async function main(): Promise<void> {
  applyConfig(loadConfig().config);
  await db.connect();
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Docraider-MCP server started');
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error('Server error:', error);
    process.exitCode = 1;
  });
}

export { createMcpServer } from './mcp/server.js';
