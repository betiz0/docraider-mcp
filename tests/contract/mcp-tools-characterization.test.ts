import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  getDocumentById: vi.fn(),
  getChunksByDocumentId: vi.fn(),
  stdioConstructor: vi.fn(),
}));

vi.mock('../../src/db/index.js', () => ({
  db: {
    connect: mocks.connect,
    getDocumentById: mocks.getDocumentById,
    getChunksByDocumentId: mocks.getChunksByDocumentId,
  },
  siteRepository: {},
}));

vi.mock('../../src/connection-manager.js', () => ({
  ConnectionManager: class {
    async withConnection<T>(operation: () => Promise<T>): Promise<T> {
      return operation();
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    constructor() {
      mocks.stdioConstructor();
    }
  },
}));

import { createMcpServer } from '../../src/mcp/server.js';
import { MCP_TOOL_DEFINITIONS } from '../../src/mcp/tools.js';

describe('public MCP contract characterization', () => {
  let client: Client;
  let closeTransports: (() => Promise<void>) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await closeTransports?.();
    closeTransports = undefined;
  });

  async function connectedClient(): Promise<Client> {
    const server = createMcpServer();
    client = new Client({ name: 'contract-test', version: '1.0.0' }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeTransports = async () => {
      await clientTransport.close();
      await serverTransport.close();
    };
    return client;
  }

  it('locks the names and complete input schemas of all 12 tools', async () => {
    const expected = [
      ['read_and_extract_page', { type: 'object', properties: { url: { type: 'string', description: 'URL to fetch and extract' } }, required: ['url'] }],
      ['crawl_documentation_site', { type: 'object', properties: { url: { type: 'string', description: 'Starting URL for the crawl' }, maxPages: { type: 'number', description: 'Maximum pages to crawl', default: 100 }, maxDepth: { type: 'number', description: 'Maximum crawl depth', default: 3 } }, required: ['url'] }],
      ['search_crawled_docs', { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, limit: { type: 'number', description: 'Maximum results (1-100)', default: 20 }, offset: { type: 'number', description: 'Offset for pagination (non-negative)', default: 0 }, siteId: { type: 'string', description: 'Filter by site ID (optional)' }, mode: { type: 'string', description: 'Search mode: keyword, semantic, or hybrid', enum: ['keyword', 'semantic', 'hybrid'], default: 'hybrid' } }, required: ['query'] }],
      ['crawl_component_docs', { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' }, description: 'List of URLs to crawl' } }, required: ['urls'] }],
      ['get_document', { type: 'object', properties: { documentId: { type: 'string', description: 'Document ID' } }, required: ['documentId'] }],
      ['get_index_stats', { type: 'object', properties: {} }],
      ['list_documents', { type: 'object', properties: { siteId: { type: 'string', description: 'Filter by site ID (optional)' }, limit: { type: 'number', description: 'Maximum results', default: 20 }, offset: { type: 'number', description: 'Offset for pagination', default: 0 }, sortBy: { type: 'string', description: 'Sort field', enum: ['last_crawled_at', 'created_at', 'title'], default: 'last_crawled_at' }, sortOrder: { type: 'string', description: 'Sort order', enum: ['asc', 'desc'], default: 'desc' } } }],
      ['list_sites', { type: 'object', properties: { limit: { type: 'number', description: 'Maximum results', default: 20 }, offset: { type: 'number', description: 'Offset for pagination', default: 0 }, sortBy: { type: 'string', description: 'Sort field', enum: ['last_crawled_at', 'created_at', 'domain', 'name'], default: 'last_crawled_at' }, sortOrder: { type: 'string', description: 'Sort order', enum: ['asc', 'desc'], default: 'desc' } } }],
      ['get_site', { type: 'object', properties: { siteId: { type: 'string', description: 'Site ID' } }, required: ['siteId'] }],
      ['delete_site', { type: 'object', properties: { siteId: { type: 'string', description: 'Site ID' }, confirmDelete: { type: 'boolean', description: 'Confirmation flag (must be true)' } }, required: ['siteId', 'confirmDelete'] }],
      ['backfill_embeddings', { type: 'object', properties: {} }],
      ['get_backfill_status', { type: 'object', properties: { jobId: { type: 'number', description: 'Backfill job ID' } }, required: ['jobId'] }],
    ];

    expect(MCP_TOOL_DEFINITIONS).toHaveLength(12);
    expect(MCP_TOOL_DEFINITIONS.map(({ name, inputSchema }) => [name, inputSchema])).toEqual(expected);

    const connected = await connectedClient();
    const listed = await connected.listTools();
    expect(listed.tools.map(({ name, inputSchema }) => [name, inputSchema])).toEqual(expected);
  });

  it('preserves a representative successful text response', async () => {
    mocks.getDocumentById.mockResolvedValue({ content: '# Stable MCP response' });
    const connected = await connectedClient();

    const result = await connected.callTool({ name: 'get_document', arguments: { documentId: 'doc-1' } });

    expect(result).toEqual({ content: [{ type: 'text', text: '# Stable MCP response' }] });
  });

  it('preserves representative not-found and validation error behavior', async () => {
    mocks.getDocumentById.mockResolvedValue(null);
    const connected = await connectedClient();

    await expect(connected.callTool({ name: 'get_document', arguments: {} })).rejects.toThrow('documentId is required');
    await expect(connected.callTool({ name: 'get_document', arguments: { documentId: 'missing' } })).resolves.toEqual({
      content: [{ type: 'text', text: 'Document not found' }],
    });
  });

  it('does not connect the database or construct stdio transport when the entry module is imported', async () => {
    await import('../../src/index.js');
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.stdioConstructor).not.toHaveBeenCalled();
  });
});
