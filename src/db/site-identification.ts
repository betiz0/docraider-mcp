import { siteRepository } from './site-repository.js';
import type { Site } from './types.js';
import { DOC_ROOT_PATHS } from '../constants/index.js';

export interface SiteIdentificationResult {
  site: Site;
  isNew: boolean;
}

export async function identifyOrCreateSite(url: string, title?: string | null): Promise<SiteIdentificationResult> {
  const urlObj = new URL(url);
  const domain = urlObj.hostname;
  const pathParts = urlObj.pathname.split('/').filter(Boolean);

  let existingSite = await siteRepository.findByDomain(domain);
  if (existingSite) {
    return { site: existingSite, isNew: false };
  }

  let baseUrl = `${urlObj.origin}`;
  if (pathParts.length > 0) {
    const docRootIndex = pathParts.findIndex((part) =>
      DOC_ROOT_PATHS.map(p => p.toLowerCase()).includes(part.toLowerCase())
    );
    if (docRootIndex >= 0) {
      baseUrl = `${urlObj.origin}/${pathParts.slice(0, docRootIndex + 1).join('/')}`;
    }
  }

  let name: string | null = domain;
  if (title) {
    const titleMatch = title.match(/^([^-|]+)/);
    if (titleMatch) {
      name = titleMatch[1].trim();
    }
  }

  const site = await siteRepository.create({
    baseUrl,
    domain,
    name,
  });

  return { site, isNew: true };
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function extractBaseUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.origin;
  } catch {
    return '';
  }
}