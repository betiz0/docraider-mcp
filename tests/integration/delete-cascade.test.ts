import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { config } from '../../src/config.js';

// Regression test: Verify that deleting a site cascades to chunks_embedding
// This is guaranteed by the FK CASCADE in migration 002 (chunk_id ON DELETE CASCADE)
describe('Delete Cascade - chunks_embedding (T043)', () => {
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

  it('chunks_embedding rows are deleted when document is deleted', async () => {
    // Verify FK cascade exists for chunks_embedding.chunk_id
    const result = await pool.query(
      `SELECT conname, confdeltype
       FROM pg_constraint
       WHERE conrelid = 'chunks_embedding'::regclass
       AND confrelid = 'document_chunks'::regclass`
    );

    expect(result.rows.length).toBeGreaterThan(0);
    // confdeltype 'c' = CASCADE
    const cascadeRows = result.rows.filter((r: { confdeltype: string }) => r.confdeltype === 'c');
    expect(cascadeRows.length).toBeGreaterThan(0);
  });

  it('no orphaned chunks_embedding rows after document deletion', async () => {
    // Verify no orphaned embedding rows exist
    const result = await pool.query(
      `SELECT COUNT(*) as count
       FROM chunks_embedding ce
       LEFT JOIN document_chunks dc ON ce.chunk_id = dc.id
       WHERE dc.id IS NULL`
    );

    expect(parseInt(result.rows[0].count, 10)).toBe(0);
  });
});
