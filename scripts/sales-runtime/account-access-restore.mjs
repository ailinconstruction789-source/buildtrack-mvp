// Receives only the fresh synthetic cluster query adapter, never a DB URL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';
export const accountAccessRestorePath='sql/security/account_access_restore_draft.sql';
export function accountAccessRestoreTestBody(source) {
  assertPlainSql(source);
  const wrapper=/\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: Sales access restoration requires isolated Auth verification and approved cutover';\s*END;\s*\$draft_only\$;/g;
  if([...source.matchAll(wrapper)].length!==1 || !/\bROLLBACK;\s*$/.test(source)
    || /\b(?:COPY[\s\S]{0,80}PROGRAM|dblink_connect|ALTER SYSTEM)\b/i.test(source)) throw new Error('Unexpected restoration draft wrapper');
  return source.replace(wrapper,'BEGIN;').replace(/\bROLLBACK;\s*$/,'COMMIT;');
}
const uid=n=>`a0250000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid=n=>uid(n).replace('a025','b025');
const lit=value=>value===null?'NULL':`'${String(value).replaceAll("'","''")}'`;
const request=(sql,{n=1,role='authenticated',before='',claims={},rollback=false}={})=>`BEGIN; ${before} SET LOCAL ROLE ${role};
 DO $$ BEGIN PERFORM set_config('request.jwt.claims',${lit(JSON.stringify({sub:uid(n),session_id:sid(n),user_metadata:{role:'Admin'},...claims}))},true); END $$;
 ${sql}; ${rollback?'ROLLBACK':'COMMIT'};`;
