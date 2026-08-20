import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('011 backfill worker lease migration', () => {
  const sql = readFileSync(new URL('../../src/db/migrations/011_backfill_worker_lease.sql', import.meta.url), 'utf8');
  it('migrates pending and ownerless running jobs without dropping legacy progress', () => {
    expect(sql).toContain("UPDATE backfill_jobs SET status = 'queued' WHERE status = 'pending'");
    expect(sql).toContain("WHERE status = 'running' AND (worker_id IS NULL OR heartbeat_at IS NULL)");
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS worker_id');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS last_start_error');
  });
});
