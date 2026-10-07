// Native synthetic cluster only; receives a query function, never a connection URL.
import assert from 'node:assert/strict';
import { assertPlainSql } from './safety.mjs';
export const accountAccessReadPath='sql/security/account_access_read_draft.sql';
export function accountAccessReadTestBody(source) {
  assertPlainSql(source);
  const wrapper=/\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: account access reader requires reviewed security cutover';\s*END;\s*\$draft_only\$;/g;
  if ([...source.matchAll(wrapper)].length!==1 || !/\bROLLBACK;\s*$/.test(source)
    || /\b(?:COPY[\s\S]{0,80}PROGRAM|dblink_connect|ALTER SYSTEM)\b/i.test(source)) throw new Error('Unexpected account reader draft wrapper');
  return source.replace(wrapper,'BEGIN;').replace(/\bROLLBACK;\s*$/,'COMMIT;');
}
const uid=n=>`a0250000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid=n=>uid(n).replace('a025','b025');
const lit=value=>`'${String(value).replaceAll("'","''")}'`;
const read="SELECT public.app_sales_account_access(0,'','all')";
const request=(sql=read,{n=1,role='authenticated',before='',claims={},readOnly=false,rollback=false}={})=>`BEGIN${readOnly?' READ ONLY':''}; ${before}
 SET LOCAL ROLE ${role}; DO $$ BEGIN PERFORM set_config('request.jwt.claims',${lit(JSON.stringify({sub:uid(n),session_id:sid(n),user_metadata:{role:'Admin'},...claims}))},true); END $$;
 ${sql}; ${rollback?'ROLLBACK':'COMMIT'};`;

export async function runAccountAccessRead({query,source}) {
  const cases=[];
  const check=(label,value)=>{assert.ok(value,label);cases.push(label);};
  const deny=async(label,sql,pattern=/ACCOUNT_ACCESS_FORBIDDEN|permission denied/)=>{await assert.rejects(query(sql),pattern);cases.push(label);};
  check('owned synthetic loopback cluster only',(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"))==='t');
  await deny('raw guarded draft cannot run',source,/DESIGN ONLY: account access reader/);
  await query(accountAccessReadTestBody(source));
  const call=async(sql=read,options={})=>JSON.parse(await query(request(sql,options)));
  const first=await call(read,{readOnly:true});
  check('reviewed Admin reads a READ ONLY transaction',first.contract==='buildtrack.account-access.v1' && first.actorId===uid(1));
  check('Sales fixture is active',first.accounts.some(row=>row.userId===uid(2) && row.status==='active'));
  const target=first.accounts.find(row=>row.userId===uid(2));
  check('no secret or metadata fields in contract',first.accounts.every(row=>Object.keys(row).sort().join(',')===['userId','username','revision','reviewedAt','authStatus','status','lastSuspension'].sort().join(',')));
  check('literal query finds target',(await call(`SELECT public.app_sales_account_access(0,${lit(target.username)},'all')`)).accounts.some(row=>row.userId===uid(2)));
  check('wildcard is literal search',(await call("SELECT public.app_sales_account_access(0,'%','all')")).total===0);
  check('far page is empty and retains count',(await call("SELECT public.app_sales_account_access(10000,'','all')")).accounts.length===0);
  for (const role of ['anon','service_role','buildtrack_sales_sla_worker']) await deny(`${role} has no endpoint grant`,request(read,{role}));
  await deny('Sales metadata Admin cannot read',request(read,{n:2}));
  await deny('private function also checks caller',request("SELECT account_security_private.read_sales_account_access(0,'','all')",{n:2}));
  for (const [label,before] of [
    ['disabled Admin membership',`UPDATE account_security_private.reviewed_admins SET enabled=false WHERE auth_user_id='${uid(1)}';`],
    ['revoked Admin role',`UPDATE account_security_private.reviewed_roles SET enabled=false WHERE auth_user_id='${uid(1)}';`],
    ['banned Admin',`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 day' WHERE id='${uid(1)}';`],
    ['removed session',`DELETE FROM auth.sessions WHERE id='${sid(1)}';`],
    ['expired session',`UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id='${sid(1)}';`],
  ]) await deny(label,request(read,{before})); // Failure rolls back each fixture mutation.
  await deny('invalid session claim',request(read,{claims:{session_id:'not-a-uuid'}}));
  await deny('missing caller',request(read,{claims:{sub:null}}));
  for (const args of ["-1,'','all'","0,'','invalid'","0,repeat('x',81),'all'","NULL,'','all'"]) {
    await deny('invalid scope '+args,request(`SELECT public.app_sales_account_access(${args})`),/ACCOUNT_ACCESS_INVALID_INPUT/);
  }
  const ban=`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 day' WHERE id='${uid(2)}';`;
  const banned=await call(read,{before:ban,rollback:true});
  check('active Auth ban is unavailable',banned.accounts.find(row=>row.userId===uid(2)).status==='auth_unavailable');
  const cleared=await call(read,{before:`${ban} UPDATE auth.users SET banned_until=NULL WHERE id='${uid(2)}';`,rollback:true});
  const pending=cleared.accounts.find(row=>row.userId===uid(2));
  check('unban still awaiting Admin review',pending.status==='awaiting_review' && pending.lastSuspension.reason==='auth_banned');
  const filtered=await call("SELECT public.app_sales_account_access(0,'','awaiting_review')",{before:`${ban} UPDATE auth.users SET banned_until=NULL WHERE id='${uid(2)}';`,rollback:true});
  check('status filter and count match',filtered.total===filtered.accounts.length && filtered.accounts.every(row=>row.status==='awaiting_review'));
  const disabled=await call(read,{before:`UPDATE account_security_private.reviewed_roles SET enabled=false WHERE auth_user_id='${uid(2)}';`,rollback:true});
  check('disabled canonical role is not mistaken for awaiting recovery',disabled.accounts.find(row=>row.userId===uid(2)).status==='disabled');
  const unset=await call(read,{before:`UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${uid(2)}';`,rollback:true});
  check('unexplained inactive projection requires review',unset.accounts.find(row=>row.userId===uid(2)).status==='review_required');
  check('fixture mutations all rolled back',(await call()).accounts.find(row=>row.userId===uid(2)).status==='active');
  await deny('no direct suspension ledger access',request('SELECT * FROM account_security_private.crm_auth_suspensions'));
  check('both functions stable and public wrapper invoker',(await query("SELECT count(*)=2 AND bool_and(provolatile='s' AND proconfig IS NOT NULL) AND bool_and(CASE WHEN pronamespace='public'::regnamespace THEN NOT prosecdef ELSE prosecdef END) FROM pg_proc WHERE proname IN ('app_sales_account_access','read_sales_account_access');"))==='t');
  await deny('reapply rejected',accountAccessReadTestBody(source),/ACCOUNT_ACCESS_ALREADY_EXISTS/);
  return {assertions:cases.length,cases,productionChanged:false,realSupabaseAuthTested:false};
}
