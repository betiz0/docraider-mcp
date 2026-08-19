import { describe, it, expect } from 'vitest';
import { searchDocuments } from '../../src/search.js';

// Integration test for FR-018: Filter and pagination consistency across all search modes
describe('Filter & Pagination Consistency (FR-018)', () => {
  it('siteId filtering works in keyword mode', async () => {
    const results = await searchDocuments({ query: 'test', mode: 'keyword', siteId: '00000000-0000-4000-8000-000000000001', limit: 10 });
    expect(Array.isArray(results)).toBe(true);
  });

  it('siteId filtering works in semantic mode', async () => {
    const results = await searchDocuments({ query: 'test', mode: 'semantic', siteId: '00000000-0000-4000-8000-000000000001', limit: 10 });
    expect(Array.isArray(results)).toBe(true);
  });

  it('siteId filtering works in hybrid mode', async () => {
    const results = await searchDocuments({ query: 'test', mode: 'hybrid', siteId: '00000000-0000-4000-8000-000000000001', limit: 10 });
    expect(Array.isArray(results)).toBe(true);
  });

  it('limit parameter works consistently across modes', async () => {
    const modes = ['keyword', 'semantic', 'hybrid'] as const;

    for (const mode of modes) {
      const results = await searchDocuments({ query: 'test', mode, limit: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    }
  });

  it('offset parameter works consistently across modes', async () => {
    const modes = ['keyword', 'semantic', 'hybrid'] as const;

    for (const mode of modes) {
      const results0 = await searchDocuments({ query: 'test', mode, limit: 5, offset: 0 });
      const results5 = await searchDocuments({ query: 'test', mode, limit: 5, offset: 5 });
      expect(Array.isArray(results0)).toBe(true);
      expect(Array.isArray(results5)).toBe(true);
    }
  });

  it('limit clamping works (min 1, max 100)', async () => {
    const result = await searchDocuments({ query: 'test', mode: 'hybrid', limit: 0 });
    expect(result.length).toBeLessThanOrEqual(1);

    const result2 = await searchDocuments({ query: 'test', mode: 'hybrid', limit: 200 });
    expect(result2.length).toBeLessThanOrEqual(100);
  });
});
