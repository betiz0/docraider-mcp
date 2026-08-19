import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the site repository
const mockCreate = vi.fn();
const mockFindByDomain = vi.fn();
vi.mock('../../src/db/site-repository.js', () => ({
  siteRepository: {
    create: mockCreate,
    findById: vi.fn(),
    findByBaseUrl: vi.fn(),
    findByDomain: mockFindByDomain,
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    incrementDocumentCount: vi.fn(),
    decrementDocumentCount: vi.fn(),
    updateLastCrawledAt: vi.fn(),
  },
}));

describe('identifyOrCreateSite', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockFindByDomain.mockReset();
  });

  it('should return existing site when domain exists', async () => {
    const existingSite = {
      id: 'site-existing',
      baseUrl: 'https://example.com/docs',
      domain: 'example.com',
      name: 'Existing Site',
      documentCount: 5,
      lastCrawledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockFindByDomain.mockResolvedValue(existingSite);

    const { identifyOrCreateSite } = await import('../../src/db/site-identification.js');
    const result = await identifyOrCreateSite('https://example.com/docs/some-page');

    expect(result.isNew).toBe(false);
    expect(result.site).toEqual(existingSite);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('should create new site when domain does not exist', async () => {
    mockFindByDomain.mockResolvedValue(null);
    const newSite = {
      id: 'site-new',
      baseUrl: 'https://newsite.com/docs',
      domain: 'newsite.com',
      name: 'New Site',
      documentCount: 0,
      lastCrawledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockCreate.mockResolvedValue(newSite);

    const { identifyOrCreateSite } = await import('../../src/db/site-identification.js');
    const result = await identifyOrCreateSite('https://newsite.com/docs/page', 'New Site - Title');

    expect(result.isNew).toBe(true);
    expect(result.site).toEqual(newSite);
    expect(mockCreate).toHaveBeenCalledWith({
      baseUrl: 'https://newsite.com/docs',
      domain: 'newsite.com',
      name: 'New Site',
    });
  });

  it('should extract baseUrl with doc root path', async () => {
    mockFindByDomain.mockResolvedValue(null);
    mockCreate.mockResolvedValue({
      id: 'site-doc',
      baseUrl: 'https://example.com/docs',
      domain: 'example.com',
      name: null,
      documentCount: 0,
      lastCrawledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { identifyOrCreateSite } = await import('../../src/db/site-identification.js');
    await identifyOrCreateSite('https://example.com/docs/v1/api/reference');

    // URL: https://example.com/docs/v1/api/reference
    // pathParts: ['docs', 'v1', 'api', 'reference']
    // First doc root found at index 0 ('docs')
    // baseUrl = origin + '/' + pathParts[0..1] = https://example.com/docs
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://example.com/docs',
      })
    );
  });

  it('should extract baseUrl with nested doc root', async () => {
    mockFindByDomain.mockResolvedValue(null);
    mockCreate.mockResolvedValue({
      id: 'site-doc',
      baseUrl: 'https://example.com/guide',
      domain: 'example.com',
      name: null,
      documentCount: 0,
      lastCrawledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { identifyOrCreateSite } = await import('../../src/db/site-identification.js');
    await identifyOrCreateSite('https://example.com/guide/en/users/list');

    // URL: https://example.com/guide/en/users/list
    // pathParts: ['guide', 'en', 'users', 'list']
    // 'guide' is in DOC_ROOT_PATHS at index 0
    // baseUrl = origin + '/' + pathParts.slice(0, 1).join('/') = https://example.com/guide
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://example.com/guide',
      })
    );
  });

  it('should use origin as baseUrl when no doc root found', async () => {
    mockFindByDomain.mockResolvedValue(null);
    mockCreate.mockResolvedValue({
      id: 'site-origin',
      baseUrl: 'https://example.com',
      domain: 'example.com',
      name: null,
      documentCount: 0,
      lastCrawledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { identifyOrCreateSite } = await import('../../src/db/site-identification.js');
    await identifyOrCreateSite('https://example.com/some/page/here');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://example.com',
      })
    );
  });

  it('should extract site name from title', async () => {
    mockFindByDomain.mockResolvedValue(null);
    mockCreate.mockResolvedValue({
      id: 'site-name',
      baseUrl: 'https://example.com',
      domain: 'example.com',
      name: 'Example Docs',
      documentCount: 0,
      lastCrawledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { identifyOrCreateSite } = await import('../../src/db/site-identification.js');
    await identifyOrCreateSite('https://example.com/page', 'Example Docs | Documentation');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Example Docs',
      })
    );
  });

  it('should fallback to domain as name when no title', async () => {
    mockFindByDomain.mockResolvedValue(null);
    mockCreate.mockResolvedValue({
      id: 'site-fallback',
      baseUrl: 'https://fallback.com',
      domain: 'fallback.com',
      name: 'fallback.com',
      documentCount: 0,
      lastCrawledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { identifyOrCreateSite } = await import('../../src/db/site-identification.js');
    await identifyOrCreateSite('https://fallback.com/page');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'fallback.com',
      })
    );
  });
});

describe('extractDomain', () => {
  it('should extract domain from valid URL', async () => {
    const { extractDomain } = await import('../../src/db/site-identification.js');
    const domain = extractDomain('https://example.com/docs/page');

    expect(domain).toBe('example.com');
  });

  it('should extract domain with subdomain', async () => {
    const { extractDomain } = await import('../../src/db/site-identification.js');
    const domain = extractDomain('https://docs.example.com/api');

    expect(domain).toBe('docs.example.com');
  });

  it('should return empty string for invalid URL', async () => {
    const { extractDomain } = await import('../../src/db/site-identification.js');
    const domain = extractDomain('not-a-valid-url');

    expect(domain).toBe('');
  });
});

describe('extractBaseUrl', () => {
  it('should extract origin from valid URL', async () => {
    const { extractBaseUrl } = await import('../../src/db/site-identification.js');
    const baseUrl = extractBaseUrl('https://example.com/docs/page');

    expect(baseUrl).toBe('https://example.com');
  });

  it('should extract origin with port', async () => {
    const { extractBaseUrl } = await import('../../src/db/site-identification.js');
    const baseUrl = extractBaseUrl('http://localhost:3000/api');

    expect(baseUrl).toBe('http://localhost:3000');
  });

  it('should return empty string for invalid URL', async () => {
    const { extractBaseUrl } = await import('../../src/db/site-identification.js');
    const baseUrl = extractBaseUrl('invalid-url');

    expect(baseUrl).toBe('');
  });
});
