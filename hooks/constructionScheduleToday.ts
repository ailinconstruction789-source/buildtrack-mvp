import { useEffect, useState } from 'react';

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Keep calendar views current overnight without a recurring polling interval. */
export function useConstructionScheduleToday() {
  const [today, setToday] = useState(startOfToday);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      const current = startOfToday();
      setToday(previous => previous.getTime() === current.getTime() ? previous : current);
      const tomorrow = new Date(current);
      tomorrow.setDate(tomorrow.getDate() + 1);
      clearTimeout(timer);
      timer = setTimeout(refresh, Math.max(1, tomorrow.getTime() - Date.now() + 25));
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return today;
}
