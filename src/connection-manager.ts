import { config } from './config.js';
import { DEFAULT_CONNECTION_TIMEOUT_MS, MCP_CONNECTION_LIMIT_ERROR } from './constants/index.js';

const DEFAULT_TIMEOUT_MS = DEFAULT_CONNECTION_TIMEOUT_MS;

class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(initialPermits: number) {
    this.permits = initialPermits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        next();
      }
    } else {
      this.permits++;
    }
  }
}

export class ConnectionManager {
  private semaphore: Semaphore;
  private activeConnections: number = 0;
  private maxConnections: number;
  private timeoutMs: number;

  constructor(maxConnections?: number, timeoutMs?: number) {
    this.maxConnections = maxConnections ?? config.server.maxConnections;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.semaphore = new Semaphore(this.maxConnections);
  }

  getCurrentConnections(): number {
    return this.maxConnections - this.semaphore['permits'] + this.semaphore['queue'].length;
  }

  async withConnection<T>(fn: () => Promise<T>): Promise<T> {
    const acquired = await Promise.race([
      (async () => {
        await this.semaphore.acquire();
        return true;
      })(),
      new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), this.timeoutMs)
      ).then(() => false),
    ]);

    if (!acquired) {
      const error = new Error('Connection limit exceeded');
      (error as any).code = MCP_CONNECTION_LIMIT_ERROR;
      throw error;
    }

    this.activeConnections++;

    try {
      return await fn();
    } finally {
      this.activeConnections--;
      this.semaphore.release();
    }
  }
}