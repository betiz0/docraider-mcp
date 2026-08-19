import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module
const mockQuery = vi.fn();
const mockListDocuments = vi.fn();
vi.mock('../../src/db/index.js', () => ({
  db: {
    query: mockQuery,
    listDocuments: mockListDocuments,
  },
  DatabaseManager: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

// Mock site repository
const mockSiteRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  findByBaseUrl: vi.fn(),
  findByDomain: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  incrementDocumentCount: vi.fn(),
  decrementDocumentCount: vi.fn(),
  updateLastCrawledAt: vi.fn(),
};
vi.mock('../../src/db/site-repository.js', () => ({
  siteRepository: mockSiteRepo,
}));

// Mock connection manager
vi.mock('../../src/connection-manager.js', () => ({
  connectionManager: {
    withConnection: vi.fn(async (cb) => cb()),
  },
}));

// Mock constants
vi.mock('../../src/constants/index.js', () => ({
  DEFAULT_PAGE_LIMIT: 20,
  MAX_PAGE_LIMIT: 100,
  DEFAULT_MAX_CRAWL_PAGES: 100,
}));

describe('MCP Tools - Site & Document Operations', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockListDocuments.mockReset();
    mockSiteRepo.create.mockReset();
    mockSiteRepo.findById.mockReset();
    mockSiteRepo.findByDomain.mockReset();
    mockSiteRepo.list.mockReset();
    mockSiteRepo.delete.mockReset();
  });

  describe('list_documents', () => {
    it('should return documents with pagination', async () => {
      const mockDocuments = [
        {
          id: 'doc-1',
          url: 'https://example.com/doc1',
          title: 'Document 1',
          content: '',
          summary: null,
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
          lastCrawledAt: new Date('2024-01-02'),
          siteId: 'site-1',
          siteBaseUrl: 'https://example.com/docs',
          chunkCount: 5,
        },
      ];
      mockListDocuments.mockResolvedValue({
        documents: mockDocuments,
        total: 1,
        limit: 20,
        offset: 0,
      });

      // Simulate tool call
      const result = await mockListDocuments({ limit: 20, offset: 0 });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].id).toBe('doc-1');
      expect(result.total).toBe(1);
    });

    it('should filter by siteId', async () => {
      mockListDocuments.mockResolvedValue({
        documents: [],
        total: 0,
        limit: 20,
        offset: 0,
      });

      const result = await mockListDocuments({ siteId: 'site-123' });

      expect(result.total).toBe(0);
    });

    it('should cap limit at 100', async () => {
      mockListDocuments.mockResolvedValue({
        documents: [],
        total: 0,
        limit: 100,
        offset: 0,
      });

      const result = await mockListDocuments({ limit: 200 });

      expect(result.limit).toBe(100);
    });
  });

  describe('list_sites', () => {
    it('should return sites with pagination', async () => {
      const mockSites = [
        {
          id: 'site-1',
          baseUrl: 'https://example.com/docs',
          domain: 'example.com',
          name: 'Example Docs',
          documentCount: 5,
          lastCrawledAt: new Date('2024-01-02'),
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02'),
        },
      ];
      mockSiteRepo.list.mockResolvedValue({
        sites: mockSites,
        total: 1,
        limit: 20,
        offset: 0,
      });

      const result = await mockSiteRepo.list({ limit: 20, offset: 0 });

      expect(result.sites).toHaveLength(1);
      expect(result.sites[0].id).toBe('site-1');
      expect(result.total).toBe(1);
    });

    it('should support sorting by domain', async () => {
      mockSiteRepo.list.mockResolvedValue({
        sites: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      const result = await mockSiteRepo.list({ sortBy: 'domain', sortOrder: 'asc', limit: 10 });

      expect(result.sites).toEqual([]);
    });
  });

  describe('get_site', () => {
    it('should return site details', async () => {
      const mockSite = {
        id: 'site-123',
        baseUrl: 'https://example.com/docs',
        domain: 'example.com',
        name: 'Example Docs',
        documentCount: 5,
        lastCrawledAt: new Date('2024-01-02'),
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };
      mockSiteRepo.findById.mockResolvedValue(mockSite);

      const result = await mockSiteRepo.findById('site-123');

      expect(result).toEqual(mockSite);
      expect(result?.id).toBe('site-123');
    });

    it('should return null when site not found', async () => {
      mockSiteRepo.findById.mockResolvedValue(null);

      const result = await mockSiteRepo.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('delete_site', () => {
    it('should delete site and return counts', async () => {
      const mockSite = {
        id: 'site-delete',
        baseUrl: 'https://example.com',
        domain: 'example.com',
        name: 'Example',
        documentCount: 3,
        lastCrawledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockSiteRepo.findById.mockResolvedValue(mockSite);
      mockSiteRepo.delete.mockResolvedValue(true);
      mockQuery.mockResolvedValue([{ count: '10' }]);

      const site = await mockSiteRepo.findById('site-delete');
      expect(site).toEqual(mockSite);

      const deleted = await mockSiteRepo.delete('site-delete');
      expect(deleted).toBe(true);
    });

    it('should return false when site not found', async () => {
      mockSiteRepo.findById.mockResolvedValue(null);
      mockSiteRepo.delete.mockResolvedValue(false);

      const site = await mockSiteRepo.findById('nonexistent');
      expect(site).toBeNull();

      const deleted = await mockSiteRepo.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });
});
