import * as cheerio from 'cheerio';
import { checkUrl, SsrfError } from '../utils/ssrf-guard.js';

const SITEMAP_CACHE_TTL = 3600000; // 1 hour in milliseconds

interface CachedSitemap {
  urls: string[];
  timestamp: number;
}

const sitemapCache = new Map<string, CachedSitemap>();

/**
 * Parses a sitemap.xml and extracts all URLs
 */
export async function parseSitemap(sitemapUrl: string): Promise<string[]> {
  // SSRF guard: validate URL before fetching
  try {
    await checkUrl(sitemapUrl);
  } catch (err) {
    if (err instanceof SsrfError) {
      console.error(`[SSRF] Blocked sitemap fetch for ${sitemapUrl}: ${err.message}`);
      return [];
    }
    throw err;
  }

  const cached = sitemapCache.get(sitemapUrl);

  // Return cached URLs if still valid
  if (cached && Date.now() - cached.timestamp < SITEMAP_CACHE_TTL) {
    return cached.urls;
  }

  try {
    const response = await fetch(sitemapUrl);
    if (!response.ok) {
      return [];
    }

    const text = await response.text();
    const urls = extractUrlsFromSitemap(text);

    // Cache the URLs
    sitemapCache.set(sitemapUrl, {
      urls,
      timestamp: Date.now(),
    });

    return urls;
  } catch {
    return [];
  }
}

/**
 * Extracts URLs from sitemap XML content
 */
export function extractUrlsFromSitemap(xmlContent: string): string[] {
  const urls: string[] = [];
  const $ = cheerio.load(xmlContent, { xmlMode: true });

  // Handle sitemap index files (sitemaps referencing other sitemaps)
  $('sitemap loc').each((_, elem) => {
    const loc = $(elem).text();
    if (loc) {
      urls.push(loc);
    }
  });

  // Handle regular sitemap files (URL entries)
  $('url loc').each((_, elem) => {
    const loc = $(elem).text();
    if (loc) {
      urls.push(loc);
    }
  });

  return urls;
}

/**
 * Clears the sitemap cache
 */
export function clearSitemapCache(): void {
  sitemapCache.clear();
}

/**
 * Checks if a URL is from the same domain
 */
export function isSameDomain(url1: string, url2: string): boolean {
  try {
    const host1 = new URL(url1).hostname;
    const host2 = new URL(url2).hostname;
    return host1 === host2;
  } catch {
    return false;
  }
}