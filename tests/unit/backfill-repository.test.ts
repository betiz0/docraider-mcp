import { describe, expect, it, vi } from 'vitest';
import { PgBackfillRepository } from '../../src/embedding/backfill-repository.js';
import type { DatabaseManager } from '../../src/db/index.js';

function databaseWithTransaction(responses: Array<{ rows: unknown[] }>) {
  const query = vi.fn(async () => responses.shift() ?? { rows: [] });
  const database = { transaction: async (callback: (client: { query: typeof query }) => Promise<unknown>) => callback({ query }), query: vi.fn() } as unknown as DatabaseManager;
  return { database, query };
}

describe('backfill repository lease protocol', () => {
  it('serializes queue creation with advisory lock and reuses stale active jobs', async () => {
    const stale = { id: 7, status: 'running' };
    const { database, query } = databaseWithTransaction([{ rows: [] }, { rows: [stale] }]);
    const result = await new PgBackfillRepository(database).createOrGetActive(12);
    expect(result).toBe(stale);
    expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(query.mock.calls[1][0]).toContain("status IN ('queued', 'running')");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('claims one row with SKIP LOCKED and increments attempts', async () => {
    const claimed = { id: 4, status: 'running', attemptCount: 2 };
    const { database, query } = databaseWithTransaction([{ rows: [{ id: 4, attemptCount: 1 }] }, { rows: [claimed] }]);
    expect(await new PgBackfillRepository(database).claimNext('worker-a', 5000, 3)).toBe(claimed);
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.mock.calls[1][0]).toContain('attempt_count=attempt_count+1');
    expect(query.mock.calls[1][1]).toEqual([4, 'worker-a', 5000]);
  });

  it('fails an expired job once the attempt limit is reached', async () => {
    const { database, query } = databaseWithTransaction([{ rows: [{ id: 9, attemptCount: 3 }] }, { rows: [] }]);
    expect(await new PgBackfillRepository(database).claimNext('worker-b', 1000, 3)).toBeNull();
    expect(query.mock.calls[1][0]).toContain("status='failed'");
    expect(query.mock.calls[1][1][1]).toContain('Maximum worker attempts');
  });

  it('heartbeats only while the worker owns a live lease', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: 3 }]).mockResolvedValueOnce([]);
    const database = { query, transaction: vi.fn() } as unknown as DatabaseManager;
    const repository = new PgBackfillRepository(database);
    expect(await repository.heartbeat(3, 'owner', 5, 1, 2000)).toBe(true);
    expect(await repository.heartbeat(3, 'other', 6, 1, 2000)).toBe(false);
    expect(query.mock.calls[0][0]).toContain('lease_expires_at > NOW()');
  });
});
