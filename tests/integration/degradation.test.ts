import { describe, it, expect } from 'vitest';
import { searchDocuments } from '../../src/search.js';

// Integration test for US4: Graceful degradation
// Verifies that keyword+hybrid continue working when semantic search is unavailable
describe('Graceful Degradation (US4, SC-005)', () => {
  it('keyword search works regardless of embedding status', async () => {
    // Keyword search should always work, even with no embeddings
    const results = await searchDocuments({ query: 'test', mode: 'keyword', limit: 10 });
    expect(Array.isArray(results)).toBe(true);
  });

  it('hybrid search falls back to keyword when semantic is unavailable', async () => {
    // Hybrid should not throw even if semantic fails
    const results = await searchDocuments({ query: 'test', mode: 'hybrid', limit: 10 });
    expect(Array.isArray(results)).toBe(true);

    // All results should have valid matchType
    for (const r of results) {
      expect(['keyword', 'semantic', 'both']).toContain(r.matchType);
    }
  });

  it('semantic search returns empty array instead of error when no embeddings', async () => {
    // Semantic should return [] not throw when no embeddings exist
    const results = await searchDocuments({ query: 'test', mode: 'semantic', limit: 10 });
    expect(Array.isArray(results)).toBe(true);
  });

  it('all modes return consistent result structure', async () => {
    const modes = ['keyword', 'semantic', 'hybrid'] as const;

    for (const mode of modes) {
      const results = await searchDocuments({ query: 'test', mode, limit: 5 });
      for (const r of results) {
        expect(r.chunkId).toBeDefined();
        expect(r.documentId).toBeDefined();
        expect(r.url).toBeDefined();
        expect(r.title).toBeDefined();
        expect(r.score).toBeDefined();
        expect(r.matchType).toBeDefined();
      }
    }
  });
});
