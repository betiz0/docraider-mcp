import { describe, expect, it, vi } from 'vitest';
import { evaluateReadiness, getEmbeddingReadiness, probeEmbedding } from '../../src/embedding/readiness.js';
import type { BackfillJob, EmbeddingStats } from '../../src/db/types.js';
import type { DatabaseManager } from '../../src/db/index.js';

const now = new Date('2026-01-01T00:00:00Z');
function job(overrides: Partial<BackfillJob> = {}): BackfillJob {
  return { id: 1, status: 'running', totalChunks: 10, processedChunks: 5, failedChunks: 0, errorMessage: null,
    startedAt: now, completedAt: null, createdAt: now, workerId: 'w', heartbeatAt: now,
    leaseExpiresAt: new Date(now.getTime() + 10_000), attemptCount: 1, lastStartError: null, ...overrides };
}
function stats(overrides: Partial<EmbeddingStats> = {}): EmbeddingStats {
  return { totalChunks: 10, completedCount: 10, pendingCount: 0, failedCount: 0, ...overrides };
}

describe('embedding readiness', () => {
  it('does no endpoint I/O unless probe is explicitly requested', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await getEmbeddingReadiness({ dependencies: { getStats: async () => stats(), latestJob: async () => null, now: () => now } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.probe).toBeNull();
    expect(result.modes.semantic).toMatchObject({ status: 'degraded', reasonCode: 'probe_not_run' });
    fetchSpy.mockRestore();
  });

  it('reports fully available modes after a successful probe', () => {
    const result = evaluateReadiness(stats(), null, now, { checkedAt: now.toISOString(), endpoint: { ok: true, model: 'm', dimensions: 1536, configuredModel: 'm', reportedModel: 'm', expectedDimensions: 1536, observedDimensions: 1536, modelMatch: true, dimensionsMatch: true, error: null }, database: { pgvector: true, schema: true, dimensionsMatch: true, modelMatch: true, expectedDimensions: 1536, observedDimensions: 1536, configuredModel: 'm', observedModels: ['m'], error: null } });
    expect(result.modes.semantic.status).toBe('ready');
    expect(result.modes.hybrid.status).toBe('ready');
    expect(result.coverage.ratio).toBe(1);
  });

  it('reports partial coverage while a live worker runs', () => {
    const result = evaluateReadiness(stats({ completedCount: 4, pendingCount: 6 }), job(), now);
    expect(result.worker.state).toBe('running');
    expect(result.modes.semantic).toMatchObject({ status: 'degraded', recommendedAction: 'wait_for_backfill' });
  });

  it('recommends starting backfill when pending coverage has no worker', () => {
    const result = evaluateReadiness(stats({ completedCount: 0, pendingCount: 10 }), null, now);
    expect(result.worker.state).toBe('idle');
    expect(result.modes.semantic).toMatchObject({ status: 'unavailable', reasonCode: 'embedding_coverage_incomplete', recommendedAction: 'start_backfill' });
  });

  it('detects stale and failed-to-start workers', () => {
    const stale = evaluateReadiness(stats({ completedCount: 2, pendingCount: 8 }), job({ leaseExpiresAt: new Date(now.getTime() - 1) }), now);
    expect(stale.worker.state).toBe('stale');
    expect(stale.modes.semantic.recommendedAction).toBe('restart_worker');
    const queued = evaluateReadiness(stats({ completedCount: 0, pendingCount: 10 }), job({ status: 'queued', workerId: null, heartbeatAt: null, leaseExpiresAt: null, lastStartError: 'spawn failed' }), now);
    expect(queued.modes.semantic.reasonCode).toBe('worker_stale');
  });

  it('keeps hybrid usable when the endpoint is down', () => {
    const result = evaluateReadiness(stats(), null, now, { checkedAt: now.toISOString(), endpoint: { ok: false, model: 'm', dimensions: null, configuredModel: 'm', reportedModel: null, expectedDimensions: 1536, observedDimensions: null, modelMatch: false, dimensionsMatch: false, error: 'offline' }, database: { pgvector: true, schema: true, dimensionsMatch: true, modelMatch: true, expectedDimensions: 1536, observedDimensions: 1536, configuredModel: 'm', observedModels: ['m'], error: null } });
    expect(result.modes.semantic).toMatchObject({ status: 'unavailable', reasonCode: 'embedding_endpoint_unavailable' });
    expect(result.modes.hybrid).toMatchObject({ status: 'degraded', recommendedAction: 'use_keyword_search' });
  });

  it('preserves endpoint failure diagnostics from an active probe', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('connection refused'));
    const database = { query: vi.fn()
      .mockResolvedValueOnce([{ pgvector: true, chunks_table: true, embedding_table: true, status_column: true, vector_type: 'vector(1536)' }])
      .mockResolvedValueOnce([]) } as unknown as DatabaseManager;
    const result = await probeEmbedding({ fetch: fetcher, database, timeoutMs: 100, now: () => now });
    expect(result.endpoint).toMatchObject({ ok: false, error: 'connection refused', configuredModel: 'nomic-embed-text' });
    expect(result.database.error).toBeNull();
  });

  it('probes endpoint and vector schema with a bounded request', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model: 'nomic-embed-text', data: [{ embedding: new Array(1536).fill(0) }] }) });
    const database = { query: vi.fn()
      .mockResolvedValueOnce([{ pgvector: true, chunks_table: true, embedding_table: true, status_column: true, vector_type: 'vector(1536)' }])
      .mockResolvedValueOnce([{ model: 'nomic-embed-text' }]) } as unknown as DatabaseManager;
    const result = await probeEmbedding({ fetch: fetcher, database, timeoutMs: 25, now: () => now });
    expect(result.endpoint.ok).toBe(true);
    expect(result.database).toMatchObject({ pgvector: true, schema: true, dimensionsMatch: true, modelMatch: true, observedDimensions: 1536, observedModels: ['nomic-embed-text'], error: null });
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(result.checkedAt).toBe(now.toISOString());
  });

  it('bounds a stalled database probe and reports the database diagnostic', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model: 'nomic-embed-text', data: [{ embedding: new Array(1536).fill(0) }] }) });
      const database = { query: vi.fn(() => new Promise(() => undefined)) } as unknown as DatabaseManager;
      const pending = probeEmbedding({ fetch: fetcher, database, timeoutMs: 25, now: () => now });
      await vi.advanceTimersByTimeAsync(25);
      const result = await pending;
      expect(result.database).toMatchObject({ pgvector: false, schema: false, error: 'Database probe timed out after 25ms' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports endpoint model and dimension mismatches explicitly', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model: 'other-model', data: [{ embedding: new Array(42).fill(0) }] }) });
    const database = { query: vi.fn()
      .mockResolvedValueOnce([{ pgvector: true, chunks_table: true, embedding_table: true, status_column: true, vector_type: 'vector(768)' }])
      .mockResolvedValueOnce([{ model: 'legacy-model' }]) } as unknown as DatabaseManager;
    const result = await probeEmbedding({ fetch: fetcher, database, timeoutMs: 100, now: () => now });
    expect(result.endpoint).toMatchObject({ ok: false, configuredModel: 'nomic-embed-text', reportedModel: 'other-model', expectedDimensions: 1536, observedDimensions: 42, modelMatch: false, dimensionsMatch: false });
    expect(result.endpoint.error).toContain('configured model nomic-embed-text');
    expect(result.database).toMatchObject({ observedDimensions: 768, dimensionsMatch: false, observedModels: ['legacy-model'], modelMatch: false });
    expect(result.database.error).toContain('expected vector(1536), found vector(768)');
    expect(result.database.error).toContain('stored models: legacy-model');
  });

});
