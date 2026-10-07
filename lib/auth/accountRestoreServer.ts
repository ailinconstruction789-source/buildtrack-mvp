import { createClient } from '@supabase/supabase-js';
import { accessUuid, record } from './accountAccessContracts';
import { accountAccessReadEnabled } from './accountAccessServer';
import { parseTrustedActor } from './trustedActor';
import { parseRestoreRequest, parseRestoreReceipt, RestoreError, RESTORE_ERRORS } from './accountRestoreContracts';

export function accountAccessRestoreEnabled() {
  return accountAccessReadEnabled() && process.env.ACCOUNT_ACCESS_RESTORE_ENABLED==='true';
}
async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json' || !request.body) throw new RestoreError('INVALID_INPUT');
  const reader=request.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  try {
    while (true) {
      const {done,value}=await reader.read(); if (done) break;
      size+=value.byteLength;
      if (size>8192) { await reader.cancel(); throw new RestoreError('INVALID_INPUT'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new RestoreError('INVALID_INPUT'); }
  finally { reader.releaseLock(); }
}
function rpcError(error: unknown): never {
  const code=record(error)?error.code:null, message=record(error)?error.message:null;
  if (code==='42501') throw new RestoreError('FORBIDDEN');
  if (['PGRST301','PGRST302','PGRST303'].includes(String(code))) throw new RestoreError('UNAUTHENTICATED');
  if (['PGRST202','PGRST205','42883','42P01','42703'].includes(String(code))) throw new RestoreError('SETUP_REQUIRED');
  if (code==='22023') {
    if (message==='ACCOUNT_RESTORE_STATE_CHANGED') throw new RestoreError('STATE_CHANGED');
    if (message==='ACCOUNT_RESTORE_REQUEST_CONFLICT') throw new RestoreError('REQUEST_CONFLICT');
    if (message==='ACCOUNT_RESTORE_INVALID_INPUT') throw new RestoreError('INVALID_INPUT');
  }
  // Timeouts, transport failures and malformed replies may follow a commit.
  throw new RestoreError('RESULT_UNKNOWN');
}
export async function handleAccountAccessRestore(request: Request): Promise<Response> {
  let status=200, body:unknown;
  try {
    if (!accountAccessRestoreEnabled()) throw new RestoreError('FEATURE_DISABLED');
    if (request.method!=='POST' || new URL(request.url).search) throw new RestoreError('INVALID_INPUT');
    const origin=request.headers.get('origin');
    if ((origin && origin!==new URL(request.url).origin) || request.headers.get('sec-fetch-site')==='cross-site') throw new RestoreError('FORBIDDEN');
    const bearer=request.headers.get('authorization')?.match(/^Bearer ([^\s]{1,8192})$/i)?.[1];
    if (!bearer) throw new RestoreError('UNAUTHENTICATED');
    const command=parseRestoreRequest(await readBody(request));
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new RestoreError('SETUP_REQUIRED');
    let publicKey=key.startsWith('sb_publishable_');
    if (!publicKey && key.split('.').length===3) {
      try { publicKey=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8')).role==='anon'; } catch { /* closed */ }
    }
    if (!publicKey) throw new RestoreError('SETUP_REQUIRED');
    const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{headers:{Authorization:`Bearer ${bearer}`}}});
    const identity=await client.auth.getUser(bearer);
    if (identity.error || !accessUuid(identity.data?.user?.id)) throw new RestoreError('UNAUTHENTICATED');
    if (identity.data.user.id!==command.actorId) throw new RestoreError('FORBIDDEN');
    const current=await client.rpc('app_current_actor');
    if (current.error) rpcError(current.error);
    let actor;
    try { actor=parseTrustedActor(current.data,command.actorId); } catch { throw new RestoreError('SETUP_REQUIRED'); }
    if (actor.role!=='Admin' || !actor.canManageAccounts) throw new RestoreError('FORBIDDEN');
    // Separate RPC transaction rechecks and locks authorization. No privileged key.
    const result=await client.rpc('app_restore_sales_account_access',{
      p_request_id:command.requestId,p_actor_id:command.actorId,p_user_id:command.userId,
      p_expected_revision:command.expectedRevision,p_expected_username:command.expectedUsername,p_reason:command.reason,p_confirmed:true,
    });
    if (result.error) rpcError(result.error);
    body={data:parseRestoreReceipt(result.data,command)};
  } catch (error) {
    const safe=error instanceof RestoreError?error:new RestoreError('RESULT_UNKNOWN');
    status=RESTORE_ERRORS[safe.code].status; body={error:{code:safe.code,message:safe.message}};
  }
  return Response.json(body,{status,headers:{'Cache-Control':'no-store',Vary:'Authorization','X-Content-Type-Options':'nosniff'}});
}
