"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { isSalesStaffRole, type SalesStaffOption } from '@/lib/sales/salesStaff';

const EMPTY_OPTIONS: SalesStaffOption[] = [];

// Screens that already loaded staff pass their list to avoid another request.
export function useSalesStaffOptions(
  isOpen: boolean,
  provided?: SalesStaffOption[],
  accountKey = ''
): SalesStaffOption[] {
  const [loaded, setLoaded] = useState<{ accountKey: string; options: SalesStaffOption[] } | null>(null);

  useEffect(() => {
    if (provided !== undefined || !isOpen) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    setLoaded(null);
    async function load() {
      try {
        const { data, error } = await supabase.from('users').select('id, username, role');
        if (error) throw error;
        if (!cancelled) {
          setLoaded({ accountKey, options: (data || [])
            .filter(staff => isSalesStaffRole(staff.role))
            .map(staff => ({ userId: String(staff.id), displayName: staff.username })) });
        }
      } catch {
        if (!cancelled) setLoaded(null);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [isOpen, provided, accountKey]);

  return provided ?? (isOpen && loaded?.accountKey === accountKey ? loaded.options : EMPTY_OPTIONS);
}
