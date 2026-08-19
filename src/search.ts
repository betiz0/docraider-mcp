/**
 * Search orchestrator
 * Routes to keyword, semantic, or hybrid (RRF fusion) search based on mode
 */

import { DEFAULT_SEARCH_LIMIT, DEFAULT_SEARCH_MODE, MAX_PAGE_LIMIT, SEARCH_MODES } from './constants/index.js';
import type { SearchMode, HybridSearchResult } from './db/types.js';
import { keywordSearch } from './search/keyword.js';
import { semanticSearch } from './search/semantic.js';
import { fuseResults } from './search/fusion.js';

export interface SearchOptions {
  query: string;
  mode?: SearchMode;
  limit?: number;
  offset?: number;
  siteId?: string;
}

/**
 * Execute search with the specified mode
 * @param options - Search options including query, mode, limit, offset, siteId
 * @returns Array of hybrid search results with matchType and score
 */
export async function searchDocuments(options: SearchOptions): Promise<HybridSearchResult[]> {
  const {
    query,
    mode = DEFAULT_SEARCH_MODE,
    limit = DEFAULT_SEARCH_LIMIT,
    offset = 0,
    siteId,
  } = options;

  if (!SEARCH_MODES.includes(mode)) {
    throw new Error(`Invalid search mode: ${mode}. Expected one of: ${SEARCH_MODES.join(', ')}`);
  }

  // Clamp pagination to valid ranges
  const clampedLimit = Math.min(Math.max(limit, 1), MAX_PAGE_LIMIT);
  const clampedOffset = Math.max(offset, 0);

  switch (mode) {
    case 'keyword':
      return keywordToHybridResults(await keywordSearch({ query, limit: clampedLimit, offset: clampedOffset, siteId }));

    case 'semantic':
      try {
        return semanticToHybridResults(await semanticSearch({ query, limit: clampedLimit, offset: clampedOffset, siteId }));
      } catch {
        // No embeddings available: return empty results (not error)
        return [];
      }

    case 'hybrid':
    default:
      return hybridSearch({ query, limit: clampedLimit, offset: clampedOffset, siteId });
  }
}

/**
 * Hybrid search: combine keyword + semantic using RRF fusion
 * Implements graceful degradation (FR-011/012):
 * - If semantic search fails or returns empty, fall back to keyword results
 * - Semantic-only mode returns empty results (not error) when no embeddings exist
 */
async function hybridSearch(options: {
  query: string;
  limit: number;
  offset: number;
  siteId?: string;
}): Promise<HybridSearchResult[]> {
  const { query, limit, offset, siteId } = options;

  // Retrieve enough candidates before applying pagination to the fused ranking.
  const candidateLimit = limit + offset;

  // Run keyword search (always available)
  const keywordResults = await keywordSearch({ query, limit: candidateLimit, offset: 0, siteId });

  // Run semantic search (may fail or return empty if no embeddings)
  let semanticResults: Array<{
    chunkId: string;
    documentId: string;
    url: string;
    title: string;
    content: string;
    headingPath: string[];
    similarity: number;
  }> = [];

  try {
    semanticResults = await semanticSearch({ query, limit: candidateLimit, offset: 0, siteId });
  } catch {
    // Semantic search failed (e.g., no embeddings, API error)
    // Fall back to keyword-only results
    const fallback = keywordToHybridResults(keywordResults);
    return fallback.slice(offset, offset + limit);
  }

  // If semantic returned empty, return keyword results as fallback
  if (semanticResults.length === 0) {
    const fallback = keywordToHybridResults(keywordResults);
    return fallback.slice(offset, offset + limit);
  }

  // Fuse results using RRF
  const fused = fuseResults(keywordResults, semanticResults);

  // Apply offset after fusion
  const offsetResults = fused.slice(offset, offset + limit);

  return offsetResults;
}

/**
 * Convert keyword search results to HybridSearchResult format
 */
function keywordToHybridResults(
  results: Array<{
    chunkId: string;
    documentId: string;
    url: string;
    title: string;
    content: string;
    headingPath: string[];
    score: number;
    highlight: string;
  }>
): HybridSearchResult[] {
  return results.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    url: r.url,
    title: r.title,
    content: r.content,
    headingPath: r.headingPath,
    score: r.score,
    matchType: 'keyword',
  }));
}

/**
 * Convert semantic search results to HybridSearchResult format
 */
function semanticToHybridResults(
  results: Array<{
    chunkId: string;
    documentId: string;
    url: string;
    title: string;
    content: string;
    headingPath: string[];
    similarity: number;
  }>
): HybridSearchResult[] {
  return results.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    url: r.url,
    title: r.title,
    content: r.content,
    headingPath: r.headingPath,
    score: r.similarity,
    matchType: 'semantic',
  }));
}

/**
 * Get total count of matching results for pagination
 * For hybrid mode, returns the sum of keyword and semantic counts
 */
export async function getSearchCount(query: string, mode: SearchMode = 'hybrid', siteId?: string): Promise<number> {
  // Keyword count is the pagination baseline. Counting unique hybrid results would
  // require running and materializing both ranked result sets.
  const whereClause = siteId ? 'AND d.site_id = $1' : '';
  const queryParam = siteId ? 2 : 1;

  const results = await (await import('./db/index.js')).db.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM document_chunks dc
     JOIN documents d ON dc.document_id = d.id
     WHERE dc.content &@~ $${queryParam}
       ${whereClause}`,
    siteId ? [siteId, query] : [query]
  );

  return parseInt(results[0]?.count ?? '0', 10);
}
