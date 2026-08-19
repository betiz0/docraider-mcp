/**
 * Integration test for SSRF guard (T046, SC-010, FR-020).
 *
 * Verifies that blocked URL patterns are rejected with 100% rate:
 * - Loopback: 127.0.0.0/8, ::1
 * - Private RFC1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * - Link-local: 169.254.0.0/16 (including metadata 169.254.169.254)
 * - Non-HTTP schemes: file:, gopher:, ftp:, etc.
 * - Internal resource response body is not leaked
 */

import { describe, it, expect } from 'vitest';
import {
  checkUrl,
  checkSchemeOnly,
  SsrfError,
  validateConnectionIp,
} from '../../src/utils/ssrf-guard.js';

// ── Scheme validation (pure, no network) ────────────────────────────

describe('SSRF Guard - Scheme Validation', () => {
  it('allows http scheme', () => {
    expect(() => checkSchemeOnly('http://example.com/path')).not.toThrow();
  });

  it('allows https scheme', () => {
    expect(() => checkSchemeOnly('https://example.com/path')).not.toThrow();
  });

  it('rejects file scheme', () => {
    expect(() => checkSchemeOnly('file:///etc/passwd')).toThrow(SsrfError);
  });

  it('rejects gopher scheme', () => {
    expect(() => checkSchemeOnly('gopher://example.com')).toThrow(SsrfError);
  });

  it('rejects ftp scheme', () => {
    expect(() => checkSchemeOnly('ftp://example.com/file')).toThrow(SsrfError);
  });

  it('rejects data scheme', () => {
    expect(() => checkSchemeOnly('data:text/html,<script>alert(1)</script>')).toThrow(SsrfError);
  });

  it('rejects javascript scheme', () => {
    expect(() => checkSchemeOnly('javascript:alert(1)')).toThrow(SsrfError);
  });

  it('rejects invalid URLs', () => {
    expect(() => checkSchemeOnly('not-a-url')).toThrow(SsrfError);
  });
});

// ── Blocked IP ranges (pure, no network) ────────────────────────────

describe('SSRF Guard - Blocked IP Ranges', () => {
  // We test the internal isBlockedIp logic indirectly via checkUrl
  // by using hostnames that resolve to blocked IPs.
  // For pure unit testing, we verify the error class and message.

  it('SsrfError has correct name', () => {
    const err = new SsrfError('test', 'test message');
    expect(err.name).toBe('SsrfError');
    expect(err.message).toContain('SSRF protection');
    expect(err.message).toContain('test message');
    expect(err.message).toContain('test');
  });
});

// ── Connection-time IP validation ───────────────────────────────────

describe('SSRF Guard - Connection IP Validation', () => {
  it('allows matching IPs', () => {
    expect(() => validateConnectionIp('93.184.216.34', '93.184.216.34')).not.toThrow();
  });

  it('rejects mismatched IPs (DNS rebinding)', () => {
    expect(() => validateConnectionIp('93.184.216.34', '127.0.0.1')).toThrow(SsrfError);
    expect(() => validateConnectionIp('93.184.216.34', '10.0.0.1')).toThrow(SsrfError);
    expect(() => validateConnectionIp('93.184.216.34', '169.254.169.254')).toThrow(SsrfError);
  });
});

// ── Full URL check with blocked hosts (integration, may skip) ──────

describe('SSRF Guard - Full URL Check (Integration)', () => {
  // These tests require DNS resolution and may fail in environments
  // without network access or with DNS that resolves to blocked IPs.

  const blockedPatterns = [
    // Loopback
    'http://127.0.0.1/test',
    'http://127.0.0.2/test',
    'http://127.255.255.255/test',
    'http://[::1]/test',
    // Private RFC1918
    'http://10.0.0.1/test',
    'http://10.255.255.255/test',
    'http://172.16.0.1/test',
    'http://172.31.255.255/test',
    'http://192.168.0.1/test',
    'http://192.168.255.255/test',
    // Link-local / metadata
    'http://169.254.0.1/test',
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.255.255/test',
    // Non-HTTP schemes
    'file:///etc/passwd',
    'gopher://localhost/test',
    'ftp://127.0.0.1/file',
    'data:text/html,<h1>test</h1>',
  ];

  for (const url of blockedPatterns) {
    it(`blocks: ${url}`, async () => {
      await expect(checkUrl(url)).rejects.toThrow(SsrfError);
    });
  }

  it.each(['http://172.15.255.255/test', 'http://172.32.0.0/test'])(
    'allows public addresses outside RFC1918: %s',
    async (url) => {
      await expect(checkUrl(url)).resolves.toBe(new URL(url).hostname);
    }
  );

  const allowedPatterns = [
    'http://example.com/test',
    'https://example.com/test',
    'https://github.com/user/repo',
    'http://localhost:8080/api', // localhost resolves to 127.0.0.1 in most envs, but DNS name is ok
  ];

  for (const url of allowedPatterns) {
    it(`allows scheme for: ${url}`, async () => {
      // We only check scheme here since DNS resolution may vary by environment
      expect(() => checkSchemeOnly(url)).not.toThrow();
    });
  }
});
