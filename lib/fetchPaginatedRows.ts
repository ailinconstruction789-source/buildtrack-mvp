export interface PageResult<T> {
  data: T[] | null;
  count?: number | null;
}

/** Keep page order while overlapping a bounded number of reads after an exact count. */
export async function fetchPaginatedRows<T>(
  readPage: (from: number, to: number, requestCount: boolean) => Promise<PageResult<T>>,
  { pageSize = 1000, concurrency = 1 }: { pageSize?: number; concurrency?: number } = {},
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1
    || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 3) {
    throw new Error('Invalid pagination options');
  }

  const first = await readPage(0, pageSize - 1, concurrency > 1);
  const rows = [...(first.data || [])];
  if (!first.data || first.data.length < pageSize) return rows;

  let from = pageSize;
  let lastPageSize = first.data.length;
  const count = first.count;
  if (concurrency > 1 && typeof count === 'number'
    && Number.isSafeInteger(count) && count >= rows.length) {
    while (from < count) {
      const batchSize = Math.min(concurrency, Math.ceil((count - from) / pageSize));
      const pages = await Promise.all(Array.from({ length: batchSize }, (_, index) => {
        const start = from + index * pageSize;
        return readPage(start, start + pageSize - 1, false);
      }));
      for (const page of pages) {
        if (!page.data) return rows;
        rows.push(...page.data);
        from += pageSize;
        lastPageSize = page.data.length;
        if (lastPageSize < pageSize) return rows;
      }
    }
  }

  // A missing count falls back to sequential reads. Also check past a full final
  // page so records added since the first count are not silently omitted.
  while (lastPageSize === pageSize) {
    const page = await readPage(from, from + pageSize - 1, false);
    if (!page.data) break;
    rows.push(...page.data);
    lastPageSize = page.data.length;
    from += pageSize;
  }
  return rows;
}
