import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import pLimit from 'p-limit';
import { createHash } from 'crypto';
import { db, siteRepository } from '../db/index.js';
import { extractContent } from '../extraction/pipeline.js';
import { chunkMarkdown } from '../chunker.js';
import { identifyOrCreateSite } from '../db/site-identification.js';
import type { CrawlOptions, CrawlResult } from './types.js';
import { fetchRobotsTxt, isAllowed } from './robots.js';
import { parseSitemap, isSameDomain } from './sitemap.js';
import {
  DEFAULT_MAX_CHUNK_LENGTH,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_PAGE_TIMEOUT_MS,
  MEMORY_LOG_INTERVAL,
} from '../constants/index.js';
import { config } from '../config.js';
import { sleep, getRandomDelay, getBackoffDelay } from '../utils/delay.js';
import { normalizeUrl } from '../utils/url-normalize.js';
import { enqueueEmbeddingsForChunks } from '../embedding/backfill.js';
import { checkUrl, SsrfError } from '../utils/ssrf-guard.js';
import type { Document } from '../db/types.js';

interface DocumentWithMeta extends Document {
  etag?: string | null;
  lastModified?: string | null;
  contentHash?: string | null;
}

/**
 * Main crawler function that crawls a documentation site
 */
export async function* crawlSite(
  startUrl: string,
  options: CrawlOptions = {}
): AsyncGenerator<CrawlResult> {
  const {
    maxPages = 100,
    maxDepth = 3,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    respectRobots = true,
    sitemapUrl,
  } = options;

  // Identify or create site for this crawl
  const { site } = await identifyOrCreateSite(startUrl);
  const siteId = site.id;

  const limit = pLimit(maxConcurrent);
  const visited = new Set<string>();
  const toVisit: Array<{ url: string; depth: number }> = [{ url: normalizeUrl(startUrl), depth: 0 }];
  const baseDomain = new URL(startUrl).hostname;

  // Fetch robots.txt if required
  let robotsParser: Awaited<ReturnType<typeof fetchRobotsTxt>> = null;
  if (respectRobots) {
    robotsParser = await fetchRobotsTxt(startUrl);
  }

  // Parse sitemap if provided
  if (sitemapUrl) {
    const sitemapUrls = await parseSitemap(sitemapUrl);
    for (const url of sitemapUrls) {
      if (isSameDomain(url, startUrl) && !visited.has(url)) {
        toVisit.push({ url, depth: 0 });
      }
    }
  }

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      userAgent: config.crawler.userAgent,
    });

    let pagesCrawled = 0;

    while (toVisit.length > 0 && pagesCrawled < maxPages) {
      const batch = toVisit.splice(0, maxConcurrent);
      const promises = batch.map(({ url, depth }) =>
        limit(async () => {
          if (visited.has(url) || depth > maxDepth) {
            return null;
          }

          // Check robots.txt
          if (respectRobots && robotsParser && !isAllowed(url, robotsParser)) {
            return { url, success: false, error: 'Blocked by robots.txt', depth } as CrawlResult;
          }

          const normalizedUrl = normalizeUrl(url);
          visited.add(normalizedUrl);
          const result = await crawlPage(context!, normalizedUrl, depth, baseDomain, siteId);
          result.depth = depth; // Add depth to result
          pagesCrawled++;

          // Apply random delay between requests to avoid overwhelming servers
          if (result.success) {
            await sleep(getRandomDelay());
          }

          // Memory monitoring for large crawls
          if (pagesCrawled % MEMORY_LOG_INTERVAL === 0) {
            const mem = process.memoryUsage();
            console.error(`Memory: RSS=${Math.round(mem.rss / 1024 / 1024)}MB, Heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB`);
          }

          return result;
        })
      );

      const results = await Promise.all(promises);

      for (const result of results) {
        if (result) {
          // Add discovered links to the queue
          if (result.discoveredLinks) {
            for (const link of result.discoveredLinks) {
              if (!visited.has(link)) {
                const currentDepth = batch.find(b => b.url === result.url)?.depth ?? 0;
                toVisit.push({ url: link, depth: currentDepth + 1 });
              }
            }
          }
          yield result;
        }
      }
    }

    // Update site's last_crawled_at after successful crawl
    await siteRepository.updateLastCrawledAt(siteId);
  } finally {
    if (context) {
      await context.close();
    }
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Crawls a single page
 */
async function crawlPage(
  context: BrowserContext,
  url: string,
  depth: number,
  baseDomain: string,
  siteId: string
): Promise<CrawlResult> {
  let page: Page | null = null;

  try {
    page = await context.newPage();
    await page.setDefaultTimeout(DEFAULT_PAGE_TIMEOUT_MS);

    // Get existing document to check ETag/Last-Modified
    const existingDoc = await db.getDocumentByUrl(url) as DocumentWithMeta | null;
    const extraHeaders: Record<string, string> = {};

    if (existingDoc) {
      if (existingDoc.etag) {
        extraHeaders['If-None-Match'] = existingDoc.etag;
      }
      if (existingDoc.lastModified) {
        extraHeaders['If-Modified-Since'] = existingDoc.lastModified;
      }
    }

    // Set extra headers if any
    if (Object.keys(extraHeaders).length > 0) {
      await page.setExtraHTTPHeaders(extraHeaders);
    }

    // SSRF guard: validate URL before fetching via Playwright
    try {
      await checkUrl(url);
    } catch (err) {
      if (err instanceof SsrfError) {
        console.error(`[SSRF] Blocked crawl for ${url}: ${err.message}`);
        return { url, success: false, error: err.message, errorType: 'ssrf_blocked' as CrawlResult['errorType'] };
      }
      throw err;
    }

    // Retry with exponential backoff for WAF challenges (202) and rate limits (403, 429)
    // Playwright's page.goto() does not throw on HTTP errors, so we check response.status() directly
    let response: import('playwright').Response | null = null;
    for (let retryCount = 0; retryCount <= config.crawler.maxRetries; retryCount++) {
      response = await page.goto(url, { waitUntil: 'networkidle' });
      const status = response?.status() ?? 0;

      if (status === 200 || status === 304) {
        break;
      }

      if (status === 202 || status === 403 || status === 429) {
        if (retryCount < config.crawler.maxRetries) {
          const delay = getBackoffDelay(retryCount);
          console.error(`[Retry ${retryCount + 1}/${config.crawler.maxRetries}] ${url}: HTTP ${status}, retrying after ${delay}ms`);
          await sleep(delay);
          continue;
        }
      }

      break;
    }

    // メインコンテンツの描画を待機（失敗しても続行）
    await page.waitForSelector('article, main, [role="main"], .content, .doc-content', {
      timeout: 5000,
    }).catch(() => {
      // セレクタが見つからなくても続行
    });

    if (!response) {
      return { url, success: false, error: 'No response received' };
    }

    // Check for 304 Not Modified
    if (response.status() === 304) {
      return { url, success: true, title: existingDoc?.title ?? url };
    }

    if (response.status() !== 200 && response.status() !== 202) {
      // Determine error type based on status code
      let errorType: CrawlResult['errorType'] = 'unknown';
      if (response.status() === 403) errorType = 'forbidden';
      else if (response.status() === 429) errorType = 'rate_limited';
      else if (response.status() === 404) errorType = 'not_found';
      else if (response.status() >= 500) errorType = 'server_error';

      console.error(`[Crawl Error] ${url}: HTTP ${response.status()} (${errorType})`);
      return {
        url,
        success: false,
        error: `HTTP ${response.status()} (${errorType})`,
        statusCode: response.status(),
        errorType,
      };
    }

    // For 202 status, check if HTML content is sufficient (not WAF blocked)
    const html = await page.content();
    if (response.status() === 202 && html.length < 10000) {
      console.error(`[Crawl Error] ${url}: HTTP 202 (waf_blocked) - content too small (${html.length} bytes)`);
      return {
        url,
        success: false,
        error: 'HTTP 202 (waf_blocked) - try llms.txt',
        statusCode: 202,
        errorType: 'waf_blocked',
      };
    }
    const title = await page.title();

    // Extract ETag and Last-Modified from response
    const etag = response.headers()['etag'];
    const lastModified = response.headers()['last-modified'];

    // Calculate content hash
    const contentHash = createHash('sha256').update(html).digest('hex');

    // Check if content has changed
    if (existingDoc) {
      if (existingDoc.contentHash && existingDoc.contentHash === contentHash) {
        // Content unchanged, skip processing
        return { url, success: true, title, documentId: existingDoc.id };
      }
    }

    // Extract content using pipeline
    const extractionResult = extractContent(html, url);

    if ('code' in extractionResult) {
      console.error(`[Crawl Error] ${url}: Extraction failed - ${extractionResult.message}`);
      return {
        url,
        success: false,
        error: extractionResult.message,
        errorType: 'extraction_error',
      };
    }

    // Chunk the markdown content
    const chunks = chunkMarkdown(extractionResult.markdown, DEFAULT_MAX_CHUNK_LENGTH);

    // Normalize URL before saving
    const normalizedUrl = normalizeUrl(url);

    // Save to database
    const documentId = await saveDocument(
      normalizedUrl,
      title,
      extractionResult.markdown,
      contentHash,
      etag,
      lastModified,
      chunks,
      siteId
    );

    // Enqueue embeddings for new chunks (non-blocking)
    try {
      const newChunkIds = await db.query<{ id: string }>(
        `SELECT id FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index`,
        [documentId]
      );
      if (newChunkIds.length > 0) {
        await enqueueEmbeddingsForChunks(newChunkIds.map((c) => c.id));
      }
    } catch (error) {
      // Non-critical: embedding enqueue failure should not block crawl
      console.error(`[Crawl] Failed to enqueue embeddings for doc ${documentId}:`, error);
    }

    // Extract links for further crawling
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => (a as HTMLAnchorElement).href)
        .filter(href => href.startsWith('http'));
    });

    const discoveredLinks: string[] = [];
    for (const link of links) {
      try {
        const normalized = normalizeUrl(link);
        const parsed = new URL(normalized);
        if (parsed.hostname === baseDomain) {
          discoveredLinks.push(normalized);
        }
      } catch {
        // ignore invalid URLs
      }
    }

    return { url, success: true, title, documentId, discoveredLinks };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Crawl Error] ${url}: ${errorMsg}`);
    return {
      url,
      success: false,
      error: errorMsg,
      errorType: 'extraction_error',
    };
  } finally {
    if (page) {
      await page.close();
    }
  }
}

/**
 * Saves a document and its chunks to the database
 */
async function saveDocument(
  url: string,
  title: string,
  content: string,
  contentHash: string,
  etag: string | undefined,
  lastModified: string | undefined,
  chunks: Array<{ content: string; headingPath: string[]; chunkIndex: number }>,
  siteId: string
): Promise<string> {
  return db.transaction(async (client) => {
    // Upsert document
    const result = await client.query(
      `INSERT INTO documents (url, title, content, content_hash, etag, last_modified, last_crawled_at, site_id)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
       ON CONFLICT (url) DO UPDATE SET
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         content_hash = EXCLUDED.content_hash,
         etag = EXCLUDED.etag,
         last_modified = EXCLUDED.last_modified,
         last_crawled_at = NOW(),
         site_id = EXCLUDED.site_id
       RETURNING id`,
      [url, title, content, contentHash, etag, lastModified, siteId]
    );

    const documentId = result.rows[0].id;

    // Delete existing chunks
    await client.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId]);

    // Insert new chunks (PGroonga index handles full-text search, no tsvector needed)
    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO document_chunks (document_id, chunk_index, content, heading_path, embedding_status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [documentId, chunk.chunkIndex, chunk.content, chunk.headingPath]
      );
    }

    return documentId;
  });
}