import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import dotenv from 'dotenv';
import {
  DEFAULT_MAX_CHUNK_LENGTH, DEFAULT_SEARCH_LIMIT, DEFAULT_MAX_CONCURRENT,
  DEFAULT_PAGE_TIMEOUT_MS, DEFAULT_SERVER_PORT, DEFAULT_MAX_CONNECTIONS,
  DEFAULT_DB_PORT, DEFAULT_DB_NAME, DEFAULT_DB_USER, DEFAULT_POOL_MAX,
  DEFAULT_POOL_MIN, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP,
  DEFAULT_MIN_SCORE, DEFAULT_FTS_LANGUAGE, DEFAULT_CRAWLER_MAX_RETRIES,
  DEFAULT_CRAWLER_USER_AGENT, DEFAULT_CRAWLER_DELAY_MIN_MS,
  DEFAULT_CRAWLER_DELAY_MAX_MS, DEFAULT_BACKOFF_INITIAL_MS,
  DEFAULT_BACKOFF_MAX_MS, DEFAULT_BACKOFF_MULTIPLIER,
  DEFAULT_EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_EMBEDDING_TIMEOUT_MS,
} from './constants/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface ServerConfig { host: string; port: number; maxConnections: number }
export interface DatabaseConfig { host: string; port: number; name: string; user: string; password: string; ssl: boolean; poolMax: number; poolMin: number }
export interface CrawlerConfig { maxConcurrency: number; timeout: number; maxRetries: number; userAgent: string; delay: { min: number; max: number }; backoff: { initialMs: number; maxMs: number; multiplier: number } }
export interface ExtractionConfig { maxChunkLength: number; chunkSize: number; chunkOverlap: number }
export interface SearchConfig { maxResults: number; minScore: number; language: string }
export interface EmbeddingConfig { endpoint: string; apiKey: string; model: string; dimensions: number; batchSize: number; timeoutMs: number }
export interface AppConfig { server: ServerConfig; database: DatabaseConfig; crawler: CrawlerConfig; extraction: ExtractionConfig; search: SearchConfig; embedding: EmbeddingConfig }
export interface LoadConfigOptions { configPath?: string; env?: NodeJS.ProcessEnv; cwd?: string; packageRoot?: string; loadDotEnv?: boolean }
export interface LoadedConfig { config: AppConfig; configPath: string | null; envPath: string | null; source: 'explicit' | 'environment' | 'cwd' | 'package' | 'defaults' }

type RawConfig = Record<string, any>;

