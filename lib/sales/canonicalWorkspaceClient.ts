import { supabase } from '@/lib/supabase';
import { centralApi } from './centralClient';
import { projectSalesApi } from './projectSalesClient';
import { readCanonicalWorkspace } from './canonicalWorkspace';

/** Existing same-caller API boundaries; no direct SELECT on protected CRM tables. */
export const canonicalWorkspaceApi = {
  watchIdentity: (changed: () => void) => centralApi.watchIdentity!(changed),
  async read(options: { projectName?: string | null; isCurrent?: () => boolean } = {}) {
    const initial = await supabase.auth.getSession();
    if (initial.error || !initial.data.session) throw new Error('กรุณาเข้าสู่ระบบก่อนดูข้อมูลลูกค้า');
    const actor = initial.data.session.user.id;
    const result = await readCanonicalWorkspace({ central: centralApi, projectSales: projectSalesApi, ...options });
    const final = await supabase.auth.getSession();
    if (final.error || final.data.session?.user.id !== actor || result.actor.userId !== actor || options.isCurrent?.() === false) {
      throw new Error('บัญชีเปลี่ยนระหว่างโหลด กรุณาเปิดรายการใหม่');
    }
    return result;
  },
};