export async function runAccountAccessRestore({query,source}) {
  const cases=[];
  const check=(label,value)=>{assert.ok(value,label);cases.push(label);};
  const deny=async(label,sql,pattern=/ACCOUNT_RESTORE_|APP_ACTOR_REQUIRED|permission denied/)=>{await assert.rejects(query(sql),pattern);cases.push(label);};
  check('owned synthetic cluster only',(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"))==='t');
  await deny('raw restoration draft remains guarded',source,/DESIGN ONLY: Sales access/);
  await query(accountAccessRestoreTestBody(source));
  const target=uid(2),targetRow=async()=>JSON.parse(await query(`SELECT to_jsonb(r) FROM account_security_private.reviewed_roles r WHERE auth_user_id='${target}';`));
  const username=await query('SELECT username FROM public.users WHERE id=2;');
  const initial=await targetRow();
  const cmd=(patch={})=>{
    const v={id:randomUUID(),actor:uid(1),user:target,revision:initial.review_revision,name:username,reason:'SYNTHETIC identity and return-to-work review',confirmed:true,...patch};
    return `SELECT public.app_restore_sales_account_access(${[v.id,v.actor,v.user,v.revision,v.name,v.reason,v.confirmed].map(lit).join(',')})`;
  };
  for(const role of ['anon','service_role','buildtrack_sales_sla_worker','synthetic_auth_operator'])
    await deny(`${role} lacks command grant`,request(cmd(),{role}));
  await deny('Sales cannot restore even with forged metadata',request(cmd({actor:uid(2),user:uid(3)}),{n:2}));
  await deny('actor mismatch cannot spoof reviewer',request(cmd({actor:uid(2)})));
  for(const [label,before] of [
    ['disabled Admin capability',`UPDATE account_security_private.reviewed_admins SET enabled=false WHERE auth_user_id='${uid(1)}';`],
    ['disabled Admin canonical role',`UPDATE account_security_private.reviewed_roles SET enabled=false WHERE auth_user_id='${uid(1)}';`],
    ['banned Admin',`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 day' WHERE id='${uid(1)}';`],
    ['missing session',`DELETE FROM auth.sessions WHERE id='${sid(1)}';`],
    ['expired session',`UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id='${sid(1)}';`],
  ]) await deny(label,request(cmd(),{before}));
  await deny('wrong session binding',request(cmd(),{claims:{session_id:sid(2)}}));
  await deny('already active Sales cannot be re-reviewed by this command',request(cmd()),/STATE_CHANGED/);
  const ban=`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 day' WHERE id='${target}';`;
  const unban=`UPDATE auth.users SET banned_until=NULL WHERE id='${target}';`;
  await query(ban);
  await deny('cannot unban by reviewing',request(cmd()),/STATE_CHANGED/);
  await query(unban);
  for(const patch of [{confirmed:false},{confirmed:null},{reason:'short'},{reason:'a\nbbbbbbbbb'},{revision:0},{user:uid(1)}])
    await deny('invalid bounded request '+JSON.stringify(patch),request(cmd(patch)),/INVALID_INPUT/);
  for(const patch of [{revision:initial.review_revision+1},{name:'stale name'},{user:uid(999)}])
    await deny('stale target '+JSON.stringify(patch),request(cmd(patch)),/STATE_CHANGED/);
  for(const [label,before] of [
    ['disabled target',`UPDATE account_security_private.reviewed_roles SET enabled=false WHERE auth_user_id='${target}';`],
    ['changed target role',`UPDATE account_security_private.reviewed_roles SET role='Owner',enabled=false WHERE auth_user_id='${target}';`],
    ['deleted target',`UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id='${target}';`],
    ['anonymous target',`UPDATE auth.users SET is_anonymous=true WHERE id='${target}';`],
  ]) await deny(label,request(cmd(),{before}),/STATE_CHANGED/);
  await deny('cannot bypass projection prerequisites',request(cmd(),{before:'ALTER TABLE auth.users DISABLE TRIGGER buildtrack_crm_auth_revocation;'}),/CRM_AUTH_ALIGNMENT_REQUIRED/);
  check('rejected requests left no receipt',(await query('SELECT count(*)=0 FROM account_security_private.sales_restore_receipts;'))==='t');
  const historySql=`SELECT jsonb_build_object(${['public.sales_customers','public.lead_project_interests','public.sales','public.plots','public.lead_visits','public.customer_voices','public.loan_attempts','public.lead_activities','auth.users','account_security_private.crm_auth_suspensions']
    .map(table=>`${lit(table)},(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM ${table} t)`).join(',')});`;
  const history=await query(historySql),events=Number(await query('SELECT count(*) FROM account_security_private.role_review_events;'));
  // Forced failure AFTER projection/review writes must roll back the entire RPC.
  await query(`CREATE FUNCTION account_security_private.synthetic_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_RECEIPT_FAILURE'; END $$;
    CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON account_security_private.sales_restore_receipts FOR EACH ROW EXECUTE FUNCTION account_security_private.synthetic_reject_receipt();`);
  await deny('receipt failure atomically rolls back review',request(cmd()),/SYNTHETIC_RECEIPT_FAILURE/);
  check('failed receipt left revision and projection untouched',(await targetRow()).review_revision===initial.review_revision
    && await query(`SELECT NOT is_active FROM sales_private.crm_user_roles WHERE user_id='${target}';`)==='t');
  await query('DROP TRIGGER synthetic_receipt_failure ON account_security_private.sales_restore_receipts; DROP FUNCTION account_security_private.synthetic_reject_receipt();');
  const id=randomUUID(),sql=cmd({id}),receipt=JSON.parse(await query(request(sql)));
  check('Admin restores existing Sales and returns bounded acknowledgement',receipt.contract==='buildtrack.account-restore.v1'
    && receipt.userId===target && receipt.actorId===uid(1) && receipt.reviewedRevision===initial.review_revision+1 && Object.keys(receipt).length===6);
  check('CRM projection is aligned and active',(await query(`SELECT is_active AND trusted_review_revision=${receipt.reviewedRevision} FROM sales_private.crm_user_roles WHERE user_id='${target}';`))==='t');
  check('business/Auth/suspension history preserved',await query(historySql)===history);
  check('actor attributed once in durable review audit',await query(`SELECT count(*)=${events+1} AND count(*) FILTER(WHERE reviewer_reference='Admin Auth ID: ${uid(1)}')=1 FROM account_security_private.role_review_events;`)==='t');
  check('same request replay returns same receipt',JSON.stringify(JSON.parse(await query(request(sql))))===JSON.stringify(receipt));
  await deny('request id cannot be reused with different reason',request(cmd({id,reason:'DIFFERENT synthetic review reason'})),/REQUEST_CONFLICT/);
  await deny('fresh id stale revision does not create duplicate',request(cmd()),/STATE_CHANGED/);
  await deny('replay still requires current Admin access',request(sql,{before:`UPDATE account_security_private.reviewed_admins SET enabled=false WHERE auth_user_id='${uid(1)}';`}),/FORBIDDEN/);
  for(const sql of ['SELECT * FROM account_security_private.sales_restore_receipts','DELETE FROM account_security_private.sales_restore_receipts'])
    await deny('no direct receipt access',request(sql),/permission denied/);
  for(const verb of ['UPDATE account_security_private.sales_restore_receipts SET receipt=receipt','DELETE FROM account_security_private.sales_restore_receipts','TRUNCATE account_security_private.sales_restore_receipts'])
    await deny('even owner cannot mutate receipts',verb,/HISTORY_APPEND_ONLY/);
  await query(ban);
  check('historical replay after re-ban never reactivates Sales',JSON.parse(await query(request(sql))).reviewedRevision===receipt.reviewedRevision
    && await query(`SELECT NOT is_active FROM sales_private.crm_user_roles WHERE user_id='${target}';`)==='t');
  await query(unban);
  // Deterministic lock waits: hold one backend, observe the other waiting.
  const settled=promise=>promise.then(value=>({value}),error=>({error}));
  const waitFor=async(name,condition)=>{
    const deadline=Date.now()+3500;
    while(Date.now()<deadline){if(await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${lit(name)} AND ${condition});`)==='t')return;
      await new Promise(resolve=>setTimeout(resolve,40));}
    throw new Error(`Restoration backend not observed: ${name}`);
  };
  async function overlap(first,second){
    const a='restore_hold_'+randomUUID().slice(0,8),b='restore_wait_'+randomUUID().slice(0,8);
    const named=(sql,name)=>sql.replace('BEGIN;',`BEGIN; SET LOCAL application_name=${lit(name)};`);
    const held=settled(query(named(first.replace('COMMIT;','SELECT pg_sleep(5); COMMIT;'),a)));let waiting;
    try{await waitFor(a,"wait_event='PgSleep'");waiting=settled(query(named(second,b)));await waitFor(b,"wait_event_type='Lock'");}
    catch(error){await held;if(waiting)await waiting;throw error;}
    const [one,two]=await Promise.all([held,waiting]);if(one.error)throw one.error;return two;
  }
  const concurrent=cmd({revision:(await targetRow()).review_revision});
  const duplicate=await overlap(request(concurrent),request(concurrent));
  check('concurrent same-id requests serialize to one receipt',!duplicate.error && JSON.parse(duplicate.value).reviewedRevision===receipt.reviewedRevision+1);
  await query(ban+unban);
  const reviewFirst=cmd({revision:(await targetRow()).review_revision});
  const banAfter=await overlap(request(reviewFirst),`BEGIN; ${ban} COMMIT;`);
  check('ban waits on restoration without deadlock then suspends new revision',!banAfter.error && await query(`SELECT NOT is_active FROM sales_private.crm_user_roles WHERE user_id='${target}';`)==='t');
  await query(unban);
  const banFirst=await overlap(`BEGIN; ${ban} COMMIT;`,request(cmd({revision:(await targetRow()).review_revision})));
  check('restore waiting for ban rejects without partial writes',/STATE_CHANGED/.test(banFirst.error?.message??''));
  await query(unban);
  // The same serialization lock is taken by operator reviews. Revocation that
  // commits before this command obtains the lock must invalidate its actor.
  const adminRevoke=`BEGIN; SELECT pg_advisory_xact_lock(20260925,3); UPDATE account_security_private.reviewed_admins SET enabled=false WHERE auth_user_id='${uid(1)}'; COMMIT;`;
  const revoked=await overlap(adminRevoke,request(cmd({revision:(await targetRow()).review_revision})));
  check('Admin revocation before review lock denies waiting command',/FORBIDDEN/.test(revoked.error?.message??''));
  await query(`UPDATE account_security_private.reviewed_admins SET enabled=true WHERE auth_user_id='${uid(1)}';`);
  await query(request(cmd({revision:(await targetRow()).review_revision})));
  await deny('cannot reinstall and reset history',accountAccessRestoreTestBody(source),/ALREADY_EXISTS/);
  return {assertions:cases.length,cases,productionChanged:false,realSupabaseAuthTested:false};
}
