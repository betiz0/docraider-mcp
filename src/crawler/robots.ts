import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const robotsParser = require('robots-parser') as (url: string, text: string) => any;
import { checkUrl, SsrfError } from '../utils/ssrf-guard.js';

const ROBOTS_CACHE_TTL = 3600000; // 1 hour in milliseconds

interface CachedRobots {
  parser: ReturnType<typeof robotsParser>;
  timestamp: number;
}

const robotsCache = new Map<string, CachedRobots>();

/**
 * Fetches and parses robots.txt for a given base URL
 */
export async function fetchRobotsTxt(baseUrl: string): Promise<ReturnType<typeof robotsParser> | null> {
  try {
    const robotsUrl = new URL('/robots.txt', baseUrl).toString();

    // SSRF guard: validate URL before fetching
    try {
      await checkUrl(robotsUrl);
    } catch (err) {
      if (err instanceof SsrfError) {
        console.error(`[SSRF] Blocked robots.txt fetch for ${robotsUrl}: ${err.message}`);
        return null;
      }
      throw err;
    }

    const cached = robotsCache.get(robotsUrl);

    // Return cached parser if still valid
    if (cached && Date.now() - cached.timestamp < ROBOTS_CACHE_TTL) {
      return cached.parser;
    }

    const response = await fetch(robotsUrl);
    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    const parser = robotsParser(robotsUrl, text);

    // Cache the parser
    robotsCache.set(robotsUrl, {
      parser,
      timestamp: Date.now(),
    });

    return parser;
  } catch {
    return null;
  }
}

/**
 * Checks if a URL is allowed to be crawled based on robots.txt rules
 */
export function isAllowed(url: string, parser: ReturnType<typeof robotsParser>): boolean {
  if (!parser) {
    return true;
  }

  // Use '*' user agent as default
  return parser.isAllowed(url, '*') !== false;
}

/**
 * Clears the robots.txt cache
 */
export function clearRobotsCache(): void {
  robotsCache.clear();
}