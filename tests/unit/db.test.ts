import { describe, it, expect, vi } from 'vitest';

// Mock pg module before any imports
const poolEnd = vi.fn().mockResolvedValue(undefined);
const poolConnect = vi.fn().mockResolvedValue({ release: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) });
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    end: poolEnd,
    connect: poolConnect,
  })),
}));

describe('DatabaseManager', () => {
  it('should create a pool with correct configuration', async () => {
    const { DatabaseManager } = await import('../../src/db/index.js');
    const PoolMock = vi.mocked((await import('pg')).Pool);
    
    const manager = new DatabaseManager();
    // Pool creation is intentionally lazy so configuration errors cannot create
    // DB resources before an entrypoint has finished resolving configuration.
    expect(PoolMock).not.toHaveBeenCalled();
    await manager.connect();

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

  it('closes and clears an owned pool when initial connection fails', async () => {
    const { DatabaseManager } = await import('../../src/db/index.js');
    poolConnect.mockRejectedValueOnce(new Error('connect failed'));
    const manager = new DatabaseManager();
    await expect(manager.connect()).rejects.toThrow('connect failed');
    expect(poolEnd).toHaveBeenCalled();
  });
});