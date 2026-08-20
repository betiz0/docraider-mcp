import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'node:fs';
import { config } from '../../src/config.js';
import { PgBackfillRepository } from '../../src/embedding/backfill-repository.js';
import type { DatabaseManager } from '../../src/db/index.js';

const schema = `backfill_lease_${process.pid}_${Date.now()}`;
let admin: Pool;
let pool: Pool;
let available = false;

class TestDatabase {
  async query<T extends object = object>(text: string, params?: unknown[]): Promise<T[]> {
    return (await pool.query<T>(text, params)).rows;
  }
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

const connection = {
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
};

beforeAll(async () => {
  admin = new Pool({ ...connection, connectionTimeoutMillis: 1000 });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ ...connection, options: `-c search_path=${schema}`, max: 10 });
    for (const migration of ['010_backfill_jobs.sql', '011_backfill_worker_lease.sql']) {
      await pool.query(readFileSync(new URL(`../../src/db/migrations/${migration}`, import.meta.url), 'utf8'));
    }
    available = true;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  if (pool) await pool.end();
  if (admin) {
    if (available) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

async function repository(): Promise<PgBackfillRepository> {
  if (!available) throw new Error('PostgreSQL integration database is unavailable');
  await pool.query('TRUNCATE backfill_jobs RESTART IDENTITY');
  return new PgBackfillRepository(new TestDatabase() as unknown as DatabaseManager);
}

// These tests use separate PostgreSQL connections and exercise real row locks,
// timestamps, and transaction visibility. Start docker-compose.test.yml and set
// DOCRAIDER_DB_PORT=55432 when PostgreSQL is not on the configured default port.
describe.sequential('PostgreSQL backfill lease integration', () => {
  it('allows exactly one worker to claim a queued job concurrently', async (ctx) => {
    if (!available) return ctx.skip();
    const repo = await repository();
    await repo.createOrGetActive(1);
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => repo.claimNext(`worker-${i}`, 10_000)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.filter(Boolean)[0]!.attemptCount).toBe(1);
  });

  it('heartbeat extends a live lease and rejects another owner', async (ctx) => {
    if (!available) return ctx.skip();
    const repo = await repository();
    await repo.createOrGetActive(2);
    const claimed = (await repo.claimNext('owner', 500))!;
    const originalExpiry = claimed.leaseExpiresAt!.getTime();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await repo.heartbeat(claimed.id, 'owner', 1, 0, 2_000)).toBe(true);
    expect(await repo.heartbeat(claimed.id, 'intruder', 1, 0, 2_000)).toBe(false);
    expect((await repo.get(claimed.id))!.leaseExpiresAt!.getTime()).toBeGreaterThan(originalExpiry);
  });

  it('reclaims a job after the previous worker lease expires', async (ctx) => {
    if (!available) return ctx.skip();
    const repo = await repository();
    await repo.createOrGetActive(1);
    const first = (await repo.claimNext('crashed', 20))!;
    await new Promise((resolve) => setTimeout(resolve, 40));
    const reclaimed = await repo.claimNext('replacement', 1_000);
    expect(reclaimed?.id).toBe(first.id);
    expect(reclaimed?.workerId).toBe('replacement');
    expect(reclaimed?.attemptCount).toBe(2);
  });

  it('fails an expired job instead of exceeding the attempt limit', async (ctx) => {
    if (!available) return ctx.skip();
    const repo = await repository();
    const job = await repo.createOrGetActive(1);
    await pool.query(`UPDATE backfill_jobs SET status='running', worker_id='dead',
      attempt_count=3, lease_expires_at=NOW() - INTERVAL '1 second' WHERE id=$1`, [job.id]);
    expect(await repo.claimNext('fourth', 1_000, 3)).toBeNull();
    const failed = await repo.get(job.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.attemptCount).toBe(3);
    expect(failed?.errorMessage).toContain('Maximum worker attempts (3) exceeded');
  });

  it('the production chunk selection query never returns completed chunks', async (ctx) => {
    if (!available) return ctx.skip();
    await pool.query(`CREATE TABLE document_chunks (
      id UUID PRIMARY KEY, content TEXT NOT NULL, embedding_status TEXT NOT NULL,
      embedding_attempts INT NOT NULL DEFAULT 0, embedding_updated_at TIMESTAMPTZ)`);
    await pool.query(`INSERT INTO document_chunks(id, content, embedding_status, embedding_attempts) VALUES
      ('00000000-0000-4000-8000-000000000001', 'done', 'completed', 1),
      ('00000000-0000-4000-8000-000000000002', 'pending', 'pending', 0),
      ('00000000-0000-4000-8000-000000000003', 'retry', 'failed', 2),
      ('00000000-0000-4000-8000-000000000004', 'exhausted', 'failed', 3)`);
    const source = readFileSync(new URL('../../src/db/index.ts', import.meta.url), 'utf8');
    const match = source.match(/`SELECT id, content\s+FROM document_chunks[\s\S]*?FOR UPDATE SKIP LOCKED`/);
    expect(match).not.toBeNull();
    const rows = await pool.query<{ content: string }>(match![0].slice(1, -1), [10]);
    expect(rows.rows.map((row) => row.content).sort()).toEqual(['pending', 'retry']);
  });
});
