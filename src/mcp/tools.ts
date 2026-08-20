import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/** Stable public MCP tool contract. Keep additions/changes intentional and contract-tested. */
export const MCP_TOOL_DEFINITIONS = [
      {
        name: 'read_and_extract_page',
        description: 'Fetch a URL and extract its readable content as Markdown',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to fetch and extract' },
          },
          required: ['url'],
        },
      },
      {
        name: 'crawl_documentation_site',
        description: 'Crawl a documentation site starting from a URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Starting URL for the crawl' },
            maxPages: { type: 'number', description: 'Maximum pages to crawl', default: 100 },
            maxDepth: { type: 'number', description: 'Maximum crawl depth', default: 3 },
          },
          required: ['url'],
        },
      },
      {
        name: 'search_crawled_docs',
        description: 'Search crawled documentation content (keyword, semantic, or hybrid)',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Maximum results (1-100)', default: 20 },
            offset: { type: 'number', description: 'Offset for pagination (non-negative)', default: 0 },
            siteId: { type: 'string', description: 'Filter by site ID (optional)' },
            mode: {
              type: 'string',
              description: 'Search mode: keyword, semantic, or hybrid',
              enum: ['keyword', 'semantic', 'hybrid'],
              default: 'hybrid',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'crawl_component_docs',
        description: 'Crawl documentation for specific components',
        inputSchema: {
          type: 'object',
          properties: {
            urls: { type: 'array', items: { type: 'string' }, description: 'List of URLs to crawl' },
          },
          required: ['urls'],
        },
      },
      {
        name: 'get_document',
        description: 'Get a document by its ID',
        inputSchema: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'Document ID' },
          },
          required: ['documentId'],
        },
      },
      {
        name: 'get_index_stats',
        description: 'Get statistics about the crawled index',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'list_documents',
        description: 'List crawled documents with pagination',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Filter by site ID (optional)' },
            limit: { type: 'number', description: 'Maximum results', default: 20 },
            offset: { type: 'number', description: 'Offset for pagination', default: 0 },
            sortBy: { type: 'string', description: 'Sort field', enum: ['last_crawled_at', 'created_at', 'title'], default: 'last_crawled_at' },
            sortOrder: { type: 'string', description: 'Sort order', enum: ['asc', 'desc'], default: 'desc' },
          },
        },
      },
      {
        name: 'list_sites',
        description: 'List crawled sites with pagination',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum results', default: 20 },
            offset: { type: 'number', description: 'Offset for pagination', default: 0 },
            sortBy: { type: 'string', description: 'Sort field', enum: ['last_crawled_at', 'created_at', 'domain', 'name'], default: 'last_crawled_at' },
            sortOrder: { type: 'string', description: 'Sort order', enum: ['asc', 'desc'], default: 'desc' },
          },
        },
      },
      {
        name: 'get_site',
        description: 'Get a specific site by ID',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Site ID' },
          },
          required: ['siteId'],
        },
      },
      {
        name: 'delete_site',
        description: 'Delete a site and all its documents',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Site ID' },
            confirmDelete: { type: 'boolean', description: 'Confirmation flag (must be true)' },
          },
          required: ['siteId', 'confirmDelete'],
        },
      },
      {
        name: 'backfill_embeddings',
        description: 'Start async backfill to generate embeddings for existing chunks. Returns immediately with jobId.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_backfill_status',
        description: 'Get the status of an embedding backfill job',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'number', description: 'Backfill job ID' },
          },
          required: ['jobId'],
        },
      },
    ] satisfies Tool[];
