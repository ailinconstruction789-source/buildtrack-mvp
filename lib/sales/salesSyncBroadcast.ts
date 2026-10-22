/**
 * Cross-window and cross-tab synchronization for Sales CRM, Leads & Project Map
 */
export interface SalesSyncDetail {
  type: string;
  leadId?: string | null;
  saleId?: string | null;
  plotId?: string | null;
  projectName?: string | null;
  timestamp?: number;
  [key: string]: unknown;
}

export const SALES_SYNC_EVENT = 'buildtrack:sales_sync';
export const SALES_SYNC_STORAGE_KEY = 'buildtrack:sales_sync';

/**
 * Broadcasts a sales synchronization event to both the current window (via CustomEvent)
 * and all other open browser tabs (via localStorage).
 */
export function broadcastSalesSync(detail: SalesSyncDetail = { type: 'unknown' }): void {
  const payload: SalesSyncDetail = {
    ...detail,
    timestamp: detail.timestamp || Date.now()
  };

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(SALES_SYNC_EVENT, { detail: payload }));
    } catch (e) {
      // In testing or restricted execution environments
    }

    try {
      localStorage.setItem(SALES_SYNC_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      // Quota exceeded or disabled localStorage
    }
  }
}

/**
 * Subscribes to sales synchronization events from both the current window and other tabs,
 * using a trailing debounce to prevent redundant fetch storms.
 */
export function subscribeToSalesSync(
  callback: (detail: SalesSyncDetail) => void,
  debounceMs = 200
): () => void {
  if (typeof window === 'undefined') return () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastDetail: SalesSyncDetail = { type: 'unknown' };

  const trigger = (detail: SalesSyncDetail) => {
    lastDetail = detail;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      callback(lastDetail);
      timer = null;
    }, debounceMs);
  };

  const handleCustomEvent = (e: Event) => {
    const custom = e as CustomEvent<SalesSyncDetail>;
    trigger(custom.detail || { type: 'custom_event' });
  };

  const handleStorageEvent = (e: StorageEvent) => {
    if (e.key === SALES_SYNC_STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        trigger(parsed);
      } catch {
        trigger({ type: 'storage_event' });
      }
    }
  };

  window.addEventListener(SALES_SYNC_EVENT, handleCustomEvent);
  window.addEventListener('storage', handleStorageEvent);

  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener(SALES_SYNC_EVENT, handleCustomEvent);
    window.removeEventListener('storage', handleStorageEvent);
  };
}
