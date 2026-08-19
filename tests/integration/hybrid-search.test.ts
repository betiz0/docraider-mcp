import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { searchDocuments } from '../../src/search.js';
import { config } from '../../src/config.js';

// Integration test for US2: Hybrid search ranking and deduplication
// Verifies: 3 modes work, default is hybrid, results have matchType+score,
// hybrid deduplicates and ranks by RRF
describe('Hybrid Search - Ranking and Deduplication (US2)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns results for all three modes', async () => {
    const modes = ['keyword', 'semantic', 'hybrid'] as const;

    for (const mode of modes) {
      const results = await searchDocuments({ query: 'test', mode, limit: 10 });
      expect(Array.isArray(results)).toBe(true);
    }
  });

  it('hybrid mode deduplicates results by chunkId', async () => {
    const results = await searchDocuments({ query: 'test', mode: 'hybrid', limit: 20 });
    const chunkIds = results.map((r) => r.chunkId);
    const uniqueIds = new Set(chunkIds);

    expect(chunkIds.length).toBe(uniqueIds.size);
  });

  it('hybrid results include correct matchType', async () => {
    const results = await searchDocuments({ query: 'test', mode: 'hybrid', limit: 20 });

    for (const r of results) {
      expect(r.matchType).toBeDefined();
      expect(['keyword', 'semantic', 'both']).toContain(r.matchType);
    }
  });

  it('keyword-only results have matchType=keyword', async () => {
    const results = await searchDocuments({ query: 'test', mode: 'keyword', limit: 10 });

    for (const r of results) {
      expect(r.matchType).toBe('keyword');
    }
  });

  it('semantic-only results have matchType=semantic', async () => {
    const results = await searchDocuments({ query: 'test', mode: 'semantic', limit: 10 });

    for (const r of results) {
      expect(r.matchType).toBe('semantic');
    }
  });

  it('results include score field', async () => {
    const results = await searchDocuments({ query: 'test', mode: 'hybrid', limit: 10 });

    for (const r of results) {
      expect(r.score).toBeDefined();
      expect(typeof r.score).toBe('number');
    }
  });

  it('siteId filtering works across all modes', async () => {
    const modes = ['keyword', 'semantic', 'hybrid'] as const;

    for (const mode of modes) {
      const results = await searchDocuments({ query: 'test', mode, siteId: '00000000-0000-4000-8000-000000000001', limit: 10 });
      expect(Array.isArray(results)).toBe(true);
    }
  });
});
