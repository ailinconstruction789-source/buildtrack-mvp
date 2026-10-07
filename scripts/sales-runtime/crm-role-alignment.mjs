// Only the verified fresh-cluster account harness supplies query(). No network/env.
import assert from 'node:assert/strict';
import {assertPlainSql,syntheticDraftBody} from './safety.mjs';
export const crmRoleAlignmentPath='sql/security/crm_role_alignment_draft.sql';
export const crmAlignmentFixturePath='sql/security/runtime/crm_alignment_fixture.sql';
export const crmAlignmentSalesPaths=['sales_workflow_v2_draft.sql','sql/sales/04_lead_work_foundation_draft.sql','sql/sales/05_lead_lifecycle_draft.sql'];
export function crmRoleAlignmentTestBody(source){
    assertPlainSql(source);
    const wrapper=/\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: CRM role alignment requires isolated integration and approved cutover';\s*END;\s*\$draft_only\$;/g;
    if([...source.matchAll(wrapper)].length!==1||!/\bROLLBACK;\s*$/.test(source)
        || /\b(?:COPY[\s\S]{0,80}PROGRAM|dblink_connect|ALTER SYSTEM)\b/i.test(source))throw new Error('Unexpected CRM alignment draft wrapper');
    return source.replace(wrapper,'BEGIN;').replace(/\bROLLBACK;\s*$/,'COMMIT;');
}
const uid=n=>`a0250000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid=n=>uid(n).replace('a025','b025');
const lit=v=>v===null?'NULL':`'${String(v).replaceAll("'","''")}'`;
const request=(n,sql,patch={})=>`BEGIN; SET LOCAL ROLE authenticated;
 DO $$ BEGIN PERFORM set_config('request.jwt.claims',${lit(JSON.stringify({sub:uid(n),session_id:sid(n),user_metadata:{role:'Admin'},...patch}))},true); END $$;
 ${sql}; COMMIT;`;
const readRequest=(n,sql,patch={})=>request(n,sql,patch).replace('BEGIN;','BEGIN READ ONLY;');
const names={1:'guard_admin',2:'guard_sales_new',3:'guard_owner',4:'guard_foreman'};
const approval=(n,role,revision,enabled=true)=>`account_security_private.review_account_role(${lit(uid(n))},${n},${lit(names[n])},${lit(`${names[n]}@buildtrack.local`)},
 ${lit(role)},${enabled},${n===1&&role==='Admin'&&enabled},${revision},'SYNTHETIC cross-module review','synthetic-operator','SYNTHETIC recovery drill')`;
const lead=(seq)=>`public.crm_v2_create_customer('c0250000-0000-4000-8000-${String(seq).padStart(12,'0')}',
 '${JSON.stringify({name:`SYNTHETIC role integration ${seq}`,phone:`089900${String(seq).padStart(4,'0')}`,channel:'synthetic',notes:'',interests:[{projectName:'SYNTHETIC Integration',plotId:null}]})}'::jsonb)`;
const businessSnapshot=`SELECT jsonb_build_object(
 'customers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales_customers t),
 'interests',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.lead_project_interests t),
 'activities',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.lead_activities t),
 'nextActions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.crm_next_actions t),
 'sla',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.crm_sla_tasks t),
 'audit',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.crm_audit_events t));`;
