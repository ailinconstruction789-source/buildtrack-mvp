import { supabase } from '@/lib/supabase';
import { createLeadWorkApi, LeadWorkApiError, type LeadWorkApi } from './leadWorkClient';

/** Dedicated narrow endpoint. General work/lifecycle stay sealed in central_visits. */
const transport = createLeadWorkApi('visit_follow_up');
export const visitFollowUpApi: LeadWorkApi & { watchIdentity: (onChange: () => void) => () => void } = {
  ...transport,
  read: async scope => {
    const snapshot = await transport.read(scope);
    // Session is used only to discard a stale UI response, never to authorize.
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session || data.session.user.id.toLowerCase() !== snapshot.actor.userId) {
      throw new LeadWorkApiError('ACTOR_CHANGED', 'บัญชีเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่', 409);
    }
    return snapshot;
  },
  watchIdentity: onChange => {
    let identity: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null;
      if (identity !== undefined && identity !== next || identity === undefined && event !== 'INITIAL_SESSION') onChange();
      identity = next;
    });
    return () => data.subscription.unsubscribe();
  },
};
