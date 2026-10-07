import { createClient } from '@supabase/supabase-js';
import { accessUuid, parseAccessQuery, parseAccessSnapshot, record } from './accountAccessContracts';
import { parseTrustedActor } from './trustedActor';

export function accountAccessReadEnabled() {
  return process.env.NEXT_PUBLIC_ACCOUNT_TRUSTED_AUTH_ENABLED === 'true' && process.env.ACCOUNT_ACCESS_READ_ENABLED === 'true';
}
const messages = {
  FEATURE_DISABLED: 'ยังไม่เปิดการอ่านสิทธิ์บัญชีจริง', SETUP_REQUIRED: 'ระบบตรวจสิทธิ์ยังติดตั้งไม่ครบ กรุณาติดต่อผู้ดูแล',
  UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบใหม่', FORBIDDEN: 'เฉพาะ Admin ที่ได้รับสิทธิ์จัดการบัญชีเท่านั้น',
  INVALID_INPUT: 'ตัวกรองไม่ถูกต้อง', READ_UNAVAILABLE: 'โหลดข้อมูลไม่ได้ กรุณาลองใหม่ภายหลัง',
};
class ReadError extends Error { constructor(readonly code: keyof typeof messages, readonly status: number) { super(messages[code]); } }
function rpcError(error: unknown): never {
  const code = record(error) ? error.code : null;
  if (['PGRST202','PGRST205','42883','42P01','42703'].includes(String(code))) throw new ReadError('SETUP_REQUIRED',503);
  if (code === '42501') throw new ReadError('FORBIDDEN',403);
  if (['PGRST301','PGRST302','PGRST303'].includes(String(code))) throw new ReadError('UNAUTHENTICATED',401);
  throw new ReadError('READ_UNAVAILABLE',503);
}
export async function handleAccountAccessRead(request: Request): Promise<Response> {
  let status = 200, body: unknown;
  try {
    if (!accountAccessReadEnabled()) throw new ReadError('FEATURE_DISABLED',503);
    let scope;
    try { scope = parseAccessQuery(request.url); } catch { throw new ReadError('INVALID_INPUT',400); }
    const bearer = request.headers.get('authorization')?.match(/^Bearer ([^\s]{1,8192})$/i)?.[1];
    if (!bearer) throw new ReadError('UNAUTHENTICATED',401);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new ReadError('SETUP_REQUIRED',503);
    // Never construct a service-role client, even if an environment value is misconfigured.
    let publicKey = key.startsWith('sb_publishable_');
    if (!publicKey && key.split('.').length === 3) {
      try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).role === 'anon'; } catch { /* fail closed */ }
    }
    if (!publicKey) throw new ReadError('SETUP_REQUIRED',503);
    const client = createClient(url,key,{ auth:{ persistSession:false,autoRefreshToken:false,detectSessionInUrl:false },
      global:{ headers:{ Authorization:`Bearer ${bearer}` } } });
    const identity = await client.auth.getUser(bearer);
    if (identity.error || !accessUuid(identity.data?.user?.id)) throw new ReadError('UNAUTHENTICATED',401);
    const actorId = identity.data.user.id;
    const actorResult = await client.rpc('app_current_actor');
    if (actorResult.error) rpcError(actorResult.error);
    let actor;
    try { actor = parseTrustedActor(actorResult.data,actorId); } catch { throw new ReadError('SETUP_REQUIRED',503); }
    if (actor.role !== 'Admin' || !actor.canManageAccounts) throw new ReadError('FORBIDDEN',403);
    const result = await client.rpc('app_sales_account_access',{p_page:scope.page,p_query:scope.query,p_status:scope.status});
    if (result.error) rpcError(result.error);
    try { body = { data:parseAccessSnapshot(result.data,actorId,scope) }; } catch { throw new ReadError('SETUP_REQUIRED',503); }
  } catch (error) {
    const safe = error instanceof ReadError ? error : new ReadError('READ_UNAVAILABLE',503);
    status=safe.status; body={error:{code:safe.code,message:safe.message}};
  }
  return Response.json(body,{status,headers:{'Cache-Control':'no-store',Vary:'Authorization','X-Content-Type-Options':'nosniff'}});
}
