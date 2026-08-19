/**
 * Reciprocal Rank Fusion (RRF) for combining keyword and semantic search results
 * Uses the standard RRF formula: score = Σ 1/(k + rank)
 * where k is a constant (default 60) and rank is the 1-based position
 */

import { RRF_K } from '../constants/index.js';

export interface FusionResult {
  chunkId: string;
  documentId: string;
  url: string;
  title: string;
  content: string;
  headingPath: string[];
  score: number;
  matchType: 'keyword' | 'semantic' | 'both';
}

interface RawResult {
  chunkId: string;
  documentId: string;
  url: string;
  title: string;
  content: string;
  headingPath: string[];
  score: number;
  source: 'keyword' | 'semantic';
}

/**
 * Merge keyword and semantic results using RRF fusion
 * @param keywordResults - Results from keyword search (with rank order)
 * @param semanticResults - Results from semantic search (with rank order)
 * @param k - RRF constant (default 60)
 * @returns Fused results sorted by RRF score, with deduplication
 */
export function fuseResults(
  keywordResults: Array<{
    chunkId: string;
    documentId: string;
    url: string;
    title: string;
    content: string;
    headingPath: string[];
    score: number;
  }>,
  semanticResults: Array<{
    chunkId: string;
    documentId: string;
    url: string;
    title: string;
    content: string;
    headingPath: string[];
    similarity: number;
  }>,
  k: number = RRF_K
): FusionResult[] {
  // Map chunkId -> accumulated RRF score and match type
  const fusionMap = new Map<string, { score: number; matchType: 'keyword' | 'semantic' | 'both' }>();

  // Process keyword results (ranked by position)
  keywordResults.forEach((result, index) => {
    const rank = index + 1;
    const rrfScore = 1 / (k + rank);
    const existing = fusionMap.get(result.chunkId);

    if (existing) {
      existing.score += rrfScore;
      existing.matchType = 'both';
    } else {
      fusionMap.set(result.chunkId, { score: rrfScore, matchType: 'keyword' });
    }
  });

  // Process semantic results (ranked by position)
  semanticResults.forEach((result, index) => {
    const rank = index + 1;
    const rrfScore = 1 / (k + rank);
    const existing = fusionMap.get(result.chunkId);

    if (existing) {
      existing.score += rrfScore;
      existing.matchType = 'both';
    } else {
      fusionMap.set(result.chunkId, { score: rrfScore, matchType: 'semantic' });
    }
  });

  // Build fused results
  const fused: FusionResult[] = [];
  for (const [chunkId, data] of fusionMap) {
    // Find the full result data (prefer keyword for content, fallback to semantic)
    const keywordResult = keywordResults.find((r) => r.chunkId === chunkId);
    const semanticResult = semanticResults.find((r) => r.chunkId === chunkId);
    const result = keywordResult ?? semanticResult;

    if (result) {
      fused.push({
        chunkId,
        documentId: result.documentId,
        url: result.url,
        title: result.title,
        content: result.content,
        headingPath: result.headingPath ?? [],
        score: data.score,
        matchType: data.matchType,
      });
    }
  }

  // Sort by RRF score descending
  fused.sort((a, b) => b.score - a.score);

  return fused;
}
