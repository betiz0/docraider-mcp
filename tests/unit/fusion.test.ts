import { describe, it, expect } from 'vitest';
import { fuseResults } from '../../src/search/fusion.js';
import { RRF_K } from '../../src/constants/index.js';

describe('RRF Fusion', () => {
  const keywordResults = [
    { chunkId: 'c1', documentId: 'd1', url: 'https://example.com/1', title: 'Doc 1', content: 'authentication methods', headingPath: [], score: 0.9 },
    { chunkId: 'c2', documentId: 'd2', url: 'https://example.com/2', title: 'Doc 2', content: 'login process', headingPath: [], score: 0.7 },
    { chunkId: 'c3', documentId: 'd3', url: 'https://example.com/3', title: 'Doc 3', content: 'password reset', headingPath: [], score: 0.5 },
  ];

  const semanticResults = [
    { chunkId: 'c1', documentId: 'd1', url: 'https://example.com/1', title: 'Doc 1', content: 'authentication methods', headingPath: [], similarity: 0.95 },
    { chunkId: 'c4', documentId: 'd4', url: 'https://example.com/4', title: 'Doc 4', content: 'authorization flow', headingPath: [], similarity: 0.85 },
    { chunkId: 'c5', documentId: 'd5', url: 'https://example.com/5', title: 'Doc 5', content: 'credential management', headingPath: [], similarity: 0.75 },
  ];

  it('fuses keyword and semantic results by RRF score', () => {
    const fused = fuseResults(keywordResults, semanticResults);

    expect(fused).toHaveLength(5);

    // c1 appears in both → should have highest RRF score and matchType 'both'
    const c1 = fused.find((r) => r.chunkId === 'c1');
    expect(c1).toBeDefined();
    expect(c1!.matchType).toBe('both');
    expect(c1!.score).toBeGreaterThan(0);
  });

  it('assigns correct matchType for single-source results', () => {
    const fused = fuseResults(keywordResults, semanticResults);

    const c2 = fused.find((r) => r.chunkId === 'c2');
    expect(c2!.matchType).toBe('keyword');

    const c4 = fused.find((r) => r.chunkId === 'c4');
    expect(c4!.matchType).toBe('semantic');
  });

  it('sorts results by RRF score descending', () => {
    const fused = fuseResults(keywordResults, semanticResults);

    for (let i = 0; i < fused.length - 1; i++) {
      expect(fused[i].score).toBeGreaterThanOrEqual(fused[i + 1].score);
    }
  });

  it('deduplicates results by chunkId', () => {
    const fused = fuseResults(keywordResults, semanticResults);
    const chunkIds = fused.map((r) => r.chunkId);
    const uniqueIds = new Set(chunkIds);

    expect(chunkIds.length).toBe(uniqueIds.size);
    expect(chunkIds.length).toBe(5); // 3 keyword + 3 semantic - 1 duplicate = 5
  });

  it('handles empty keyword results', () => {
    const fused = fuseResults([], semanticResults);
    expect(fused).toHaveLength(3);
    fused.forEach((r) => expect(r.matchType).toBe('semantic'));
  });

  it('handles empty semantic results', () => {
    const fused = fuseResults(keywordResults, []);
    expect(fused).toHaveLength(3);
    fused.forEach((r) => expect(r.matchType).toBe('keyword'));
  });

  it('handles both empty results', () => {
    const fused = fuseResults([], []);
    expect(fused).toHaveLength(0);
  });

  it('uses configurable RRF k constant', () => {
    const fused = fuseResults(keywordResults, semanticResults, RRF_K);
    expect(fused).toHaveLength(5);
  });

  it('includes all required fields in results', () => {
    const fused = fuseResults(keywordResults, semanticResults);

    for (const result of fused) {
      expect(result.chunkId).toBeDefined();
      expect(result.documentId).toBeDefined();
      expect(result.url).toBeDefined();
      expect(result.title).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.score).toBeDefined();
      expect(result.matchType).toBeDefined();
      expect(['keyword', 'semantic', 'both']).toContain(result.matchType);
    }
  });
});
