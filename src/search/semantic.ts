/**
 * Semantic search using pgvector embeddings
 * Generates query embeddings and performs vector similarity search
 */

import { generateEmbeddings } from '../embedding/client.js';
import { db } from '../db/index.js';
import { DEFAULT_SEARCH_LIMIT } from '../constants/index.js';

export interface SemanticSearchOptions {
  query: string;
  limit?: number;
  offset?: number;
  siteId?: string;
  minScore?: number;
}

export interface SemanticSearchResult {
  chunkId: string;
  documentId: string;
  url: string;
  title: string;
  content: string;
  headingPath: string[];
  similarity: number;
}

/**
 * Search using semantic (vector) similarity
 * @param options - Search options
 * @returns Array of semantic search results with similarity scores
 */
export async function semanticSearch(options: SemanticSearchOptions): Promise<SemanticSearchResult[]> {
  const { query, limit = DEFAULT_SEARCH_LIMIT, offset = 0, siteId, minScore = 0 } = options;

  // Generate embedding for the query
  const embeddingResult = await generateEmbeddings([query]);
  const queryVector = embeddingResult[0].embedding;

  // Perform vector similarity search
  const results = await db.vectorSearch(queryVector, { limit, offset, siteId, minScore });

  return results.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    url: r.url,
    title: r.title,
    content: r.content,
    headingPath: r.headingPath ?? [],
    similarity: r.similarity,
  }));
}
