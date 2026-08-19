import { describe, it, expect, vi } from 'vitest';
import { ConnectionManager } from '../../src/connection-manager.js';

describe('ConnectionManager', () => {
  it('should create instance with default max connections', () => {
    const manager = new ConnectionManager(5);
    expect(manager).toBeDefined();
  });

  it('should track current connections', () => {
    const manager = new ConnectionManager(10);
    expect(manager.getCurrentConnections()).toBe(0);
  });

  it('should execute withConnection successfully', async () => {
    const manager = new ConnectionManager(5);
    const result = await manager.withConnection(async () => {
      return 'test-result';
    });
    expect(result).toBe('test-result');
    expect(manager.getCurrentConnections()).toBe(0);
  });

  it('should limit concurrent connections', async () => {
    const manager = new ConnectionManager(2);
    let activeCount = 0;
    let maxActiveCount = 0;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      manager.withConnection(async () => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 50));
        activeCount--;
        return i;
      })
    );

    const results = await Promise.all(tasks);
    expect(results).toHaveLength(5);
    expect(maxActiveCount).toBeLessThanOrEqual(2);
  });

  it('should throw error when connection limit exceeded with timeout', async () => {
    const manager = new ConnectionManager(1, 50);

    // Start a long-running connection
    const longRunning = manager.withConnection(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return 'done';
    });

    // Wait a bit for the first to acquire
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Try to acquire another connection (should timeout)
    await expect(
      manager.withConnection(async () => 'should-fail')
    ).rejects.toThrow();

    await longRunning;
  });
});