import { config } from '../config.js';
import { db, type DatabaseManager } from '../db/index.js';
import type { BackfillJob, EmbeddingStats } from '../db/types.js';
import { PgBackfillRepository, type BackfillRepository } from './backfill-repository.js';

export type ReadinessLevel = 'ready' | 'degraded' | 'unavailable';
export type RecommendedAction =
  | 'none' | 'start_backfill' | 'wait_for_backfill' | 'retry_failed'
  | 'use_keyword_search' | 'hybrid_search_allowed' | 'check_embedding_endpoint'
  | 'restart_worker';
export type WorkerState = 'idle' | 'queued' | 'running' | 'stale' | 'failed';

export interface ModeReadiness {
  status: ReadinessLevel;
  reasonCode: string;
  recommendedAction: RecommendedAction;
}
export interface EmbeddingReadiness {
  checkedAt: string;
  coverage: { total: number; completed: number; pending: number; failed: number; ratio: number };
  worker: { state: WorkerState; jobId: number | null; heartbeatAt: string | null; leaseExpiresAt: string | null };
  latestJob: BackfillJob | null;
  modes: { keyword: ModeReadiness; semantic: ModeReadiness; hybrid: ModeReadiness };
  probe: EmbeddingProbe | null;
}
export interface EmbeddingProbe {
  checkedAt: string;
  endpoint: {
    ok: boolean;
    model: string;
    dimensions: number | null;
    configuredModel: string;
    reportedModel: string | null;
    expectedDimensions: number;
    observedDimensions: number | null;
    modelMatch: boolean;
    dimensionsMatch: boolean;
    error: string | null;
  };
  database: {
    pgvector: boolean;
    schema: boolean;
    dimensionsMatch: boolean;
    modelMatch: boolean;
    expectedDimensions: number;
    observedDimensions: number | null;
    configuredModel: string;
    observedModels: string[];
    error: string | null;
  };
}

export interface ReadinessDependencies {
  getStats(): Promise<EmbeddingStats>;
  latestJob(): Promise<BackfillJob | null>;
  now(): Date;
}

function workerState(job: BackfillJob | null, now: Date): WorkerState {
  if (!job || job.status === 'completed') return 'idle';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'queued') return 'queued';
  if (!job.leaseExpiresAt || job.leaseExpiresAt.getTime() <= now.getTime()) return 'stale';
  return 'running';
}

export function evaluateReadiness(stats: EmbeddingStats, job: BackfillJob | null, now: Date, probe: EmbeddingProbe | null = null): EmbeddingReadiness {
  const ratio = stats.totalChunks === 0 ? 1 : stats.completedCount / stats.totalChunks;
  const state = workerState(job, now);
  const keyword: ModeReadiness = { status: 'ready', reasonCode: 'keyword_index_available', recommendedAction: 'none' };
  let semantic: ModeReadiness;

  if (probe && (!probe.endpoint.ok || !probe.database.pgvector || !probe.database.schema || !probe.database.dimensionsMatch || !probe.database.modelMatch)) {
    const endpointFailure = !probe.endpoint.ok;
    semantic = { status: 'unavailable', reasonCode: endpointFailure ? 'embedding_endpoint_unavailable' : 'vector_index_incompatible', recommendedAction: endpointFailure ? 'check_embedding_endpoint' : 'use_keyword_search' };
  } else if (stats.totalChunks === 0) {
    semantic = { status: 'ready', reasonCode: 'empty_index', recommendedAction: 'none' };
  } else if (ratio === 1) {
    semantic = probe
      ? { status: 'ready', reasonCode: 'semantic_index_ready', recommendedAction: 'none' }
      : { status: 'degraded', reasonCode: 'probe_not_run', recommendedAction: 'hybrid_search_allowed' };
  } else if (state === 'stale' || (state === 'queued' && Boolean(job?.lastStartError))) {
    semantic = { status: 'degraded', reasonCode: 'worker_stale', recommendedAction: 'restart_worker' };
  } else if (state === 'running' || state === 'queued') {
    semantic = { status: 'degraded', reasonCode: 'backfill_in_progress', recommendedAction: 'wait_for_backfill' };
  } else if (stats.failedCount > 0) {
    semantic = { status: ratio > 0 ? 'degraded' : 'unavailable', reasonCode: 'embedding_failures', recommendedAction: 'retry_failed' };
  } else {
    semantic = { status: ratio > 0 ? 'degraded' : 'unavailable', reasonCode: 'embedding_coverage_incomplete', recommendedAction: 'start_backfill' };
  }
  const hybrid: ModeReadiness = semantic.status === 'ready'
    ? { status: 'ready', reasonCode: 'hybrid_index_ready', recommendedAction: 'none' }
    : { status: 'degraded', reasonCode: semantic.status === 'unavailable' ? 'semantic_unavailable_keyword_fallback' : 'semantic_partial_keyword_fallback', recommendedAction: semantic.status === 'unavailable' ? 'use_keyword_search' : 'hybrid_search_allowed' };

  return {
    checkedAt: now.toISOString(),
    coverage: { total: stats.totalChunks, completed: stats.completedCount, pending: stats.pendingCount, failed: stats.failedCount, ratio },
    worker: { state, jobId: job?.id ?? null, heartbeatAt: job?.heartbeatAt?.toISOString() ?? null, leaseExpiresAt: job?.leaseExpiresAt?.toISOString() ?? null },
    latestJob: job,
    modes: { keyword, semantic, hybrid }, probe,
  };
}

