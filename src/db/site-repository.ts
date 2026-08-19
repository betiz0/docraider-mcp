import { db } from './index.js';
import type { Site, SiteListParams, SiteWithPagination } from './types.js';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../constants/index.js';

export class SiteRepository {
  async create(data: {
    baseUrl: string;
    domain: string;
    name?: string | null;
    lastCrawledAt?: Date | null;
  }): Promise<Site> {
    const result = await db.query<Site>(
      `INSERT INTO sites (base_url, domain, name, last_crawled_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.baseUrl, data.domain, data.name ?? null, data.lastCrawledAt ?? null]
    );
    return result[0];
  }

  async findById(id: string): Promise<Site | null> {
    const result = await db.query<Site>('SELECT * FROM sites WHERE id = $1', [id]);
    return result[0] ?? null;
  }

  async findByBaseUrl(baseUrl: string): Promise<Site | null> {
    const result = await db.query<Site>('SELECT * FROM sites WHERE base_url = $1', [baseUrl]);
    return result[0] ?? null;
  }

  async findByDomain(domain: string): Promise<Site | null> {
    const result = await db.query<Site>('SELECT * FROM sites WHERE domain = $1', [domain]);
    return result[0] ?? null;
  }

  async list(params: SiteListParams = {}): Promise<SiteWithPagination> {
    const limit = Math.min(params.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const offset = params.offset ?? 0;
    const sortBy = params.sortBy ?? 'last_crawled_at';
    const sortOrder = params.sortOrder ?? 'desc';

    const allowedSortColumns = ['last_crawled_at', 'created_at', 'domain', 'name'];
    const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'last_crawled_at';

    const [sites, totalResult] = await Promise.all([
      db.query<Site>(
        `SELECT * FROM sites
         ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      db.query<{ count: string }>('SELECT COUNT(*) FROM sites', []),
    ]);

    return {
      sites,
      total: parseInt(totalResult[0].count, 10),
      limit,
      offset,
    };
  }

  async update(id: string, updates: Partial<Omit<Site, 'id' | 'createdAt'>>): Promise<Site | null> {
    const setClause = Object.keys(updates)
      .map((key, i) => `"${key}" = $${i + 1}`)
      .join(', ');
    const values = Object.values(updates);
    values.push(id);

    const result = await db.query<Site>(
      `UPDATE sites SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    return result[0] ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.query<{ id: string }>('DELETE FROM sites WHERE id = $1 RETURNING id', [id]);
    return result.length > 0;
  }

  async incrementDocumentCount(id: string): Promise<void> {
    await db.query(
      'UPDATE sites SET document_count = document_count + 1, updated_at = NOW() WHERE id = $1',
      [id]
    );
  }

  async decrementDocumentCount(id: string): Promise<void> {
    await db.query(
      'UPDATE sites SET document_count = document_count - 1, updated_at = NOW() WHERE id = $1',
      [id]
    );
  }

  async updateLastCrawledAt(id: string): Promise<void> {
    await db.query('UPDATE sites SET last_crawled_at = NOW(), updated_at = NOW() WHERE id = $1', [id]);
  }
}

export const siteRepository = new SiteRepository();