export async function runCrmRoleAlignment({query,texts}){
    let assertions=0;const cases=[];
    const check=async(label,sql,expected='t')=>{assert.equal(await query(sql),expected,label);assertions++;cases.push(label);};
    const deny=async(label,sql,pattern=/CRM_|APP_ACTOR_REQUIRED|permission denied/)=>{await assert.rejects(query(sql),pattern);assertions++;cases.push(label);};
    await query(texts.get(crmAlignmentFixturePath));
    for(const path of crmAlignmentSalesPaths)await query(syntheticDraftBody(path,texts.get(path)));
    await query(`INSERT INTO public.crm_settings(id) VALUES(true);
      INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
      ('${uid(1)}','admin','SYNTHETIC Admin alias',true),('${uid(2)}','admin','SYNTHETIC Sales alias',true),
      ('${uid(3)}','owner','SYNTHETIC Owner alias',true),('${uid(4)}','sales','SYNTHETIC Foreman alias',true),
      ('${uid(10)}','sales','SYNTHETIC Unreviewed alias',true);
      INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC Integration',false);`);
    await deny('guarded alignment draft cannot run as-is',texts.get(crmRoleAlignmentPath),/DESIGN ONLY: CRM role alignment/);
    await query(crmRoleAlignmentTestBody(texts.get(crmRoleAlignmentPath)));
    await check('quarantines every old CRM permission without deleting names',`SELECT count(*)=5 AND bool_and(NOT is_active)
      AND bool_and(display_name IS NOT NULL) AND bool_and(trusted_review_revision IS NULL) FROM sales_private.crm_user_roles;`);
    await check('main role does not automatically activate CRM',request(2,"SELECT public.crm_v2_role()=''"));
    await check('CRM feature switches remain off',`SELECT NOT central_intake_enabled AND NOT lead_work_enabled AND NOT lead_lifecycle_enabled FROM public.crm_settings;`);
    for(const role of ['anon','authenticated','service_role']){
        await deny(`${role} cannot change projection`,`BEGIN; SET LOCAL ROLE ${role}; UPDATE sales_private.crm_user_roles SET is_active=true; COMMIT;`);
    }
    for(const role of ['anon','service_role'])await deny(`${role} cannot call role reader`,`BEGIN; SET LOCAL ROLE ${role}; SELECT public.crm_v2_role(); COMMIT;`);
    await deny('unreviewed CRM entry cannot reactivate',`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${uid(10)}';`,/TRUSTED_REVIEW_REQUIRED/);
    await query(`SELECT ${approval(1,'Admin',0)}; SELECT ${approval(2,'Sales',0)}; SELECT ${approval(3,'Owner',0)}; SELECT ${approval(4,'Foreman',0)};`);
    for(const [n,role] of [[1,'admin'],[2,'sales'],[3,'owner'],[4,''],[10,'']])await check(`mapped CRM role ${n}`,request(n,`SELECT public.crm_v2_role()=${lit(role)}`));
    await check('preserves staff aliases',`SELECT display_name='SYNTHETIC Sales alias' FROM sales_private.crm_user_roles WHERE user_id='${uid(2)}';`);
    await deny('CRM role cannot exceed canonical role',`UPDATE sales_private.crm_user_roles SET role='admin' WHERE user_id='${uid(2)}';`,/TRUSTED_REVIEW_REQUIRED/);
    await deny('stale projection cannot reactivate',`UPDATE sales_private.crm_user_roles SET trusted_review_revision=99 WHERE user_id='${uid(2)}';`,/TRUSTED_REVIEW_REQUIRED/);
    await deny('CRM identity cannot be reassigned',`UPDATE sales_private.crm_user_roles SET user_id='${uid(9)}' WHERE user_id='${uid(2)}';`,/IDENTITY_IMMUTABLE/);
    for(const sql of ['DELETE FROM sales_private.crm_user_roles','TRUNCATE sales_private.crm_user_roles'])await deny('CRM directory history cannot be removed',`${sql};`,/HISTORY_PRESERVED/);
    for(const claims of [{session_id:sid(3)},{session_id:'not-uuid'},{session_id:null}]){
        await check('bad session denied despite forged metadata',request(2,"SELECT public.crm_v2_role()=''",claims));
        await check('read-only also rejects invalid session',readRequest(2,"SELECT public.crm_v2_role()=''",claims));
    }
    await check('banned actor has no CRM role',`BEGIN; UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${uid(2)}';
      SET LOCAL ROLE authenticated; DO $$ BEGIN PERFORM set_config('request.jwt.claims','${JSON.stringify({sub:uid(2),session_id:sid(2)})}',true); END $$;
      SELECT public.crm_v2_role()=''; ROLLBACK;`);
    // Real base/04/05 RPCs, not a mock auth endpoint. Switches only in this fixture.
    await query('UPDATE public.crm_settings SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true;');
    await check('stable capability reader works with verified session',request(2,"SELECT (public.crm_v2_capabilities()->>'enabled')::boolean"));
    await check('STABLE RPC read-only transaction works',readRequest(2,"SELECT (public.crm_v2_capabilities()->>'enabled')::boolean"));
    await query(request(2,`SELECT ${lead(1)}`));
    await check('actual create Lead binds authenticated Sales',`SELECT owner_user_id='${uid(2)}' AND created_by_user_id='${uid(2)}' FROM public.sales_customers;`);
    await check('actual snapshot works after alignment',request(2,"SELECT public.crm_v2_central_snapshot() IS NOT NULL"));
    await check('snapshot works in PostgREST-style read-only transaction',readRequest(2,"SELECT public.crm_v2_central_snapshot() IS NOT NULL"));
    await check('direct GET-style RLS read works without write locks',readRequest(2,'SELECT count(*)=1 FROM public.sales_customers'));
    await deny('read-only role path cannot enable a write',readRequest(2,`SELECT ${lead(8)}`),/read-only transaction/);
    await query(`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${uid(2)}';`);
    await check('read-only ban is enforced',readRequest(2,"SELECT public.crm_v2_role()=''"));
    await query(`UPDATE auth.users SET banned_until=NULL WHERE id='${uid(2)}'; DELETE FROM auth.sessions WHERE id='${sid(2)}';`);
    await check('read-only removed session is denied',readRequest(2,"SELECT public.crm_v2_role()=''"));
    await query(`INSERT INTO auth.sessions(id,user_id) VALUES('${sid(2)}','${uid(2)}');`);
    const customerId=await query('SELECT id FROM public.sales_customers;');
    const workPayload=JSON.stringify({command:'record_attempt',customerId,interestId:null,expectedActionId:null,
        nextAction:{action:'SYNTHETIC next call',dueAt:new Date(Date.now()+3_600_000).toISOString()},reason:'SYNTHETIC integration check',
        attempt:{action:'SYNTHETIC call',channel:'phone',result:'no_answer',occurredAt:new Date(Date.now()-1000).toISOString()}});
    const work=`SELECT public.crm_v2_record_lead_work('c0250000-0000-4000-8000-000000000099',${lit(workPayload)}::jsonb)`;
    await query(request(2,work));
    await check('actual follow-up command stores activity and next action',`SELECT
      (SELECT count(*)=1 FROM public.lead_activities) AND (SELECT count(*)=1 FROM public.crm_next_actions);`);
    const before=await query(businessSnapshot);
    await query(`SELECT ${approval(2,'Owner',1)};`);
    await check('demotion/change observed by both role readers',request(2,"SELECT public.app_current_actor()->>'role'='Owner' AND public.crm_v2_role()='owner'"));
    await deny('new Owner cannot use old Sales create authority',request(2,`SELECT ${lead(2)}`),/CRM_FORBIDDEN/);
    await deny('new Owner cannot replay old Sales follow-up command',request(2,work),/CRM_WORK_FORBIDDEN/);
    await check('Owner still reads existing Lead',request(2,"SELECT public.crm_v2_central_snapshot() IS NOT NULL"));
    await query(`SELECT ${approval(2,'Sales',2,false)};`);
    await check('disable denies CRM immediately after commit',request(2,"SELECT public.crm_v2_role()=''"));
    await check('read-only cannot retain revoked CRM permissions',readRequest(2,"SELECT public.crm_v2_role()=''"));
    await deny('disable also denies app actor',request(2,'SELECT public.app_current_actor()'),/APP_ACTOR_REQUIRED/);
    await deny('disable denies existing central read endpoint',request(2,'SELECT public.crm_v2_central_snapshot()'),/CRM_FORBIDDEN/);
    await check('direct RLS read returns no customer rows',request(2,'SELECT count(*)=0 FROM public.sales_customers'));
    const adminPayload=JSON.stringify({name:'SYNTHETIC inactive owner',phone:'0899005555',channel:'synthetic',notes:'',interests:[],assignedSalesUserId:uid(2)});
    await deny('actual Admin create rejects disabled owner',request(1,`SELECT public.crm_v2_create_customer('c0250000-0000-4000-8000-000000000555',${lit(adminPayload)}::jsonb)`),/CRM_SALES_OWNER_REQUIRED/);
    await query(`SELECT ${approval(2,'Sales',3)};`);
    assert.equal(await query(businessSnapshot),before);assertions++;cases.push('role changes preserve owner IDs, dates, SLA and audit evidence byte-for-byte');
    await check('restoration resynchronizes revision',`SELECT is_active AND role='sales' AND trusted_review_revision=4 FROM sales_private.crm_user_roles WHERE user_id='${uid(2)}';`);
    await deny('last Admin rollback includes CRM projection',`SELECT ${approval(1,'Sales',1)};`,/LAST_ADMIN_REQUIRED/);
    await check('last Admin retains both authorities',request(1,"SELECT public.app_current_actor()->>'canManageAccounts'='true' AND public.crm_v2_role()='admin'"));
    await deny('disabled sync guard blocks operator review',`BEGIN;
      ALTER TABLE account_security_private.reviewed_roles DISABLE TRIGGER reviewed_role_crm_projection;
      SELECT ${approval(2,'Owner',4)}; COMMIT;`,/CRM_ALIGNMENT_REQUIRED/);
    const racing=await Promise.allSettled([
        query(request(2,`SELECT ${lead(3)}; SELECT pg_sleep(0.15)`)),
        query(`SELECT ${approval(2,'Sales',4,false)};`),
    ]);
    assert.equal(racing[1].status,'fulfilled');
    if(racing[0].status==='rejected')assert.match(racing[0].reason.message,/CRM_FORBIDDEN/);
    assertions++;cases.push('create/revoke race finishes safely before revoke or is rejected');
    await deny('later request after revocation cannot write',request(2,`SELECT ${lead(4)}`),/CRM_FORBIDDEN/);
    await check('revoke leaves no active CRM projection',`SELECT NOT is_active AND trusted_review_revision=5 FROM sales_private.crm_user_roles WHERE user_id='${uid(2)}';`);
    await deny('alignment cannot be applied twice',crmRoleAlignmentTestBody(texts.get(crmRoleAlignmentPath)),/ALREADY_EXISTS/);
    return {assertions,cases,actualSalesDrafts:crmAlignmentSalesPaths,productionChanged:false,realSupabaseAuthTested:false};
}
