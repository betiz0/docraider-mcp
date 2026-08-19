import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { config } from '../../src/config.js';
import { searchDocuments } from '../../src/search.js';
import { generateAndUpsertEmbeddings } from '../../src/embedding/generate.js';
import { getBackfillStatus, startBackfill } from '../../src/embedding/backfill.js';
import { normalizeUrl } from '../../src/utils/url-normalize.js';

const prefix = `quickstart-${Date.now()}`;

describe.sequential('Quickstart acceptance scenarios', () => {
  let pool: Pool;
  let siteId: string;
  const chunkIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
    });

    const site = await pool.query<{ id: string }>(
      `INSERT INTO sites (base_url, domain, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [`https://${prefix}.example.com`, `${prefix}.example.com`, prefix]
    );
    siteId = site.rows[0].id;

    const fixtures = [
      ['auth-en', 'Authentication', 'authentication secures user sessions and credentials'],
      ['auth-ja', '認証ガイド', '認証システムは利用者の資格情報を検証します'],
      ['running', 'Running services', 'The authenticated service is running correctly'],
      ['fallback', 'Fallback', 'degradation-only-keyword remains searchable without an embedding'],
    ] as const;

    for (const [path, title, content] of fixtures) {
      const document = await pool.query<{ id: string }>(
        `INSERT INTO documents (url, title, content, site_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [`https://${prefix}.example.com/${path}`, title, content, siteId]
      );
      const chunk = await pool.query<{ id: string }>(
        `INSERT INTO document_chunks (document_id, chunk_index, content)
         VALUES ($1, 0, $2) RETURNING id`,
        [document.rows[0].id, content]
      );
      chunkIds.push(chunk.rows[0].id);
    }

    // Leave the fallback fixture without an embedding to verify degradation.
    const embedded = chunkIds.slice(0, 3).map((chunkId, index) => ({
      chunkId,
      content: fixtures[index][2],
    }));
    const generated = await generateAndUpsertEmbeddings(embedded);
    expect(generated.every((result) => result.success)).toBe(true);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM sites WHERE id = $1', [siteId]);
    await pool.end();
  });

  it('1: defaults to hybrid search', async () => {
    const results = await searchDocuments({ query: '認証', siteId });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => ['keyword', 'semantic', 'both'].includes(result.matchType))).toBe(true);
  });

  it('2: semantic/hybrid search finds an English authentication document for 認証', async () => {
    const results = await searchDocuments({ query: '認証', mode: 'hybrid', siteId });
    expect(results.some((result) => result.url.endsWith('/auth-en'))).toBe(true);
  });

  it('3: Japanese keyword search finds the Japanese document', async () => {
    const results = await searchDocuments({ query: '認証', mode: 'keyword', siteId });
    expect(results.some((result) => result.url.endsWith('/auth-ja'))).toBe(true);
  });

  it('4: English word-form search matches authenticated content', async () => {
    const results = await searchDocuments({ query: 'authenticate', mode: 'keyword', siteId });
    expect(results.some((result) => result.url.endsWith('/running'))).toBe(true);
  });

  it('5: rejects an invalid mode', async () => {
    await expect(searchDocuments({ query: 'test', mode: 'fuzzy' as never })).rejects.toThrow('Invalid search mode');
  });

  it('6: clamps limits to 1..100', async () => {
    await expect(searchDocuments({ query: '認証', mode: 'keyword', siteId, limit: -1 })).resolves.toHaveLength(1);
    const results = await searchDocuments({ query: '認証', mode: 'keyword', siteId, limit: 9999 });
    expect(results.length).toBeLessThanOrEqual(100);
  });

  it('7: keyword and hybrid continue with a missing embedding', async () => {
    const keyword = await searchDocuments({ query: 'degradation-only-keyword', mode: 'keyword', siteId });
    const hybrid = await searchDocuments({ query: 'degradation-only-keyword', mode: 'hybrid', siteId });
    expect(keyword.some((result) => result.url.endsWith('/fallback'))).toBe(true);
    expect(hybrid.some((result) => result.url.endsWith('/fallback'))).toBe(true);
  });

  it('8: every result has matchType and a numeric score', async () => {
    const results = await searchDocuments({ query: '認証', siteId });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => typeof result.score === 'number' && Boolean(result.matchType))).toBe(true);
  });

  it('9: URL variants normalize to one persistence key', async () => {
    const variants = [`https://${prefix}.example.com/x`, `https://${prefix}.example.com/x/`];
    for (const url of variants) {
      await pool.query(
        `INSERT INTO documents (url, title, content, site_id) VALUES ($1, 'X', 'X', $2)
         ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title`,
        [normalizeUrl(url), siteId]
      );
    }
    const count = await pool.query<{ count: string }>(
      'SELECT COUNT(*) FROM documents WHERE url = $1',
      [normalizeUrl(variants[0])]
    );
    expect(Number(count.rows[0].count)).toBe(1);
  });

  it('10: a second backfill has no work', async () => {
    const first = await startBackfill();
    if (first.jobId !== 0) {
      let status = await getBackfillStatus(first.jobId);
      for (let attempt = 0; status?.status === 'running' && attempt < 100; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        status = await getBackfillStatus(first.jobId);
      }
      expect(status?.status).toBe('completed');
    }

    const second = await startBackfill();
    expect(second).toMatchObject({ estimatedTotal: 0, status: 'no work' });
  }, 15_000);
});
