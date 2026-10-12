import { supabase } from '@/lib/supabase';

/**
 * Fetches all rows from a Supabase table by chunking with range(from, to),
 * bypassing Supabase PostgREST default 1,000 rows limit.
 */
export async function fetchSalesWithoutLimit<T = any>(
  table: string,
  options?: {
    select?: string;
    orderBy?: string;
    ascending?: boolean;
    filterCol?: string;
    filterVal?: any;
    chunkSize?: number;
  }
): Promise<T[]> {
  const {
    select = '*',
    orderBy = 'created_at',
    ascending = false,
    filterCol,
    filterVal,
    chunkSize = 1000
  } = options || {};

  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 1000) {
    throw new Error('Invalid sales pagination chunk size');
  }

  let allRows: T[] = [];
  let from = 0;
  let activeOrder = orderBy || 'id';

  while (true) {
    let query = supabase.from(table).select(select);
    if (filterCol && filterVal !== undefined && filterVal !== null) {
      query = query.eq(filterCol, filterVal);
    }
    query = query.order(activeOrder, { ascending });
    if (activeOrder !== 'id') {
      query = query.order('id', { ascending });
    }
    query = query.range(from, from + chunkSize - 1);

    const { data, error } = await query;
    if (error) {
      // Only a missing sort column can use the fallback. Restart from page one
      // so pages with different orders never get merged; keep the same filter.
      if (activeOrder !== 'id' && error.code === '42703' && error.message.includes(activeOrder)) {
        activeOrder = 'id';
        allRows = [];
        from = 0;
        continue;
      }
      throw new Error(`Failed to load ${table} rows at ${from}: ${error.message}`, { cause: error });
    }

    const rows = (data || []) as T[];
    allRows.push(...rows);
    if (rows.length < chunkSize) return allRows;
    from += chunkSize;
  }
}
