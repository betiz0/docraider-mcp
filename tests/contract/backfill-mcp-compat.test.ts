import { describe, expect, it, vi } from 'vitest';
import { startBackfill } from '../../src/embedding/backfill.js';

const { stats, latest, create, record } = vi.hoisted(() => ({
  stats: vi.fn(), latest: vi.fn(), create: vi.fn(), record: vi.fn(),
}));
vi.mock('../../src/db/index.js', () => ({ db: { getEmbeddingStats: stats, query: vi.fn() } }));
vi.mock('../../src/embedding/backfill-repository.js', () => ({ PgBackfillRepository: class { latest = latest; createOrGetActive = create; recordStartError = record; } }));

describe('detached backfill acceptance compatibility', () => {
  it('returns the legacy acceptance fields immediately and detaches the worker', async () => {
    stats.mockResolvedValue({ totalChunks: 8, pendingCount: 8, completedCount: 0, failedCount: 0 });
    latest.mockResolvedValue(null);
    create.mockResolvedValue({ id: 42, status: 'queued', totalChunks: 8 });
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ unref }));
    const result = await startBackfill(spawn);
    expect(result).toEqual({ jobId: 42, estimatedTotal: 8, status: 'queued' });
    expect(spawn).toHaveBeenCalledWith(process.execPath, [expect.stringMatching(/backfill-worker\.js$/)], expect.objectContaining({ detached: true, stdio: 'ignore' }));
    expect(unref).toHaveBeenCalled();
  });


  it('records asynchronous child spawn errors while leaving the job queued', async () => {
    stats.mockResolvedValue({ totalChunks: 2, pendingCount: 2, completedCount: 0, failedCount: 0 });
    latest.mockResolvedValue(null);
    create.mockResolvedValue({ id: 10, status: 'queued', totalChunks: 2 });
    let errorListener: ((error: Error) => void) | undefined;
    const child = {
      unref: vi.fn(),
      once: vi.fn((event: 'error', listener: (error: Error) => void) => {
        expect(event).toBe('error');
        errorListener = listener;
      }),
    };

    const result = await startBackfill(() => child);
    errorListener!(new Error('async ENOENT'));
    await vi.waitFor(() => expect(record).toHaveBeenCalledWith(10, 'async ENOENT'));
    expect(result.status).toBe('queued');
  });

  it('leaves a queued job retryable and records synchronous spawn errors', async () => {
    stats.mockResolvedValue({ totalChunks: 2, pendingCount: 2, completedCount: 0, failedCount: 0 });
    latest.mockResolvedValue(null);
    create.mockResolvedValue({ id: 9, status: 'queued', totalChunks: 2 });
    const result = await startBackfill(() => { throw new Error('cannot spawn'); });
    expect(result.status).toBe('queued');
    expect(record).toHaveBeenCalledWith(9, 'cannot spawn');
  });
});
