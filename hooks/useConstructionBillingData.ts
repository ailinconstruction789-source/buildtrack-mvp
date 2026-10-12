import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchPaginatedRows } from '@/lib/fetchPaginatedRows';
import { useCommittedRequestScope } from '@/hooks/useCommittedRequestScope';

export interface ConstructionBillingActor {
  id?: unknown;
  userId?: unknown;
  authUserId?: unknown;
  username?: string;
  name?: string;
  role?: string;
}

export interface ConstructionBillingRow {
  assignment_id: number | string;
  [column: string]: unknown;
}

/** Read billing pages only for the current actor/view; never publish partial snapshots. */
export function useConstructionBillingData(loggedInUser: ConstructionBillingActor | null | undefined, active: boolean) {
  const actorKey = loggedInUser ? JSON.stringify([
    loggedInUser.id, loggedInUser.userId, loggedInUser.authUserId,
    loggedInUser.username, loggedInUser.name, loggedInUser.role,
  ]) : null;
  const captureScope = useCommittedRequestScope(JSON.stringify([actorKey, active]));
  const currentScope = useRef({ actorKey, active, mounted: false });
  const request = useRef<{ version: number; controller: AbortController | null }>({ version: 0, controller: null });
  const currentCallbacks = useRef<{
    fetch: (() => Promise<void>) | null;
    set: ((value: SetStateAction<ConstructionBillingRow[]>) => void) | null;
  }>({ fetch: null, set: null });
  const [snapshot, setSnapshot] = useState<{ actorKey: string | null; rows: ConstructionBillingRow[] }>({ actorKey, rows: [] });
  const [loading, setLoading] = useState<{ actorKey: string | null; value: boolean }>({ actorKey, value: false });

  useLayoutEffect(() => {
    currentScope.current = { actorKey, active, mounted: true };
    setSnapshot(previous => previous.actorKey === actorKey ? previous : { actorKey, rows: [] });
    setLoading({ actorKey, value: false });
    return () => {
      currentScope.current.mounted = false;
      request.current.version++;
      request.current.controller?.abort();
      request.current.controller = null;
    };
  }, [actorKey, active]);

  const fetchBillingData: () => Promise<void> = useCallback(async () => {
    const isBoundToCurrentActor = () => actorKey !== null && active && currentScope.current.mounted
      && currentScope.current.active && currentScope.current.actorKey === actorKey
      && currentCallbacks.current.fetch === fetchBillingData;
    if (!isBoundToCurrentActor()) return;
    const isCurrentScope = captureScope();
    const version = ++request.current.version;
    request.current.controller?.abort();
    const controller = new AbortController();
    request.current.controller = controller;
    const isCurrent = () => isBoundToCurrentActor() && isCurrentScope() && request.current.version === version;
    setLoading({ actorKey, value: true });
    try {
      const rows = await fetchPaginatedRows<ConstructionBillingRow>(async (from, to) => {
        if (!isCurrent()) throw new Error('Billing request is no longer active');
        const { data, error } = await supabase.from('vw_billing_queue')
          .select('*')
          .order('latest_update_created_at', { ascending: false })
          .order('assignment_id', { ascending: true })
          .range(from, to)
          .abortSignal(controller.signal);
        if (!isCurrent()) throw new Error('Billing request is no longer active');
        if (error) throw error;
        if (!data) throw new Error('Billing response did not contain rows');
        return { data: data as ConstructionBillingRow[] };
      });
      if (isCurrent()) setSnapshot(previous => isCurrent() ? { actorKey, rows } : previous);
    } catch {
      if (isCurrent()) console.error('Error fetching billing data: unable to refresh the current snapshot');
    } finally {
      if (isCurrent()) {
        request.current.controller = null;
        setLoading(previous => isCurrent() ? { actorKey, value: false } : previous);
      }
    }
  }, [actorKey, active, captureScope]);

  const setBillingData: (value: SetStateAction<ConstructionBillingRow[]>) => void = useCallback((value: SetStateAction<ConstructionBillingRow[]>) => {
    const isBoundToCurrentActor = () => actorKey !== null && active && currentScope.current.mounted
      && currentScope.current.active && currentScope.current.actorKey === actorKey
      && currentCallbacks.current.set === setBillingData;
    if (!isBoundToCurrentActor()) return;
    const isCurrentScope = captureScope();
    setSnapshot(previous => {
      if (!isBoundToCurrentActor() || !isCurrentScope()) return previous;
      const rows = previous.actorKey === actorKey ? previous.rows : [];
      return { actorKey, rows: typeof value === 'function' ? value(rows) : value };
    });
  }, [actorKey, active, captureScope]);

  useLayoutEffect(() => {
    currentCallbacks.current = { fetch: fetchBillingData, set: setBillingData };
    return () => { currentCallbacks.current = { fetch: null, set: null }; };
  }, [fetchBillingData, setBillingData]);

  useEffect(() => { void fetchBillingData(); }, [fetchBillingData]);

  return {
    billingData: snapshot.actorKey === actorKey ? snapshot.rows : [],
    loadingBilling: active && loading.actorKey === actorKey && loading.value,
    fetchBillingData,
    setBillingData,
  };
}
