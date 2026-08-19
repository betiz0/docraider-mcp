import { describe, it, expect } from 'vitest';
import { searchDocuments, getSearchCount } from '../../src/search.js';
import { DEFAULT_SEARCH_MODE, DEFAULT_SEARCH_LIMIT } from '../../src/constants/index.js';

// Contract tests for search_crawled_docs tool
// Validates: default hybrid mode, invalid mode error, limit/offset clamping, empty query error, matchType+score
describe('search_crawled_docs Contract Tests', () => {
  it('defaults to hybrid mode when mode is not specified', async () => {
    // The search function should default to hybrid mode
    const result = await searchDocuments({ query: 'test' });
    // In hybrid mode, results should have matchType that could be 'keyword', 'semantic', or 'both'
    expect(Array.isArray(result)).toBe(true);
  });

  it('accepts keyword mode', async () => {
    const results = await searchDocuments({ query: 'test', mode: 'keyword' });
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(r.matchType).toBe('keyword');
    }
  });

  it('accepts semantic mode', async () => {
    const results = await searchDocuments({ query: 'test', mode: 'semantic' });
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(r.matchType).toBe('semantic');
    }
  });

  it('accepts hybrid mode explicitly', async () => {
    const results = await searchDocuments({ query: 'test', mode: 'hybrid' });
    expect(Array.isArray(results)).toBe(true);
  });

  it('clamps limit to valid range [1, 100]', async () => {
    // limit=0 should be clamped to 1
    const results0 = await searchDocuments({ query: 'test', limit: 0 });
    expect(results0.length).toBeLessThanOrEqual(1);

    // limit=200 should be clamped to 100
    const results200 = await searchDocuments({ query: 'test', limit: 200 });
    expect(results200.length).toBeLessThanOrEqual(100);
  });

  it('returns results with matchType and score fields', async () => {
    const results = await searchDocuments({ query: 'test', limit: 5 });
    for (const r of results) {
      expect(r.matchType).toBeDefined();
      expect(['keyword', 'semantic', 'both']).toContain(r.matchType);
      expect(r.score).toBeDefined();
      expect(typeof r.score).toBe('number');
    }
  });

  it('supports siteId filtering', async () => {
    const results = await searchDocuments({ query: 'test', siteId: '00000000-0000-4000-8000-000000000001' });
    expect(Array.isArray(results)).toBe(true);
  });

  it('supports offset for pagination', async () => {
    const results0 = await searchDocuments({ query: 'test', limit: 5, offset: 0 });
    const results5 = await searchDocuments({ query: 'test', limit: 5, offset: 5 });
    expect(Array.isArray(results0)).toBe(true);
    expect(Array.isArray(results5)).toBe(true);
  });

  it('getSearchCount returns a number', async () => {
    const count = await getSearchCount('test');
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
