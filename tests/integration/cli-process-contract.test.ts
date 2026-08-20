import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';

const node = process.execPath;
const productionEntry = new URL('../../dist/cli/entry.js', import.meta.url).pathname;
const seamEntry = new URL('../../dist/cli/process-test-entry.js', import.meta.url).pathname;
const dockerPort = Number(process.env.DOCRAIDER_DOCKER_DB_PORT ?? 55432);
const connection = {
  host: process.env.DOCRAIDER_DOCKER_DB_HOST ?? '127.0.0.1',
  port: dockerPort,
  database: 'docraider-mcp',
  user: 'docraider-mcp_user',
  password: 'hogehoge',
};
const fixtureEnv = { ...process.env, NODE_ENV: 'test', DOCRAIDER_CLI_TEST_SCENARIO: 'success' };
const prefix = `cli-contract-${process.pid}-${Date.now()}`;
let pool: Pool;
let dockerAvailable = false;
let configPath = '';
const siteIds: string[] = [];

function runFixture(args: string[], cwd?: string) {
  return spawnSync(node, [seamEntry, ...args], { encoding: 'utf8', cwd, env: fixtureEnv });
}
function runProduction(args: string[]) {
  return spawnSync(node, [productionEntry, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DOCRAIDER_CONFIG: configPath },
    timeout: 10_000,
  });
}

beforeAll(async () => {
  pool = new Pool({ ...connection, connectionTimeoutMillis: 1_000 });
  try {
    await pool.query('SELECT 1');
    dockerAvailable = true;
    const directory = mkdtempSync(join(tmpdir(), 'docraider-cli-docker-'));
    configPath = join(directory, 'config.yaml');
    writeFileSync(configPath, `database:
  host: ${connection.host}
  port: ${connection.port}
  name: ${connection.database}
  user: ${connection.user}
  password: ${connection.password}
  poolMin: 0
  poolMax: 4
embedding:
  endpoint: http://127.0.0.1:11435
  dimensions: 1536
  batchSize: 1
  timeoutMs: 5000
`);
  } catch {
    dockerAvailable = false;
  }
});

afterAll(async () => {
  if (dockerAvailable && siteIds.length) await pool.query('DELETE FROM sites WHERE id = ANY($1::uuid[])', [siteIds]);
  if (pool) await pool.end();
});

describe.sequential('CLI process integration contract (OpenSpec 7.3)', () => {
  it('--output writes the complete body and returns only save metadata', () => {
    const directory = mkdtempSync(join(tmpdir(), 'docraider-output-'));
    const target = join(directory, 'nested', 'document.md');
    const result = runFixture(['document', 'get', 'fixture-id', '--output', target]);
    expect(result.status).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope).toMatchObject({ ok: true, command: 'document get', data: {
      contentBytes: Buffer.byteLength('document fixture'),
      contentTruncated: false,
      output: { path: target, bytes: Buffer.byteLength('document fixture'), contentType: 'text/markdown', truncated: false },
    } });
    expect(envelope.data).not.toHaveProperty('content');
    expect(readFileSync(target, 'utf8')).toBe('document fixture');
  });

  it('--content-limit bounds stdout content and reports original byte size', () => {
    const result = runFixture(['document', 'get', 'fixture-id', '--content-limit', '8']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: {
      content: 'document', contentTruncated: true, contentBytes: Buffer.byteLength('document fixture'),
    } });
  });

  it('JSONL crawl output consists of progress events followed by one terminal event', () => {
    const result = runFixture(['crawl', 'pages', '--url', 'https://example.test/one', '--url', 'https://example.test/two', '--format', 'jsonl']);
    expect(result.status).toBe(0);
    const events = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(events.map((event) => event.event)).toEqual(['progress', 'progress', 'terminal']);
    expect(events.every((event) => event.operationId === 'crawl pages' && !Number.isNaN(Date.parse(event.timestamp)))).toBe(true);
    expect(events.at(-1)).toMatchObject({ event: 'terminal', data: { ok: true, command: 'crawl pages', data: { pagesProcessed: 2 } } });
  });

  it('a mismatched delete confirmation has no database side effects', async () => {
    if (!dockerAvailable) return;
    const inserted = await pool.query<{ id: string }>(`INSERT INTO sites (base_url, domain, name) VALUES ($1,$2,$3) RETURNING id`,
      [`https://${prefix}-delete.example`, `${prefix}-delete.example`, `${prefix}-delete`]);
    const siteId = inserted.rows[0].id;
    siteIds.push(siteId);
    await pool.query(`INSERT INTO documents (url,title,content,site_id) VALUES ($1,'fixture','must remain',$2)`, [`https://${prefix}-delete.example/doc`, siteId]);
    const before = await pool.query<{ count: string }>('SELECT COUNT(*) count FROM documents WHERE site_id=$1', [siteId]);

    const result = runProduction(['site', 'delete', siteId, '--confirm', `${siteId}-wrong`, '--config', configPath]);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_MISMATCH' } });
    const afterSite = await pool.query('SELECT id FROM sites WHERE id=$1', [siteId]);
    const after = await pool.query<{ count: string }>('SELECT COUNT(*) count FROM documents WHERE site_id=$1', [siteId]);
    expect(afterSite.rowCount).toBe(1);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it('the real detached backfill worker continues after its parent CLI exits', async () => {
    if (!dockerAvailable) return;
    await pool.query(`DELETE FROM backfill_jobs WHERE status IN ('queued','running')`);
    const inserted = await pool.query<{ id: string }>(`INSERT INTO sites (base_url, domain, name) VALUES ($1,$2,$3) RETURNING id`,
      [`https://${prefix}-backfill.example`, `${prefix}-backfill.example`, `${prefix}-backfill`]);
    const siteId = inserted.rows[0].id;
    siteIds.push(siteId);
    const document = await pool.query<{ id: string }>(`INSERT INTO documents (url,title,content,site_id) VALUES ($1,'fixture','detached worker fixture',$2) RETURNING id`, [`https://${prefix}-backfill.example/doc`, siteId]);
    const chunk = await pool.query<{ id: string }>(`INSERT INTO document_chunks (document_id,chunk_index,content,embedding_status) VALUES ($1,0,'detached worker fixture','pending') RETURNING id`, [document.rows[0].id]);

    const startedAt = Date.now();
    const result = runProduction(['embedding', 'backfill', '--config', configPath]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    const accepted = JSON.parse(result.stdout);
    expect(accepted).toMatchObject({ ok: true, command: 'embedding backfill', data: { status: 'queued' } });
    expect(accepted.data.jobId).toBeGreaterThan(0);

    let job: { status: string; processed_chunks: number; error_message: string | null } | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await pool.query<{ status: string; processed_chunks: number; error_message: string | null }>('SELECT status,processed_chunks,error_message FROM backfill_jobs WHERE id=$1', [accepted.data.jobId]);
      job = rows.rows[0];
      if (job && ['completed', 'failed'].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(job, job?.error_message ?? 'worker did not reach a terminal state').toMatchObject({ status: 'completed' });
    const embedded = await pool.query('SELECT 1 FROM chunks_embedding WHERE chunk_id=$1', [chunk.rows[0].id]);
    expect(embedded.rowCount).toBe(1);
  }, 20_000);
});
