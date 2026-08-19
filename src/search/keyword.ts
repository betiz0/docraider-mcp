/**
 * PGroonga-based keyword search
 * Uses the &@~ operator for full-text search with automatic Japanese/English tokenization
 */

import { db } from '../db/index.js';
import { config } from '../config.js';
import { DEFAULT_SEARCH_LIMIT } from '../constants/index.js';

export interface KeywordSearchOptions {
  query: string;
  limit?: number;
  offset?: number;
  siteId?: string;
}

export interface KeywordSearchResult {
  chunkId: string;
  documentId: string;
  url: string;
  title: string;
  content: string;
  headingPath: string[];
  score: number;
  highlight: string;
}

/**
 * Search using PGroonga keyword matching
 * @param options - Search options
 * @returns Array of keyword search results with scores and highlights
 */
export async function keywordSearch(options: KeywordSearchOptions): Promise<KeywordSearchResult[]> {
  const { query, limit = DEFAULT_SEARCH_LIMIT, offset = 0, siteId } = options;

  const results = await db.keywordSearch(query, { limit, offset, siteId });

  return results.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    url: r.url,
    title: r.title,
    content: r.content,
    headingPath: r.headingPath ?? [],
    score: r.score,
    highlight: r.highlight,
  }));
}
