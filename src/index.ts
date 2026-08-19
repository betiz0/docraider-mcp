import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';
import { ConnectionManager } from './connection-manager.js';
import { db, siteRepository } from './db/index.js';
import { crawlSite } from './crawler/crawler.js';
import { extractContent } from './extraction/pipeline.js';
import { searchDocuments, getSearchCount } from './search.js';
import { DEFAULT_SEARCH_MODE } from './constants/index.js';
import { chunkMarkdown } from './chunker.js';
import { identifyOrCreateSite } from './db/site-identification.js';
import { normalizeUrl } from './utils/url-normalize.js';
import { startBackfill, getBackfillStatus, getEmbeddingStats as getEmbeddingStatsInfo, enqueueEmbeddingsForChunks } from './embedding/backfill.js';
import {
  DEFAULT_MAX_CHUNK_LENGTH,
  SERVER_NAME,
  SERVER_VERSION,
  DEFAULT_MAX_CRAWL_PAGES,
  DEFAULT_CRAWL_MAX_DEPTH,
  DEFAULT_SEARCH_LIMIT,
} from './constants/index.js';
import { config } from './config.js';
import { sleep, getRandomDelay, getBackoffDelay } from './utils/delay.js';
import { checkUrl, SsrfError } from './utils/ssrf-guard.js';

const connectionManager = new ConnectionManager();

