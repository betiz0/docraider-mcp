import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import dotenv from 'dotenv';
import {
  DEFAULT_MAX_CHUNK_LENGTH,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_PAGE_TIMEOUT_MS,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_SERVER_PORT,
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_DB_PORT,
  DEFAULT_DB_NAME,
  DEFAULT_DB_USER,
  DEFAULT_POOL_MAX,
  DEFAULT_POOL_MIN,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_MIN_SCORE,
  DEFAULT_FTS_LANGUAGE,
  DEFAULT_CRAWLER_MAX_RETRIES,
  DEFAULT_CRAWLER_USER_AGENT,
  DEFAULT_CRAWLER_DELAY_MIN_MS,
  DEFAULT_CRAWLER_DELAY_MAX_MS,
  DEFAULT_BACKOFF_INITIAL_MS,
  DEFAULT_BACKOFF_MAX_MS,
  DEFAULT_BACKOFF_MULTIPLIER,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_EMBEDDING_TIMEOUT_MS,
} from './constants/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '..', 'config.yaml');
const ENV_PATH = resolve(__dirname, '..', '.env');

// Load .env file from project root
dotenv.config({ path: ENV_PATH });

// Environment variable expansion: ${VAR_NAME:-default}
function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    const [varName, defaultValue] = expr.split(':-');
    return process.env[varName] ?? defaultValue ?? '';
  });
}

interface ServerConfig {
  host: string;
  port: number;
  maxConnections: number;
}

interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  ssl: boolean;
  poolMax: number;
  poolMin: number;
}

interface CrawlerDelayConfig {
  min: number;
  max: number;
}

interface CrawlerBackoffConfig {
  initialMs: number;
  maxMs: number;
  multiplier: number;
}

interface CrawlerConfig {
  maxConcurrency: number;
  timeout: number;
  maxRetries: number;
  userAgent: string;
  delay: CrawlerDelayConfig;
  backoff: CrawlerBackoffConfig;
}

interface ExtractionConfig {
  maxChunkLength: number;
  chunkSize: number;
  chunkOverlap: number;
}

interface SearchConfig {
  maxResults: number;
  minScore: number;
  language: string;
}

interface EmbeddingConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  dimensions: number;
  batchSize: number;
  timeoutMs: number;
}

export interface AppConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  crawler: CrawlerConfig;
  extraction: ExtractionConfig;
  search: SearchConfig;
  embedding: EmbeddingConfig;
}

interface RawServerConfig {
  host?: string;
  port?: string;
  maxConnections?: string;
}

interface RawDatabaseConfig {
  host?: string;
  port?: string;
  name?: string;
  user?: string;
  password?: string;
  ssl?: boolean | string;
  poolMax?: string;
  poolMin?: string;
}

interface RawCrawlerDelayConfig {
  min?: string;
  max?: string;
}

interface RawCrawlerBackoffConfig {
  initialMs?: string;
  maxMs?: string;
  multiplier?: string;
}

interface RawCrawlerConfig {
  maxConcurrency?: string;
  timeout?: string;
  maxRetries?: string;
  userAgent?: string;
  delay?: RawCrawlerDelayConfig;
  backoff?: RawCrawlerBackoffConfig;
}

interface RawExtractionConfig {
  maxChunkLength?: string;
  chunkSize?: string;
  chunkOverlap?: string;
}

interface RawSearchConfig {
  maxResults?: string;
  minScore?: string;
  language?: string;
}

interface RawEmbeddingConfig {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  dimensions?: string;
  batchSize?: string;
  timeoutMs?: string;
}

interface RawConfig {
  server?: RawServerConfig;
  database?: RawDatabaseConfig;
  crawler?: RawCrawlerConfig;
  extraction?: RawExtractionConfig;
  search?: RawSearchConfig;
  embedding?: RawEmbeddingConfig;
}

