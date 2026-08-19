import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module
const mockQuery = vi.fn();
vi.mock('../../src/db/index.js', () => ({
  db: {
    query: mockQuery,
  },
}));

vi.mock('../../src/constants/index.js', () => ({
  DEFAULT_PAGE_LIMIT: 20,
  MAX_PAGE_LIMIT: 100,
}));

describe('SiteRepository', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('create', () => {
    it('should create a site with all fields', async () => {
      const mockSite = {
        id: 'site-123',
        baseUrl: 'https://example.com/docs',
        domain: 'example.com',
        name: 'Example Docs',
        documentCount: 0,
        lastCrawledAt: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };
      mockQuery.mockResolvedValue([mockSite]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      const site = await siteRepository.create({
        baseUrl: 'https://example.com/docs',
        domain: 'example.com',
        name: 'Example Docs',
      });

      expect(site).toEqual(mockSite);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sites'),
        ['https://example.com/docs', 'example.com', 'Example Docs', null]
      );
    });

    it('should create a site without name', async () => {
      const mockSite = {
        id: 'site-456',
        baseUrl: 'https://test.com/api',
        domain: 'test.com',
        name: null,
        documentCount: 0,
        lastCrawledAt: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };
      mockQuery.mockResolvedValue([mockSite]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      const site = await siteRepository.create({
        baseUrl: 'https://test.com/api',
        domain: 'test.com',
      });

      expect(site.name).toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sites'),
        ['https://test.com/api', 'test.com', null, null]
      );
    });
  });

  describe('findById', () => {
    it('should return a site by id', async () => {
      const mockSite = {
        id: 'site-789',
        baseUrl: 'https://example.com',
        domain: 'example.com',
        name: 'Example',
        documentCount: 5,
        lastCrawledAt: new Date('2024-01-01'),
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };
      mockQuery.mockResolvedValue([mockSite]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      const site = await siteRepository.findById('site-789');

      expect(site).toEqual(mockSite);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM sites WHERE id = $1'),
        ['site-789']
      );
    });

    it('should return null when site not found', async () => {
      mockQuery.mockResolvedValue([]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      const site = await siteRepository.findById('nonexistent');

      expect(site).toBeNull();
    });
  });

  describe('findByBaseUrl', () => {
    it('should return a site by baseUrl', async () => {
      const mockSite = {
        id: 'site-base',
        baseUrl: 'https://example.com/docs',
        domain: 'example.com',
        name: 'Example',
        documentCount: 3,
        lastCrawledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockQuery.mockResolvedValue([mockSite]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      const site = await siteRepository.findByBaseUrl('https://example.com/docs');

      expect(site).toEqual(mockSite);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM sites WHERE base_url = $1'),
        ['https://example.com/docs']
      );
    });

    it('should return null when site not found', async () => {
      mockQuery.mockResolvedValue([]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      const site = await siteRepository.findByBaseUrl('https://unknown.com');

      expect(site).toBeNull();
    });
  });

  describe('findByDomain', () => {
    it('should return a site by domain', async () => {
      const mockSite = {
        id: 'site-domain',
        baseUrl: 'https://example.com',
        domain: 'example.com',
        name: 'Example',
        documentCount: 10,
        lastCrawledAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockQuery.mockResolvedValue([mockSite]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      const site = await siteRepository.findByDomain('example.com');

      expect(site).toEqual(mockSite);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM sites WHERE domain = $1'),
        ['example.com']
      );
    });

    it('should return null when site not found', async () => {
      mockQuery.mockResolvedValue([]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      const site = await siteRepository.findByDomain('unknown.com');

      expect(site).toBeNull();
    });
  });

  describe('list', () => {
    it('should return sites with default pagination', async () => {
      const mockSites = [
        {
          id: 'site-1',
          baseUrl: 'https://example1.com',
          domain: 'example1.com',
          name: 'Site 1',
          documentCount: 5,
          lastCrawledAt: new Date('2024-01-02'),
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02'),
        },
        {
          id: 'site-2',
          baseUrl: 'https://example2.com',
          domain: 'example2.com',
          name: 'Site 2',
          documentCount: 3,
          lastCrawledAt: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];
      mockQuery.mockResolvedValueOnce(mockSites).mockResolvedValueOnce([{ count: '2' }]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      const result = await siteRepository.list();

      expect(result.sites).toEqual(mockSites);
      expect(result.total).toBe(2);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('should return sites with custom pagination', async () => {
      const mockSites = [
        {
          id: 'site-3',
          baseUrl: 'https://example3.com',
          domain: 'example3.com',
          name: 'Site 3',
          documentCount: 1,
          lastCrawledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockQuery.mockResolvedValueOnce(mockSites).mockResolvedValueOnce([{ count: '10' }]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      const result = await siteRepository.list({ limit: 5, offset: 10 });

      expect(result.sites).toEqual(mockSites);
      expect(result.total).toBe(10);
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(10);
    });

    it('should cap limit at MAX_PAGE_LIMIT', async () => {
      const mockSites: any[] = [];
      mockQuery.mockResolvedValueOnce(mockSites).mockResolvedValueOnce([{ count: '0' }]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      await siteRepository.list({ limit: 200 });

      // Verify the query was called with capped limit
      const callArgs = mockQuery.mock.calls[0][1];
      expect(callArgs[0]).toBe(100);
    });

    it('should support sorting by domain asc', async () => {
      const mockSites: any[] = [];
      mockQuery.mockResolvedValueOnce(mockSites).mockResolvedValueOnce([{ count: '0' }]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      await siteRepository.list({ sortBy: 'domain', sortOrder: 'asc' });

      expect(mockQuery.mock.calls[0][0]).toMatch(/ORDER BY domain ASC/i);
    });

    it('should reject invalid sort columns', async () => {
      const mockSites: any[] = [];
      mockQuery.mockResolvedValueOnce(mockSites).mockResolvedValueOnce([{ count: '0' }]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      // @ts-expect-error testing invalid input
      await siteRepository.list({ sortBy: 'invalid_field' });

      expect(mockQuery.mock.calls[0][0]).toMatch(/ORDER BY last_crawled_at DESC/i);
    });
  });

  describe('update', () => {
    it('should update a site', async () => {
      const updatedSite = {
        id: 'site-update',
        baseUrl: 'https://example.com',
        domain: 'example.com',
        name: 'Updated Name',
        documentCount: 5,
        lastCrawledAt: new Date('2024-01-01'),
        createdAt: new Date('2023-01-01'),
        updatedAt: new Date('2024-01-02'),
      };
      mockQuery.mockResolvedValue([updatedSite]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      const result = await siteRepository.update('site-update', { name: 'Updated Name' });

      expect(result).toEqual(updatedSite);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sites SET'),
        expect.arrayContaining(['Updated Name', 'site-update'])
      );
    });
  });

  describe('delete', () => {
    it('should delete a site and return true', async () => {
      mockQuery.mockResolvedValue([{ id: 'site-delete' }]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      const result = await siteRepository.delete('site-delete');

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM sites WHERE id = $1 RETURNING id'),
        ['site-delete']
      );
    });

    it('should return false when site not found', async () => {
      mockQuery.mockResolvedValue([]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      const result = await siteRepository.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('incrementDocumentCount', () => {
    it('should increment document count', async () => {
      mockQuery.mockResolvedValue([]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      await siteRepository.incrementDocumentCount('site-123');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sites SET document_count = document_count + 1'),
        ['site-123']
      );
    });
  });

  describe('decrementDocumentCount', () => {
    it('should decrement document count', async () => {
      mockQuery.mockResolvedValue([]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      await siteRepository.decrementDocumentCount('site-123');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sites SET document_count = document_count - 1'),
        ['site-123']
      );
    });
  });

  describe('updateLastCrawledAt', () => {
    it('should update last_crawled_at to now', async () => {
      mockQuery.mockResolvedValue([]);

      const { siteRepository } = await import('../../src/db/site-repository.js');
      await siteRepository.updateLastCrawledAt('site-123');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sites SET last_crawled_at = NOW()'),
        ['site-123']
      );
    });
  });
});
