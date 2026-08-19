import { config } from '../config.js';

// Sleep helper for delays
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Generate random delay between min and max milliseconds
export function getRandomDelay(): number {
  const { min, max } = config.crawler.delay;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Calculate exponential backoff delay
export function getBackoffDelay(retryCount: number): number {
  const { initialMs, maxMs, multiplier } = config.crawler.backoff;
  return Math.min(initialMs * Math.pow(multiplier, retryCount), maxMs);
}