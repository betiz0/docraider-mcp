import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('backfill chunk idempotency guard', () => {
  it('selects only pending or retryable failed chunks, never completed chunks', () => {
    const source = readFileSync(new URL('../../src/db/index.ts', import.meta.url), 'utf8');
    expect(source).toContain("embedding_status = 'pending' OR (embedding_status = 'failed' AND embedding_attempts < 3)");
    expect(source).not.toContain("WHERE embedding_status IN ('pending', 'failed')");
  });
});
