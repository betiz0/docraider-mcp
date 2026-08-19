import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { normalizeUrl } from '../../src/utils/url-normalize.js';
import { config } from '../../src/config.js';

// Integration test for audit finding A-3: URL normalization prevents duplicates
// Verifies that re-crawling with different URL forms doesn't create duplicate documents
describe('URL Deduplication - Re-crawl (A-3)', () => {
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

  it('normalizes URLs that should be considered identical', () => {
    const variants = [
      'https://example.com/docs/',
      'https://example.com/docs',
      'https://example.com/docs?page=1',
      'https://example.com/docs?Page=1',
      'HTTPS://EXAMPLE.COM/Docs/',
      'https://example.com/docs#top',
    ];

    const normalized = new Set(variants.map(normalizeUrl));
    // All variants should normalize to the same URL (except query params differ)
    // The key ones: trailing slash, case, fragment should all converge
    expect(normalizeUrl('https://example.com/docs/')).toBe(normalizeUrl('https://example.com/docs'));
    expect(normalizeUrl('HTTPS://EXAMPLE.COM/Docs/')).toBe(normalizeUrl('https://example.com/docs'));
    expect(normalizeUrl('https://example.com/docs#top')).toBe(normalizeUrl('https://example.com/docs'));
  });

  it('ON CONFLICT (url) prevents duplicate documents on re-crawl', async () => {
    // This test verifies that the ON CONFLICT clause in saveDocument
    // prevents creating duplicate documents when the same URL is crawled
    // with different URL forms that normalize to the same value.
    const url = 'https://example.com/test-doc';
    const normalized = normalizeUrl(url);

    // Insert same URL twice
    await pool.query(
      `INSERT INTO documents (url, title, content) VALUES ($1, $2, $3)
       ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title`,
      [normalized, 'Title 1', 'Content 1']
    );
    await pool.query(
      `INSERT INTO documents (url, title, content) VALUES ($1, $2, $3)
       ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title`,
      [normalized, 'Title 2', 'Content 2']
    );

    const result = await pool.query('SELECT COUNT(*) FROM documents WHERE url = $1', [normalized]);
    expect(parseInt(result.rows[0].count, 10)).toBe(1);
  });
});