const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
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
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'read_and_extract_page': {
      return connectionManager.withConnection(async () => {
        const url = args?.url as string;
        if (!url) {
          throw new Error('URL is required');
        }

        // SSRF guard: validate URL before fetching
        try {
          await checkUrl(url);
        } catch (err) {
          if (err instanceof SsrfError) {
            return {
              content: [{ type: 'text', text: `Error: ${err.message}` }],
            };
          }
          throw err;
        }

        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
          userAgent: config.crawler.userAgent,
        });
        try {
          const page = await context.newPage();

          // Retry with exponential backoff for WAF challenges (202) and rate limits (403, 429)
          let response: import('playwright').Response | null = null;
          for (let retryCount = 0; retryCount <= config.crawler.maxRetries; retryCount++) {
            response = await page.goto(url, { waitUntil: 'networkidle' });
            const status = response?.status() ?? 0;

            if (status === 200) {
              break;
            }

            if (status === 202 || status === 403 || status === 429) {
              if (retryCount < config.crawler.maxRetries) {
                const delay = getBackoffDelay(retryCount);
                console.error(`[Retry ${retryCount + 1}/${config.crawler.maxRetries}] ${url}: HTTP ${status}, retrying after ${delay}ms`);
                await sleep(delay);
                continue;
              }
              return {
                content: [{ type: 'text', text: `Error: HTTP ${status} after ${config.crawler.maxRetries} retries - WAF may be blocking requests` }],
              };
            }

            return {
              content: [{ type: 'text', text: `Error: HTTP ${status}` }],
            };
          }

          // メインコンテンツの描画を待機（失敗しても続行）
          await page.waitForSelector('article, main, [role="main"], .content, .doc-content', {
            timeout: 5000,
          }).catch(() => {
            // セレクタが見つからなくても続行
          });

          const html = await page.content();
          const result = extractContent(html, url);

          if ('code' in result) {
            return {
              content: [{ type: 'text', text: `Error: ${result.message}` }],
            };
          }

          return {
            content: [{ type: 'text', text: result.markdown }],
          };
        } finally {
          await context.close();
          await browser.close();
        }
      });
    }

    case 'crawl_documentation_site': {
      return connectionManager.withConnection(async () => {
        const url = args?.url as string;
        const maxPages = (args?.maxPages as number) ?? DEFAULT_MAX_CRAWL_PAGES;
        const maxDepth = (args?.maxDepth as number) ?? DEFAULT_CRAWL_MAX_DEPTH;

        if (!url) {
          throw new Error('URL is required');
        }

        // SSRF guard: validate start URL before crawling
        try {
          await checkUrl(url);
        } catch (err) {
          if (err instanceof SsrfError) {
            return {
              content: [{ type: 'text', text: `Error: ${err.message}` }],
            };
          }
          throw err;
        }

        const results: string[] = [];
        let successCount = 0;
        let errorCount = 0;

        for await (const result of crawlSite(url, { maxPages, maxDepth })) {
          if (result.success) {
            results.push(`${result.url}: OK (${result.title ?? 'no title'})`);
            successCount++;
          } else {
            const errorDetail = result.statusCode
              ? `HTTP ${result.statusCode} (${result.errorType ?? 'unknown'})`
              : result.error;
            results.push(`${result.url}: Error - ${errorDetail}`);
            console.error(`[Crawl Error] ${result.url}: ${result.error}`);
            errorCount++;
          }
        }

        // Add summary
        const summary = `\n---\nSummary: ${successCount} succeeded, ${errorCount} failed, ${results.length} total`;

        return {
          content: [{ type: 'text', text: results.join('\n') + summary }],
        };
      });
    }

    case 'search_crawled_docs': {
      return connectionManager.withConnection(async () => {
        const query = args?.query as string;
        const limit = Math.min(Math.max((args?.limit as number) ?? DEFAULT_SEARCH_LIMIT, 1), 100);
        const offset = Math.max((args?.offset as number) ?? 0, 0);
        const siteId = args?.siteId as string | undefined;
        const mode = (args?.mode as 'keyword' | 'semantic' | 'hybrid') ?? DEFAULT_SEARCH_MODE;

        if (!query) {
          throw new Error('Query is required');
        }

        const validModes = ['keyword', 'semantic', 'hybrid'];
        if (!validModes.includes(mode)) {
          throw new Error(`Invalid search mode: "${mode}". Must be one of: ${validModes.join(', ')}`);
        }

        const results = await searchDocuments({ query, mode, limit, offset, siteId });
        const total = await getSearchCount(query, mode, siteId);

        const formatted = results
          .map((r) => `# ${r.title}\n${r.url}\n\nmatchType: ${r.matchType}\nscore: ${r.score.toFixed(4)}\n${r.content.slice(0, 500)}`)
          .join('\n\n---\n\n');

        return {
          content: [
            { type: 'text', text: `Found ${total} results (mode: ${mode}):\n\n${formatted}` },
          ],
        };
      });
    }

    case 'crawl_component_docs': {
      return connectionManager.withConnection(async () => {
        const urls = args?.urls as string[];
        if (!urls || urls.length === 0) {
          throw new Error('URLs array is required');
        }

        // SSRF guard: validate all URLs before crawling
        for (const url of urls) {
          try {
            await checkUrl(url);
          } catch (err) {
            if (err instanceof SsrfError) {
              return {
                content: [{ type: 'text', text: `Error: ${err.message} (url: ${url})` }],
              };
            }
            throw err;
          }
        }

        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
          userAgent: config.crawler.userAgent,
        });
        const results: string[] = [];

        try {
          for (const url of urls) {
            const page = await context.newPage();
            try {
              // Retry with exponential backoff for WAF challenges (202) and rate limits (403, 429)
              let response: import('playwright').Response | null = null;
              let lastStatus = 0;

              for (let retryCount = 0; retryCount <= config.crawler.maxRetries; retryCount++) {
                response = await page.goto(url, { waitUntil: 'networkidle' });
                lastStatus = response?.status() ?? 0;

                // Success - break out of retry loop
                if (lastStatus === 200) {
                  break;
                }

                // Retry on WAF challenge (202), forbidden (403), or rate limit (429)
                if (lastStatus === 202 || lastStatus === 403 || lastStatus === 429) {
                  if (retryCount < config.crawler.maxRetries) {
                    const delay = getBackoffDelay(retryCount);
                    console.error(`[Retry ${retryCount + 1}/${config.crawler.maxRetries}] ${url}: HTTP ${lastStatus}, retrying after ${delay}ms`);
                    await sleep(delay);
                    continue;
                  }
                  // Max retries exceeded
                  results.push(`${url}: Error - HTTP ${lastStatus} after ${config.crawler.maxRetries} retries (WAF may be blocking - try llms.txt for neo4j.com)`);
                  break;
                }

                // Non-retryable error (e.g., 404, 500)
                results.push(`${url}: Error - HTTP ${lastStatus}`);
                break;
              }

              // Skip processing if we already added an error result
              if (lastStatus !== 200) {
                await page.close();
                continue;
              }

              // メインコンテンツの描画を待機（失敗しても続行）
              await page.waitForSelector('article, main, [role="main"], .content, .doc-content', {
                timeout: 5000,
              }).catch(() => {
                // セレクタが見つからなくても続行
              });

              const html = await page.content();
              const extraction = extractContent(html, url);

              if ('code' in extraction) {
                results.push(`${url}: Error - ${extraction.message}`);
                continue;
              }

              const title = await page.title();
              const chunks = chunkMarkdown(extraction.markdown, DEFAULT_MAX_CHUNK_LENGTH);

              // Normalize URL before saving
              const normalizedUrl = normalizeUrl(url);

              // Identify or create site for this URL
              const { site } = await identifyOrCreateSite(normalizedUrl, title);

              // Save to database and get document ID
              let savedDocumentId: string | null = null;
              await db.transaction(async (client) => {
                const docResult = await client.query(
                  `INSERT INTO documents (url, title, content, last_crawled_at, site_id)
                   VALUES ($1, $2, $3, NOW(), $4)
                   ON CONFLICT (url) DO UPDATE SET
                     title = EXCLUDED.title,
                     content = EXCLUDED.content,
                     last_crawled_at = NOW(),
                     updated_at = NOW(),
                     site_id = EXCLUDED.site_id
                   RETURNING id`,
                  [normalizedUrl, title || normalizedUrl, extraction.markdown, site.id]
                );
                savedDocumentId = docResult.rows[0].id;

                await client.query('DELETE FROM document_chunks WHERE document_id = $1', [savedDocumentId]);

                // Insert new chunks (PGroonga index handles full-text search, no tsvector needed)
                for (const chunk of chunks) {
                  await client.query(
                    `INSERT INTO document_chunks (document_id, chunk_index, content, heading_path, embedding_status)
                     VALUES ($1, $2, $3, $4, 'pending')`,
                    [savedDocumentId, chunk.chunkIndex, chunk.content, chunk.headingPath ?? null]
                  );
                }
              });

              results.push(`${normalizedUrl}: Extracted ${chunks.length} chunks (site: ${site.id})`);

              // Enqueue embeddings for new chunks (non-blocking)
              if (savedDocumentId) {
                try {
                  const newChunkIds = await db.query<{ id: string }>(
                    `SELECT id FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index`,
                    [savedDocumentId]
                  );
                  if (newChunkIds.length > 0) {
                    await enqueueEmbeddingsForChunks(newChunkIds.map((c) => c.id));
                  }
                } catch (error) {
                  console.error(`[Crawl Component] Failed to enqueue embeddings:`, error);
                }
              }

              // Apply random delay between requests
              await sleep(getRandomDelay());
            } catch (error) {
              results.push(`${url}: Error - ${error instanceof Error ? error.message : String(error)}`);
            } finally {
              await page.close();
            }
          }
        } finally {
          await context.close();
          await browser.close();
        }

        // Add summary
        const successCount = results.filter(r => r.includes('Extracted')).length;
        const errorCount = results.filter(r => r.includes('Error')).length;
        const summary = `\n---\nSummary: ${successCount} succeeded, ${errorCount} failed`;

        return {
          content: [{ type: 'text', text: results.join('\n') + summary }],
        };
      });
    }

    case 'get_document': {
      return connectionManager.withConnection(async () => {
        const documentId = args?.documentId as string;
        if (!documentId) {
          throw new Error('documentId is required');
        }

        const document = await db.getDocumentById(documentId);
        if (!document) {
          return {
            content: [{ type: 'text', text: 'Document not found' }],
          };
        }

        // Return original content if available, otherwise combine chunks
        if (document.content) {
          return {
            content: [{ type: 'text', text: document.content }],
          };
        }

        // Fallback: combine chunks if content is empty
        const chunks = await db.getChunksByDocumentId(documentId);
        const combinedContent = chunks
          .sort((a, b) => a.chunkIndex - b.chunkIndex)
          .map((c) => c.content)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: combinedContent || 'No content available' }],
        };
      });
    }

    case 'get_index_stats': {
      return connectionManager.withConnection(async () => {
        const docCount = await db.query<{ count: string }>('SELECT COUNT(*) as count FROM documents');
        const chunkCount = await db.query<{ count: string }>('SELECT COUNT(*) as count FROM document_chunks');
        const siteCount = await db.query<{ count: string }>('SELECT COUNT(*) as count FROM sites');
        const queueCount = await db.query<{ count: string }>('SELECT COUNT(*) as count FROM crawl_queue');
        const lastCrawlAt = await db.query<{ last_crawled_at: string }>(
          'SELECT MAX(last_crawled_at) as last_crawled_at FROM documents'
        );

        // Get embedding stats
        const embeddingStats = await db.getEmbeddingStats();

        return {
          content: [
            {
              type: 'text',
              text: `Documents: ${docCount[0]?.count ?? 0}\nChunks: ${chunkCount[0]?.count ?? 0}\nSites: ${siteCount[0]?.count ?? 0}\nQueue: ${queueCount[0]?.count ?? 0}\nLast Crawl: ${lastCrawlAt[0]?.last_crawled_at ?? 'N/A'}\n\nEmbedding Stats:\n  Total: ${embeddingStats.totalChunks}\n  Pending: ${embeddingStats.pendingCount}\n  Completed: ${embeddingStats.completedCount}\n  Failed: ${embeddingStats.failedCount}`,
            },
          ],
        };
      });
    }

    case 'list_documents': {
      return connectionManager.withConnection(async () => {
        const siteId = args?.siteId as string | undefined;
        const limit = Math.min((args?.limit as number) ?? 20, 100);
        const offset = (args?.offset as number) ?? 0;
        const sortBy = (args?.sortBy as 'last_crawled_at' | 'created_at' | 'title') ?? 'last_crawled_at';
        const sortOrder = (args?.sortOrder as 'asc' | 'desc') ?? 'desc';

        const result = await db.listDocuments({ siteId, limit, offset, sortBy, sortOrder });

        const formattedDocuments = result.documents.map((doc) => ({
          id: doc.id,
          url: doc.url,
          title: doc.title,
          siteId: doc.siteId,
          siteBaseUrl: doc.siteBaseUrl,
          lastCrawledAt: doc.lastCrawledAt?.toISOString(),
          chunkCount: doc.chunkCount,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  documents: formattedDocuments,
                  total: result.total,
                  limit: result.limit,
                  offset: result.offset,
                },
                null,
                2
              ),
            },
          ],
        };
      });
    }

    case 'list_sites': {
      return connectionManager.withConnection(async () => {
        const limit = Math.min((args?.limit as number) ?? 20, 100);
        const offset = (args?.offset as number) ?? 0;
        const sortBy = (args?.sortBy as 'last_crawled_at' | 'created_at' | 'domain' | 'name') ?? 'last_crawled_at';
        const sortOrder = (args?.sortOrder as 'asc' | 'desc') ?? 'desc';

        const result = await siteRepository.list({ limit, offset, sortBy, sortOrder });

        const formattedSites = result.sites.map((site) => ({
          id: site.id,
          baseUrl: site.baseUrl,
          domain: site.domain,
          name: site.name,
          documentCount: site.documentCount,
          lastCrawledAt: site.lastCrawledAt?.toISOString(),
          createdAt: site.createdAt?.toISOString(),
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  sites: formattedSites,
                  total: result.total,
                  limit: result.limit,
                  offset: result.offset,
                },
                null,
                2
              ),
            },
          ],
        };
      });
    }

    case 'get_site': {
      return connectionManager.withConnection(async () => {
        const siteId = args?.siteId as string;
        if (!siteId) {
          throw new Error('siteId is required');
        }

        const site = await siteRepository.findById(siteId);
        if (!site) {
          return {
            content: [{ type: 'text', text: 'Site not found' }],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: site.id,
                  baseUrl: site.baseUrl,
                  domain: site.domain,
                  name: site.name,
                  documentCount: site.documentCount,
                  lastCrawledAt: site.lastCrawledAt?.toISOString(),
                  createdAt: site.createdAt?.toISOString(),
                  updatedAt: site.updatedAt?.toISOString(),
                },
                null,
                2
              ),
            },
          ],
        };
      });
    }

    case 'delete_site': {
      return connectionManager.withConnection(async () => {
        const siteId = args?.siteId as string;
        const confirmDelete = args?.confirmDelete as boolean;

        if (!siteId) {
          throw new Error('siteId is required');
        }
        if (!confirmDelete) {
          throw new Error('confirmDelete must be true to delete a site');
        }

        const site = await siteRepository.findById(siteId);
        if (!site) {
          return {
            content: [{ type: 'text', text: 'Site not found' }],
          };
        }

        const documentCount = site.documentCount;

        const chunkCountResult = await db.query<{ count: string }>(
          'SELECT COUNT(*) as count FROM document_chunks dc JOIN documents d ON dc.document_id = d.id WHERE d.site_id = $1',
          [siteId]
        );
        const chunkCount = parseInt(chunkCountResult[0].count, 10);

        await siteRepository.delete(siteId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  deleted: true,
                  deletedDocuments: documentCount,
                  deletedChunks: chunkCount,
                },
                null,
                2
              ),
            },
          ],
        };
      });
    }

    case 'backfill_embeddings': {
      return connectionManager.withConnection(async () => {
        const result = await startBackfill();

        if (result.jobId === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message: 'No chunks need embedding',
                  estimatedTotal: 0,
                  status: result.status,
                }, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                jobId: result.jobId,
                estimatedTotal: result.estimatedTotal,
                status: result.status,
                message: `Backfill started. Job ${result.jobId} will process ${result.estimatedTotal} chunks.`,
              }, null, 2),
            },
          ],
        };
      });
    }

    case 'get_backfill_status': {
      return connectionManager.withConnection(async () => {
        const jobId = args?.jobId as number;
        if (!jobId) {
          throw new Error('jobId is required');
        }

        const status = await getBackfillStatus(jobId);
        if (!status) {
          return {
            content: [{ type: 'text', text: `Backfill job ${jobId} not found` }],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  await db.connect();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Docraider-MCP server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});