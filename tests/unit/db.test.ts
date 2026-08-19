import { describe, it, expect, vi } from 'vitest';

// Mock pg module before any imports
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    end: vi.fn(),
    connect: vi.fn().mockResolvedValue({ release: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) }),
  })),
}));

describe('DatabaseManager', () => {
  it('should create a pool with correct configuration', async () => {
    const { DatabaseManager } = await import('../../src/db/index.js');
    const PoolMock = vi.mocked((await import('pg')).Pool);
    
    new DatabaseManager(); // eslint-disable-line @typescript-eslint/no-unused-vars
    
    expect(PoolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: expect.any(String),
        port: expect.any(Number),
        database: expect.any(String),
        user: expect.any(String),
        max: expect.any(Number),
        min: expect.any(Number),
      })
    );
  });
});