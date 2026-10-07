'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';

export const NOTIFICATION_REFRESH_DELAY_MS = 15_000;
type Availability = 'active' | 'hidden' | 'offline';

export function notificationRefreshAvailability(): Availability {
    if (typeof document === 'undefined' || typeof navigator === 'undefined') return 'hidden';
    if (navigator.onLine === false) return 'offline';
    return document.visibilityState === 'visible' ? 'active' : 'hidden';
}
function subscribe(listener: () => void) {
    document.addEventListener('visibilitychange', listener);
    window.addEventListener('online', listener);
    window.addEventListener('offline', listener);
    return () => {
        document.removeEventListener('visibilitychange', listener);
        window.removeEventListener('online', listener);
        window.removeEventListener('offline', listener);
    };
}
const serverAvailability = (): Availability => 'hidden';

/** Inbox reads only. No scheduler/worker, acknowledgment or authority lives here.
 * The caller owns the shared GET/POST lock and reports failures. Wait after each
 * settled read, never accumulate missed ticks. In-flight work is not cancelled.
 */
export function useNotificationRefresh({ enabled, busy, refresh }: {
    enabled: boolean; busy: boolean; refresh: () => Promise<void>;
}): Availability {
    const availability = useSyncExternalStore(subscribe, notificationRefreshAvailability, serverAvailability);
    const resumePending = useRef(false);
    useEffect(() => {
        if (!enabled) { resumePending.current = false; return; }
        if (availability !== 'active') { resumePending.current = true; return; }
        if (busy) return;
        let disposed = false;
        let timer: ReturnType<typeof setTimeout>;
        function schedule(delay: number) {
            timer = setTimeout(() => {
                if (disposed || notificationRefreshAvailability() !== 'active') return;
                resumePending.current = false;
                // The finally-equivalent scheduling also handles a fast read
                // whose busy=true/false updates are batched into one render.
                const settled = () => { if (!disposed) schedule(NOTIFICATION_REFRESH_DELAY_MS); };
                void refresh().then(settled, settled);
            }, delay);
        }
        schedule(resumePending.current ? 0 : NOTIFICATION_REFRESH_DELAY_MS);
        return () => { disposed = true; clearTimeout(timer); };
    }, [availability, busy, enabled, refresh]);
    return availability;
}
