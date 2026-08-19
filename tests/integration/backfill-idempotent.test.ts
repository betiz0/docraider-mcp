import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { startBackfill, getBackfillStatus } from '../../src/embedding/backfill.js';
import { config } from '../../src/config.js';

// Integration test for US3: Backfill idempotency (SC-007)
// Verifies that running backfill twice results in 0 reprocessed chunks on second run
describe('Backfill Idempotency (US3, SC-007)', () => {
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

  it('second backfill run processes 0 chunks when first completed', async () => {
    // First run
    const result1 = await startBackfill();

    if (result1.jobId === 0) {
      // No work to do
      expect(result1.estimatedTotal).toBe(0);
      return;
    }

    // Wait for job to complete (poll status)
    let status = await getBackfillStatus(result1.jobId);
    let attempts = 0;
    while (status && status.status === 'running' && attempts < 60) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      status = await getBackfillStatus(result1.jobId);
      attempts++;
    }

    // Second run should find no work
    const result2 = await startBackfill();
    expect(result2.estimatedTotal).toBe(0);
    expect(result2.status).toBe('no work');
  });

  it('backfill job status transitions correctly', async () => {
    const result = await startBackfill();

    if (result.jobId === 0) {
      return;
    }

    let status = await getBackfillStatus(result.jobId);
    expect(status).not.toBeNull();
    expect(status!.status).toBeDefined();

    // Wait for completion
    let attempts = 0;
    while (status && status.status === 'running' && attempts < 60) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      status = await getBackfillStatus(result.jobId);
      attempts++;
    }

    // Final status should be completed or failed
    expect(status).not.toBeNull();
    expect(['completed', 'failed']).toContain(status!.status);
  });
});
