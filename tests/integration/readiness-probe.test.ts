import { afterAll, describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import { DatabaseManager } from '../../src/db/index.js';
import { probeEmbedding } from '../../src/embedding/readiness.js';

// Requires the normal integration PostgreSQL fixture with migrations applied.
describe('embedding readiness probe', () => {
  const database = new DatabaseManager();

  afterAll(async () => {
    await database.disconnect();
  });

  it('checks the real pgvector schema while keeping the endpoint deterministic', async () => {
    const fetcher = async () => new Response(JSON.stringify({
      model: config.embedding.model,
      data: [{ embedding: new Array(config.embedding.dimensions).fill(0) }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const result = await probeEmbedding({ database, fetch: fetcher as typeof fetch, timeoutMs: 2_000 });

    expect(Date.parse(result.checkedAt)).not.toBeNaN();
    expect(result.endpoint).toMatchObject({
      ok: true,
      configuredModel: config.embedding.model,
      reportedModel: config.embedding.model,
      expectedDimensions: config.embedding.dimensions,
      observedDimensions: config.embedding.dimensions,
    });
    expect(result.database).toMatchObject({
      pgvector: true,
      schema: true,
      dimensionsMatch: true,
      expectedDimensions: config.embedding.dimensions,
      observedDimensions: config.embedding.dimensions,
    });
  });
});