export async function getEmbeddingReadiness(options: { probe?: boolean; dependencies?: ReadinessDependencies } = {}): Promise<EmbeddingReadiness> {
  const dependencies = options.dependencies ?? {
    getStats: () => db.getEmbeddingStats(),
    latestJob: () => new PgBackfillRepository().latest(),
    now: () => new Date(),
  };
  const [stats, job] = await Promise.all([dependencies.getStats(), dependencies.latestJob()]);
  const probe = options.probe ? await probeEmbedding() : null;
  return evaluateReadiness(stats, job, dependencies.now(), probe);
}

export async function probeEmbedding(options: { database?: DatabaseManager; fetch?: typeof fetch; timeoutMs?: number; now?: () => Date } = {}): Promise<EmbeddingProbe> {
  const database = options.database ?? db;
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? config.embedding.timeoutMs, 10_000));
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  const timeoutError = (target: string) => new Error(`${target} probe timed out after ${timeoutMs}ms`);
  const bounded = async <T>(promise: Promise<T>, target: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(timeoutError(target)), remaining()); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const endpoint: EmbeddingProbe['endpoint'] = {
    ok: false,
    model: config.embedding.model,
    dimensions: null,
    configuredModel: config.embedding.model,
    reportedModel: null,
    expectedDimensions: config.embedding.dimensions,
    observedDimensions: null,
    modelMatch: false,
    dimensionsMatch: false,
    error: null,
  };
  const controller = new AbortController();
  const endpointTimer = setTimeout(() => controller.abort(timeoutError('Embedding endpoint')), remaining());
  try {
    const response = await bounded(fetcher(`${config.embedding.endpoint}/v1/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.embedding.apiKey ? { Authorization: `Bearer ${config.embedding.apiKey}` } : {}) },
      body: JSON.stringify({ model: config.embedding.model, input: 'readiness probe' }), signal: controller.signal,
    }), 'Embedding endpoint');
    if (!response.ok) throw new Error(`Embedding endpoint returned HTTP ${response.status}`);
    const body = await bounded(response.json(), 'Embedding endpoint response') as { model?: string; data?: Array<{ embedding?: number[] }> };
    endpoint.reportedModel = body.model ?? null;
    endpoint.model = body.model ?? config.embedding.model;
    endpoint.observedDimensions = body.data?.[0]?.embedding?.length ?? null;
    endpoint.dimensions = endpoint.observedDimensions;
    endpoint.modelMatch = !body.model || body.model === config.embedding.model;
    endpoint.dimensionsMatch = endpoint.observedDimensions === config.embedding.dimensions;
    endpoint.ok = endpoint.modelMatch && endpoint.dimensionsMatch;
    const endpointFailures: string[] = [];
    if (!endpoint.modelMatch) endpointFailures.push(`configured model ${config.embedding.model}, endpoint reported ${body.model}`);
    if (!endpoint.dimensionsMatch) endpointFailures.push(`expected ${config.embedding.dimensions} dimensions, received ${endpoint.observedDimensions ?? 'none'}`);
    endpoint.error = endpointFailures.length ? endpointFailures.join('; ') : null;
  } catch (error) {
    endpoint.error = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(endpointTimer);
    controller.abort();
  }

  const databaseResult: EmbeddingProbe['database'] = {
    pgvector: false,
    schema: false,
    dimensionsMatch: false,
    modelMatch: false,
    expectedDimensions: config.embedding.dimensions,
    observedDimensions: null,
    configuredModel: config.embedding.model,
    observedModels: [],
    error: null,
  };
  try {
    const rows = await bounded(database.query<{ pgvector: boolean; chunks_table: boolean; embedding_table: boolean; status_column: boolean; vector_type: string | null }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') AS pgvector,
       to_regclass('public.document_chunks') IS NOT NULL AS chunks_table,
       to_regclass('public.chunks_embedding') IS NOT NULL AS embedding_table,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='document_chunks' AND column_name='embedding_status') AS status_column,
       (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
          WHERE a.attrelid=to_regclass('public.chunks_embedding') AND a.attname='embedding' AND NOT a.attisdropped) AS vector_type`,
    ), 'Database');
    const row = rows[0];
    databaseResult.pgvector = Boolean(row?.pgvector);
    databaseResult.schema = Boolean(row?.chunks_table && row?.embedding_table && row?.status_column);
    const match = row?.vector_type?.match(/^vector\((\d+)\)$/);
    databaseResult.observedDimensions = match ? Number(match[1]) : null;
    databaseResult.dimensionsMatch = databaseResult.observedDimensions === config.embedding.dimensions;

    if (databaseResult.schema) {
      const modelRows = await bounded(database.query<{ model: string }>(
        `SELECT DISTINCT embedding_model AS model FROM document_chunks
         WHERE embedding_status='completed' AND embedding_model IS NOT NULL
         UNION SELECT DISTINCT model_version AS model FROM chunks_embedding WHERE model_version IS NOT NULL`,
      ), 'Database');
      databaseResult.observedModels = modelRows.map((item) => item.model).filter(Boolean).sort();
      databaseResult.modelMatch = databaseResult.observedModels.every((model) => model === config.embedding.model);
    }
    const failures: string[] = [];
    if (!databaseResult.pgvector) failures.push('pgvector extension is unavailable');
    if (!databaseResult.schema) failures.push('required document_chunks/chunks_embedding schema is incomplete');
    if (!databaseResult.dimensionsMatch) failures.push(`expected vector(${config.embedding.dimensions}), found ${row?.vector_type ?? 'no vector column'}`);
    if (databaseResult.schema && !databaseResult.modelMatch) failures.push(`configured model ${config.embedding.model}, stored models: ${databaseResult.observedModels.join(', ') || 'none'}`);
    databaseResult.error = failures.length ? failures.join('; ') : null;
  } catch (error) {
    databaseResult.error = error instanceof Error ? error.message : String(error);
  }
  return { checkedAt, endpoint, database: databaseResult };
}

