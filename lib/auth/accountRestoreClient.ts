import { supabase } from '@/lib/supabase';
import { record } from './accountAccessContracts';
import { parseRestoreRequest, parseRestoreReceipt, RestoreError, RESTORE_ERRORS, type RestoreRequest } from './accountRestoreContracts';

export async function restoreAccountAccess(input: RestoreRequest) {
  let sent=false;
  try {
    const request=parseRestoreRequest(input);
    const before=await supabase.auth.getSession(), session=before.data?.session;
    if (before.error || !session?.access_token || session.user?.id!==request.actorId) throw new RestoreError('UNAUTHENTICATED');
    const current=async () => {
      const after=await supabase.auth.getSession();
      if (after.error || after.data?.session?.user.id!==request.actorId || after.data.session.access_token!==session.access_token) {
        // Do not let another account see the acknowledgement. A sent command may
        // have committed; never automatically retry it with a different session.
        throw new RestoreError('RESULT_UNKNOWN');
      }
    };
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20_000);
    let response:Response, envelope:unknown;
    try {
      sent=true;
      response=await fetch('/api/admin/account-access/restore',{method:'POST',credentials:'omit',cache:'no-store',signal:controller.signal,
        headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(request)});
      await current();
      envelope=await response.json();
      await current();
    } finally { clearTimeout(timer); }
    if (!response.ok && record(envelope) && !('data' in envelope) && record(envelope.error)
      && typeof envelope.error.code==='string' && Object.hasOwn(RESTORE_ERRORS,envelope.error.code)) {
      const code=envelope.error.code as keyof typeof RESTORE_ERRORS;
      if (response.status===RESTORE_ERRORS[code].status) throw new RestoreError(code);
    }
    if (response.status!==200 || !record(envelope) || 'error' in envelope) throw new RestoreError('RESULT_UNKNOWN');
    return parseRestoreReceipt(envelope.data,request);
  } catch (error) {
    throw error instanceof RestoreError?error:new RestoreError(sent?'RESULT_UNKNOWN':'UNAUTHENTICATED');
  }
}