function expand(value: unknown, env: NodeJS.ProcessEnv): string {
  return String(value ?? '').replace(/\$\{([^}]+)\}/g, (_m, expression: string) => {
    const separator = expression.indexOf(':-');
    const name = separator < 0 ? expression : expression.slice(0, separator);
    const fallback = separator < 0 ? '' : expression.slice(separator + 2);
    return env[name] ?? fallback;
  });
}
function number(value: unknown, fallback: number, env: NodeJS.ProcessEnv): number {
  const result = Number(expand(value ?? fallback, env));
  if (!Number.isFinite(result)) throw new Error(`Invalid numeric configuration value: ${String(value)}`);
  return result;
}
function defaults(raw: RawConfig, env: NodeJS.ProcessEnv): AppConfig {
  return {
    server: { host: expand(raw.server?.host ?? 'localhost', env), port: number(raw.server?.port, DEFAULT_SERVER_PORT, env), maxConnections: number(raw.server?.maxConnections, DEFAULT_MAX_CONNECTIONS, env) },
    database: { host: expand(raw.database?.host ?? 'localhost', env), port: number(raw.database?.port, DEFAULT_DB_PORT, env), name: expand(raw.database?.name ?? DEFAULT_DB_NAME, env), user: expand(raw.database?.user ?? DEFAULT_DB_USER, env), password: expand(raw.database?.password ?? '', env), ssl: raw.database?.ssl === true || expand(raw.database?.ssl ?? 'false', env) === 'true', poolMax: number(raw.database?.poolMax, DEFAULT_POOL_MAX, env), poolMin: number(raw.database?.poolMin, DEFAULT_POOL_MIN, env) },
    crawler: { maxConcurrency: number(raw.crawler?.maxConcurrency, DEFAULT_MAX_CONCURRENT, env), timeout: number(raw.crawler?.timeout, DEFAULT_PAGE_TIMEOUT_MS, env), maxRetries: number(raw.crawler?.maxRetries, DEFAULT_CRAWLER_MAX_RETRIES, env), userAgent: expand(raw.crawler?.userAgent ?? DEFAULT_CRAWLER_USER_AGENT, env), delay: { min: number(raw.crawler?.delay?.min, DEFAULT_CRAWLER_DELAY_MIN_MS, env), max: number(raw.crawler?.delay?.max, DEFAULT_CRAWLER_DELAY_MAX_MS, env) }, backoff: { initialMs: number(raw.crawler?.backoff?.initialMs, DEFAULT_BACKOFF_INITIAL_MS, env), maxMs: number(raw.crawler?.backoff?.maxMs, DEFAULT_BACKOFF_MAX_MS, env), multiplier: number(raw.crawler?.backoff?.multiplier, DEFAULT_BACKOFF_MULTIPLIER, env) } },
    extraction: { maxChunkLength: number(raw.extraction?.maxChunkLength, DEFAULT_MAX_CHUNK_LENGTH, env), chunkSize: number(raw.extraction?.chunkSize, DEFAULT_CHUNK_SIZE, env), chunkOverlap: number(raw.extraction?.chunkOverlap, DEFAULT_CHUNK_OVERLAP, env) },
    search: { maxResults: number(raw.search?.maxResults, DEFAULT_SEARCH_LIMIT, env), minScore: number(raw.search?.minScore, DEFAULT_MIN_SCORE, env), language: expand(raw.search?.language ?? DEFAULT_FTS_LANGUAGE, env) },
    embedding: { endpoint: expand(raw.embedding?.endpoint ?? 'http://localhost:11434', env), apiKey: expand(raw.embedding?.apiKey ?? '', env), model: expand(raw.embedding?.model ?? 'nomic-embed-text', env), dimensions: number(raw.embedding?.dimensions, DEFAULT_EMBEDDING_DIMENSIONS, env), batchSize: number(raw.embedding?.batchSize, DEFAULT_EMBEDDING_BATCH_SIZE, env), timeoutMs: number(raw.embedding?.timeoutMs, DEFAULT_EMBEDDING_TIMEOUT_MS, env) },
  };
}
function validate(value: AppConfig): void {
  const positive: Array<[string, number]> = [['server.port', value.server.port], ['server.maxConnections', value.server.maxConnections], ['database.port', value.database.port], ['database.poolMax', value.database.poolMax], ['crawler.maxConcurrency', value.crawler.maxConcurrency], ['crawler.timeout', value.crawler.timeout], ['embedding.dimensions', value.embedding.dimensions], ['embedding.batchSize', value.embedding.batchSize], ['embedding.timeoutMs', value.embedding.timeoutMs]];
  for (const [name, item] of positive) if (!Number.isFinite(item) || item <= 0) throw new Error(`Invalid ${name}: ${item}. Must be positive.`);
  if (value.database.poolMin < 0 || value.database.poolMin > value.database.poolMax) throw new Error('Invalid database pool limits');
}

/** Resolve and validate configuration without creating DB/browser resources. */
export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = resolve(options.packageRoot ?? packageRoot);
  const baseEnv = { ...(options.env ?? process.env) };
  const explicit = options.configPath ? resolve(cwd, options.configPath) : undefined;
  const fromEnv = !explicit && baseEnv.DOCRAIDER_CONFIG ? resolve(cwd, baseEnv.DOCRAIDER_CONFIG) : undefined;
  let selected: string | null = null;
  let source: LoadedConfig['source'] = 'defaults';
  if (explicit || fromEnv) {
    selected = explicit ?? fromEnv!;
    source = explicit ? 'explicit' : 'environment';
    if (!existsSync(selected)) throw new Error(`Configuration file not found: ${selected}`);
  } else if (existsSync(resolve(cwd, 'config.yaml'))) { selected = resolve(cwd, 'config.yaml'); source = 'cwd'; }
  else if (existsSync(resolve(root, 'config.yaml'))) { selected = resolve(root, 'config.yaml'); source = 'package'; }

  let envPath: string | null = null;
  const env = { ...baseEnv };
  if (options.loadDotEnv !== false) {
    const candidates = [selected ? resolve(dirname(selected), '.env') : null, resolve(root, '.env')].filter((item, index, all): item is string => Boolean(item) && all.indexOf(item) === index);
    const candidate = candidates.find(existsSync);
    if (candidate) { envPath = candidate; const parsed = dotenv.parse(readFileSync(candidate)); for (const [key, value] of Object.entries(parsed)) if (env[key] === undefined) env[key] = value; }
  }
  const raw = selected ? (yaml.load(readFileSync(selected, 'utf8')) as RawConfig ?? {}) : {};
  const result = defaults(raw, env);
  validate(result);
  return { config: result, configPath: selected, envPath, source };
}

// Backwards-compatible live object initialized from the package fallback only,
// never from the caller's cwd. Entrypoints explicitly resolve cwd/--config and
// replace these fields before creating DB/browser resources.
export const config: AppConfig = loadConfig({ cwd: packageRoot, packageRoot }).config;
export function applyConfig(next: AppConfig): AppConfig { validate(next); Object.assign(config, next); return config; }
