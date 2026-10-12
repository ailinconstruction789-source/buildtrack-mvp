import { describe, expect, it, vi } from 'vitest';
import { fetchPaginatedRows } from '../fetchPaginatedRows';

describe('bounded pagination', () => {
  it('loads every row in page order even when later pages arrive first', async () => {
    const source = Array.from({ length: 13087 }, (_, id) => ({ id }));
    let active = 0;
    let maximumActive = 0;
    const read = vi.fn(async (from: number, to: number, requestCount: boolean) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, from === 1000 ? 10 : 0));
      active--;
      return { data: source.slice(from, to + 1), count: requestCount ? source.length : null };
    });
    expect(await fetchPaginatedRows(read, { concurrency: 3 })).toEqual(source);
    expect(maximumActive).toBe(3);
    expect(read).toHaveBeenCalledTimes(14);
    expect(read.mock.calls.filter(([, , count]) => count)).toHaveLength(1);
  });

  it('uses the filtered count without fetching pages belonging to other projects', async () => {
    const rows = Array.from({ length: 1177 }, (_, id) => ({ id, project: 'selected' }));
    const read = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), count: rows.length }));
    expect(await fetchPaginatedRows(read, { concurrency: 3 })).toEqual(rows);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('loads a 1372-row view without an id or exact count', async () => {
    const rows = Array.from({ length: 1372 }, (_, hour) => ({ date: '2026-10-07', hour }));
    const read = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1) }));
    expect(await fetchPaginatedRows(read)).toEqual(rows);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('falls back to sequential pages when the API does not return a count', async () => {
    const rows = Array.from({ length: 3001 }, (_, id) => ({ id }));
    let active = 0;
    let maximumActive = 0;
    const read = vi.fn(async (from: number, to: number) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active--;
      return { data: rows.slice(from, to + 1), count: null };
    });
    expect(await fetchPaginatedRows(read, { concurrency: 3 })).toEqual(rows);
    expect(maximumActive).toBe(1);
  });

  it('checks beyond a full final page and includes rows added after the count', async () => {
    const rows = Array.from({ length: 3001 }, (_, id) => ({ id }));
    const read = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), count: 2000 }));
    expect(await fetchPaginatedRows(read, { concurrency: 3 })).toEqual(rows);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('stops at a short page if rows were deleted after counting', async () => {
    const rows = Array.from({ length: 1001 }, (_, id) => ({ id }));
    const read = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), count: 5000 }));
    expect(await fetchPaginatedRows(read, { concurrency: 3 })).toEqual(rows);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('rejects a failed later page so a strict caller cannot publish incomplete data', async () => {
    const read = vi.fn(async (from: number) => {
      if (from === 2000) throw new Error('page failed');
      return { data: Array.from({ length: 1000 }, (_, id) => ({ id: from + id })), count: 4000 };
    });
    await expect(fetchPaginatedRows(read, { concurrency: 3 })).rejects.toThrow('page failed');
  });

  it('retains the existing prefix for a non-strict reader that reports a failed page', async () => {
    const first = Array.from({ length: 1000 }, (_, id) => ({ id }));
    const read = vi.fn(async (from: number) => ({ data: from === 0 ? first : null, count: 4000 }));
    expect(await fetchPaginatedRows(read, { concurrency: 3 })).toEqual(first);
  });

  it('does not fetch extra pages for an empty table', async () => {
    const read = vi.fn(async () => ({ data: [], count: 0 }));
    expect(await fetchPaginatedRows(read, { concurrency: 3 })).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('rejects concurrency above the limit', async () => {
    const read = vi.fn();
    await expect(fetchPaginatedRows(read, { concurrency: 4 })).rejects.toThrow('Invalid pagination');
    expect(read).not.toHaveBeenCalled();
  });
});
