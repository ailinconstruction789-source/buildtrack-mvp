import { supabase } from '@/lib/supabase';
import { accessUuid, parseAccessQuery, parseAccessSnapshot, record, type AccessQuery, type AccessSnapshot } from './accountAccessContracts';

export interface AccountAccessApi {
  read(scope: AccessQuery): Promise<AccessSnapshot>;
  watch(onInvalidated: () => void): () => void;
}
const safeErrors: Record<string, { status: number; message: string }> = {
  FEATURE_DISABLED:{status:503,message:'ยังไม่เปิดการอ่านสิทธิ์บัญชีจริง'},
  SETUP_REQUIRED:{status:503,message:'ระบบตรวจสิทธิ์ยังติดตั้งไม่ครบ กรุณาติดต่อผู้ดูแล'},
  UNAUTHENTICATED:{status:401,message:'กรุณาเข้าสู่ระบบ BuildTrack ก่อน แล้วกลับมาโหลดใหม่'},
  FORBIDDEN:{status:403,message:'เฉพาะ Admin ที่ได้รับสิทธิ์จัดการบัญชีเท่านั้น'},
  INVALID_INPUT:{status:400,message:'ตัวกรองไม่ถูกต้อง'},
  READ_UNAVAILABLE:{status:503,message:'โหลดข้อมูลไม่ได้ กรุณาลองใหม่ภายหลัง'},
};
async function readCore(scope: AccessQuery): Promise<AccessSnapshot> {
  const params = new URLSearchParams({page:String(scope.page),query:scope.query,status:scope.status});
  const checked = parseAccessQuery(`http://local.invalid/?${params}`);
  const before = await supabase.auth.getSession();
  const session = before.data?.session;
  if (before.error || !session?.access_token || !accessUuid(session.user?.id)) throw new Error(safeErrors.UNAUTHENTICATED.message);
  const current = async () => {
    const after = await supabase.auth.getSession();
    if (after.error || after.data?.session?.user.id !== session.user.id || after.data.session.access_token !== session.access_token) {
      throw new Error('บัญชีหรือเซสชันเปลี่ยนระหว่างโหลด กรุณาตรวจบัญชีแล้วโหลดใหม่');
    }
  };
  let response: Response;
  try { response = await fetch(`/api/admin/account-access?${params}`,{method:'GET',credentials:'omit',cache:'no-store',
    headers:{Authorization:`Bearer ${session.access_token}`}}); }
  catch { await current(); throw new Error('เชื่อมต่อไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'); }
  await current();
  let envelope: unknown;
  try { envelope = await response.json(); } catch { throw new Error('ตรวจข้อมูลที่ตอบกลับไม่ได้ กรุณาโหลดใหม่'); }
  await current();
  if (record(envelope) && !response.ok && !('data' in envelope) && record(envelope.error)
    && typeof envelope.error.code === 'string' && Object.hasOwn(safeErrors,envelope.error.code)) {
    const safe = safeErrors[envelope.error.code];
    if (response.status===safe.status) throw new Error(safe.message);
  }
  if (response.status!==200 || !record(envelope) || 'error' in envelope) throw new Error('ตรวจข้อมูลที่ตอบกลับไม่ได้ กรุณาโหลดใหม่');
  try { return parseAccessSnapshot(envelope.data,session.user.id,checked); } catch { throw new Error('ข้อมูลไม่ตรงกับบัญชีหรือตัวกรอง กรุณาโหลดใหม่'); }
}
const localMessages = new Set([...Object.values(safeErrors).map(item=>item.message),
  'บัญชีหรือเซสชันเปลี่ยนระหว่างโหลด กรุณาตรวจบัญชีแล้วโหลดใหม่',
  'เชื่อมต่อไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่', 'ตรวจข้อมูลที่ตอบกลับไม่ได้ กรุณาโหลดใหม่',
  'ข้อมูลไม่ตรงกับบัญชีหรือตัวกรอง กรุณาโหลดใหม่']);
export async function readAccountAccess(scope: AccessQuery): Promise<AccessSnapshot> {
  try { return await readCore(scope); }
  catch (error) { throw new Error(error instanceof Error && localMessages.has(error.message)
    ? error.message : 'ตรวจสิทธิ์ไม่ได้ กรุณาตรวจบัญชีแล้วโหลดใหม่'); }
}
export const accountAccessApi: AccountAccessApi = {
  read: readAccountAccess,
  watch: onInvalidated => {
    // Only invalidate synchronously. No SDK request inside the Auth callback.
    const { data } = supabase.auth.onAuthStateChange(event => { if (event !== 'INITIAL_SESSION') onInvalidated(); });
    return () => data.subscription.unsubscribe();
  },
};