function loadConfig(): AppConfig {
  const yamlContent = readFileSync(CONFIG_PATH, 'utf-8');
  const rawConfig = yaml.load(yamlContent) as RawConfig;

  return {
    server: {
      host: expandEnvVars(String(rawConfig.server?.host ?? 'localhost')),
      port: Number(expandEnvVars(String(rawConfig.server?.port ?? String(DEFAULT_SERVER_PORT)))),
      maxConnections: Number(expandEnvVars(String(rawConfig.server?.maxConnections ?? String(DEFAULT_MAX_CONNECTIONS)))),
    },
    database: {
      host: expandEnvVars(String(rawConfig.database?.host ?? 'localhost')),
      port: Number(expandEnvVars(String(rawConfig.database?.port ?? String(DEFAULT_DB_PORT)))),
      name: expandEnvVars(String(rawConfig.database?.name ?? DEFAULT_DB_NAME)),
      user: expandEnvVars(String(rawConfig.database?.user ?? DEFAULT_DB_USER)),
      password: expandEnvVars(String(rawConfig.database?.password ?? '')),
      ssl: rawConfig.database?.ssl === true || rawConfig.database?.ssl === 'true',
      poolMax: Number(expandEnvVars(String(rawConfig.database?.poolMax ?? String(DEFAULT_POOL_MAX)))),
      poolMin: Number(expandEnvVars(String(rawConfig.database?.poolMin ?? String(DEFAULT_POOL_MIN)))),
    },
    crawler: {
      maxConcurrency: Number(expandEnvVars(String(rawConfig.crawler?.maxConcurrency ?? String(DEFAULT_MAX_CONCURRENT)))),
      timeout: Number(expandEnvVars(String(rawConfig.crawler?.timeout ?? String(DEFAULT_PAGE_TIMEOUT_MS)))),
      maxRetries: Number(expandEnvVars(String(rawConfig.crawler?.maxRetries ?? String(DEFAULT_CRAWLER_MAX_RETRIES)))),
      userAgent: expandEnvVars(String(rawConfig.crawler?.userAgent ?? DEFAULT_CRAWLER_USER_AGENT)),
      delay: {
        min: Number(expandEnvVars(String(rawConfig.crawler?.delay?.min ?? String(DEFAULT_CRAWLER_DELAY_MIN_MS)))),
        max: Number(expandEnvVars(String(rawConfig.crawler?.delay?.max ?? String(DEFAULT_CRAWLER_DELAY_MAX_MS)))),
      },
      backoff: {
        initialMs: Number(expandEnvVars(String(rawConfig.crawler?.backoff?.initialMs ?? String(DEFAULT_BACKOFF_INITIAL_MS)))),
        maxMs: Number(expandEnvVars(String(rawConfig.crawler?.backoff?.maxMs ?? String(DEFAULT_BACKOFF_MAX_MS)))),
        multiplier: Number(expandEnvVars(String(rawConfig.crawler?.backoff?.multiplier ?? String(DEFAULT_BACKOFF_MULTIPLIER)))),
      },
    },
    extraction: {
      maxChunkLength: Number(expandEnvVars(String(rawConfig.extraction?.maxChunkLength ?? String(DEFAULT_MAX_CHUNK_LENGTH)))),
      chunkSize: Number(expandEnvVars(String(rawConfig.extraction?.chunkSize ?? String(DEFAULT_CHUNK_SIZE)))),
      chunkOverlap: Number(expandEnvVars(String(rawConfig.extraction?.chunkOverlap ?? String(DEFAULT_CHUNK_OVERLAP)))),
    },
    search: {
      maxResults: Number(expandEnvVars(String(rawConfig.search?.maxResults ?? String(DEFAULT_SEARCH_LIMIT)))),
      minScore: Number(expandEnvVars(String(rawConfig.search?.minScore ?? String(DEFAULT_MIN_SCORE)))),
      language: expandEnvVars(String(rawConfig.search?.language ?? DEFAULT_FTS_LANGUAGE)),
    },
    embedding: {
      endpoint: expandEnvVars(String(rawConfig.embedding?.endpoint ?? 'http://localhost:11434')),
      apiKey: expandEnvVars(String(rawConfig.embedding?.apiKey ?? '')),
      model: expandEnvVars(String(rawConfig.embedding?.model ?? 'nomic-embed-text')),
      dimensions: Number(expandEnvVars(String(rawConfig.embedding?.dimensions ?? String(DEFAULT_EMBEDDING_DIMENSIONS)))),
      batchSize: Number(expandEnvVars(String(rawConfig.embedding?.batchSize ?? String(DEFAULT_EMBEDDING_BATCH_SIZE)))),
      timeoutMs: Number(expandEnvVars(String(rawConfig.embedding?.timeoutMs ?? String(DEFAULT_EMBEDDING_TIMEOUT_MS)))),
    },
  };
}

export const config = loadConfig();

// Validate embedding dimensions match expected range at startup
if (config.embedding.dimensions <= 0) {
  throw new Error(`Invalid embedding dimensions: ${config.embedding.dimensions}. Must be a positive integer.`);
}