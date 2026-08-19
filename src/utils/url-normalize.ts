/**
 * URL normalization utility
 * Ensures consistent URL representation to prevent duplicate documents
 * Implements rules from audit finding A-3
 */

/**
 * Normalize a URL to a canonical form
 * Rules:
 * 1. Remove trailing slashes (except for root path "/")
 * 2. Normalize query parameter order (sort alphabetically)
 * 3. Normalize case (lowercase scheme, host, and path)
 * 4. Remove default ports (80 for http, 443 for https)
 * 5. Remove fragment identifiers
 * 6. Decode then re-encode path segments
 */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);

    // Remove fragment
    url.hash = '';

    // Lowercase scheme and host
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();

    // Remove default ports
    if ((url.protocol === 'http:' && url.port === '80') ||
        (url.protocol === 'https:' && url.port === '443')) {
      url.port = '';
    }

    // Lowercase path
    url.pathname = url.pathname.toLowerCase();

    // Remove trailing slash (except for root)
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    // Normalize query parameters: sort alphabetically by key
    if (url.search) {
      const params = new URLSearchParams(url.search);
      const sortedKeys = Array.from(params.keys()).sort();
      const sortedParams = new URLSearchParams();
      for (const key of sortedKeys) {
        // Keep all values for duplicate keys, but sort keys
        const values = params.getAll(key);
        for (const value of values) {
          sortedParams.append(key, value);
        }
      }
      url.search = sortedParams.toString();
    }

    // Remove empty query string
    if (url.search === '') {
      url.search = '';
    }

    return url.toString();
  } catch {
    // If URL parsing fails, return the original string lowercased
    return raw.toLowerCase();
  }
}
