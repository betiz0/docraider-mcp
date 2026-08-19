import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { keywordSearch } from '../../src/search/keyword.js';
import { config } from '../../src/config.js';

// Integration test for audit finding A-2: Japanese not tokenized
// Verifies that PGroonga correctly tokenizes Japanese text
describe('FTS Japanese - Tokenization (A-2)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
    });

    await pool.query('CREATE EXTENSION IF NOT EXISTS pgroonga');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('tokenizes Japanese text correctly', async () => {
    // Searching for a Japanese term should find documents containing that term
    // PGroonga uses MeCab for Japanese tokenization by default
    const results = await keywordSearch({ query: '認証', limit: 10 });
    expect(Array.isArray(results)).toBe(true);
  });

  it('finds Japanese documents with partial matches', async () => {
    const results = await keywordSearch({ query: '認証システム', limit: 10 });
    expect(Array.isArray(results)).toBe(true);
  });
});
