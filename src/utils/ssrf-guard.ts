/**
 * SSRF (Server-Side Request Forgery) guard utility.
 *
 * Validates URLs before fetching to prevent access to:
 * - Non-HTTP(S) schemes (file:, gopher:, ftp:, etc.)
 * - Loopback addresses (127.0.0.0/8, ::1)
 * - Private RFC1918 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - Link-local addresses (169.254.0.0/16, including metadata 169.254.169.254)
 * - Other reserved / unrouteable ranges
 *
 * DNS rebinding protection: resolves hostname at validation time and
 * re-validates the resolved IP at connection time using the same resolver
 * result (no second DNS lookup).
 */

import { lookup } from 'node:dns';
import { promisify } from 'node:util';

const lookupPromise = promisify(lookup);

// ── Scheme validation ───────────────────────────────────────────────

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Reject URLs whose scheme is not http or https.
 */
export function validateScheme(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError(url, 'Invalid URL');
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new SsrfError(
      url,
      `Scheme "${parsed.protocol}" is not allowed. Only http and https are permitted.`
    );
  }
}

// ── IP classification ───────────────────────────────────────────────

/**
 * Check if an IP address is in a blocked range.
 * Returns true if the IP should be blocked.
 */
function isBlockedIp(ip: string): boolean {
  // Loopback: 127.0.0.0/8
  if (/^127\./.test(ip)) return true;
  // IPv6 loopback ::1
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  // IPv4-mapped IPv6 loopback
  if (/^::ffff:127\./.test(ip)) return true;

  // Private ranges (RFC 1918)
  // 10.0.0.0/8
  if (/^10\./.test(ip)) return true;
  // 172.16.0.0/12 (172.16.0.0 – 172.31.255.255)
  const match172 = /^172\.(\d+)\./.exec(ip);
  if (match172) {
    const second = parseInt(match172[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // 192.168.0.0/16
  if (/^192\.168\./.test(ip)) return true;

  // Link-local: 169.254.0.0/16 (includes AWS/GCP metadata 169.254.169.254)
  if (/^169\.254\./.test(ip)) return true;

  // IPv6 link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(ip)) return true;
  // IPv6 unique local fc00::/7
  if (/^f[cd][0-9a-f]:/i.test(ip)) return true;

  // IPv4-mapped IPv6 private ranges
  if (/^::ffff:10\./.test(ip)) return true;
  if (/^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^::ffff:192\.168\./.test(ip)) return true;
  if (/^::ffff:169\.254\./.test(ip)) return true;

  // 0.0.0.0 / any
  if (ip === '0.0.0.0' || ip === '::') return true;

  return false;
}

// ── DNS resolution ──────────────────────────────────────────────────

interface ResolvedAddress {
  address: string;
  family: number; // 4 = IPv4, 6 = IPv6
}

/**
 * Resolve a hostname to an IP address.
 * Returns the first resolved address.
 */
async function resolveHostname(hostname: string): Promise<ResolvedAddress> {
  try {
    const result = await lookupPromise(hostname);
    return { address: result.address, family: result.family };
  } catch {
    throw new SsrfError(
      hostname,
      `DNS resolution failed for "${hostname}"`
    );
  }
}

/**
 * Validate that a resolved IP address is not in a blocked range.
 */
function validateResolvedIp(hostname: string, ip: string): void {
  if (isBlockedIp(ip)) {
    throw new SsrfError(
      hostname,
      `Resolved IP "${ip}" is in a blocked range (loopback/private/link-local). SSRF protection.`
    );
  }
}

// ── Connection-time re-validation ───────────────────────────────────

/**
 * DNS rebinding protection helper.
 *
 * When making an HTTP request, re-validate the resolved IP against
 * the original validation result. This catches DNS rebinding attacks
 * where the DNS record changes between validation and connection.
 *
 * @param originalIp - The IP that was validated at check time
 * @param actualIp   - The IP actually connected to
 */
export function validateConnectionIp(
  originalIp: string,
  actualIp: string
): void {
  if (originalIp !== actualIp) {
    throw new SsrfError(
      actualIp,
      `DNS rebinding detected: validated "${originalIp}" but connected to "${actualIp}". Request blocked.`
    );
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Full SSRF guard check for a URL.
 *
 * 1. Validates scheme (http/https only)
 * 2. Resolves hostname to IP
 * 3. Validates resolved IP is not blocked
 *
 * Returns the resolved IP for later connection-time re-validation.
 *
 * @throws SsrfError if the URL is blocked
 */
export async function checkUrl(url: string): Promise<string> {
  // Step 1: Scheme check
  validateScheme(url);

  // Step 2: Parse and resolve
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError(url, 'Invalid URL');
  }

  const hostname = parsed.hostname;

  // Step 3: DNS resolution + IP validation
  const resolved = await resolveHostname(hostname);
  validateResolvedIp(hostname, resolved.address);

  return resolved.address;
}

/**
 * Lightweight check that only validates the scheme.
 * Use this when DNS resolution is deferred (e.g., Playwright handles it).
 * The caller should still resolve and validate the IP before connecting.
 */
export function checkSchemeOnly(url: string): void {
  validateScheme(url);
}

// ── Error class ─────────────────────────────────────────────────────

export class SsrfError extends Error {
  constructor(
    target: string,
    message: string
  ) {
    super(`SSRF protection: ${message} (target: ${target})`);
    this.name = 'SsrfError';
  }
}
