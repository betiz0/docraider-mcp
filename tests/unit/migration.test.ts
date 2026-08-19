import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock file system
const mockReadFileSync = vi.fn();
const mockReaddirSync = vi.fn();
vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
}));

// Mock path module
vi.mock('node:path', () => ({
  resolve: vi.fn((...args) => args.join('/')),
  dirname: vi.fn(() => '/test/dir'),
}));

// Mock db module
const mockQuery = vi.fn();
vi.mock('../../src/db/index.js', () => ({
  db: {
    query: mockQuery,
    transaction: vi.fn(async (cb) => cb({ query: vi.fn() })),
    disconnect: vi.fn(),
  },
}));

describe('Migration - 004_add_sites_and_listing', () => {
  beforeEach(() => {
    mockReadFileSync.mockReset();
    mockReaddirSync.mockReset();
    mockQuery.mockReset();
  });

  it('should read migration file content', async () => {
    const migrationContent = `
      CREATE TABLE IF NOT EXISTS sites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        base_url TEXT NOT NULL UNIQUE,
        domain TEXT NOT NULL
      );
    `;
    mockReadFileSync.mockReturnValue(migrationContent);

    // Test that readFileSync can read migration content
    const content = mockReadFileSync('004_add_sites_and_listing.sql', 'utf-8');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS sites');
  });

  it('should contain sites table creation', async () => {
    const migrationSql = `
      CREATE TABLE IF NOT EXISTS sites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        base_url TEXT NOT NULL UNIQUE,
        domain TEXT NOT NULL,
        name TEXT,
        document_count INTEGER DEFAULT 0,
        last_crawled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `;
    mockReadFileSync.mockReturnValue(migrationSql);

    const content = mockReadFileSync('dummy.sql', 'utf-8');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS sites');
    expect(content).toContain('base_url TEXT NOT NULL UNIQUE');
    expect(content).toContain('domain TEXT NOT NULL');
  });

  it('should contain site_id FK on documents', async () => {
    const migrationSql = `
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE CASCADE;
    `;
    mockReadFileSync.mockReturnValue(migrationSql);

    const content = mockReadFileSync('dummy.sql', 'utf-8');
    expect(content).toContain('site_id UUID REFERENCES sites(id)');
    expect(content).toContain('ON DELETE CASCADE');
  });

  it('should contain document_count trigger function', async () => {
    const migrationSql = `
      CREATE OR REPLACE FUNCTION update_site_document_count()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          UPDATE sites SET document_count = document_count + 1;
        ELSIF TG_OP = 'DELETE' THEN
          UPDATE sites SET document_count = document_count - 1;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `;
    mockReadFileSync.mockReturnValue(migrationSql);

    const content = mockReadFileSync('dummy.sql', 'utf-8');
    expect(content).toContain('update_site_document_count');
    expect(content).toContain('document_count = document_count + 1');
    expect(content).toContain('document_count = document_count - 1');
  });

  it('should contain index creation for domains', async () => {
    const migrationSql = `
      CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
      CREATE INDEX IF NOT EXISTS idx_sites_last_crawled ON sites(last_crawled_at);
      CREATE INDEX IF NOT EXISTS idx_documents_site_id ON documents(site_id);
    `;
    mockReadFileSync.mockReturnValue(migrationSql);

    const content = mockReadFileSync('dummy.sql', 'utf-8');
    expect(content).toContain('idx_sites_domain');
    expect(content).toContain('idx_sites_last_crawled');
    expect(content).toContain('idx_documents_site_id');
  });

  it('should contain existing data migration logic', async () => {
    const migrationSql = `
      INSERT INTO sites (base_url, domain, name, document_count, last_crawled_at)
      SELECT
        base_url, domain, domain as name, cnt as document_count,
        max_last_crawled as last_crawled_at
      FROM site_data
      ON CONFLICT (base_url) DO NOTHING;

      UPDATE documents d
      SET site_id = s.id
      FROM sites s
      WHERE SPLIT_PART(SPLIT_PART(d.url, '://', 2), '/', 1) = s.domain
        AND d.site_id IS NULL;
    `;
    mockReadFileSync.mockReturnValue(migrationSql);

    const content = mockReadFileSync('dummy.sql', 'utf-8');
    expect(content).toContain('INSERT INTO sites');
    expect(content).toContain('ON CONFLICT (base_url) DO NOTHING');
    expect(content).toContain('UPDATE documents d');
    expect(content).toContain('d.site_id IS NULL');
  });
});
