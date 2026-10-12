/** Native membership integration. Callable only with the owned runtime query.
 * Takes fully resolved 958-row input; never constructs fictitious source rows.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {compileSourceMembershipAdapters,sourceMembershipCatalogSql} from './source-membership-adapters.mjs';
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
/** Read-only actual-role SELECT parity over the caller's owned loopback fixture.
 * Uses existing captured role identities, never creates users or changes roles. */
export async function runSourceMembershipSelectParity({query,report,sessionIds={}}){
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 const cases=[],check=(value,label)=>{assert.ok(value,label);cases.push(label);};
 const authority=await query('SELECT EXISTS(SELECT 1 FROM customer_source_membership_private.head);')==='t';
 const idsSql=(prefix)=>`SELECT jsonb_build_object('customers',(SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM ${prefix==='public'?'public.sales_customers':'customer_source_membership_private.customers'}),'interests',(SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM ${prefix==='public'?'public.lead_project_interests':'customer_source_membership_private.interests'}),'sales',(SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM ${prefix==='public'?'public.sales':'customer_source_membership_private.sales'}));`;
 const expected=JSON.parse(await query(idsSql('private')));
 const tables=[['customers','sales_customers'],['interests','lead_project_interests'],['sales','sales']];
 const selectGrants=JSON.parse(await query(`SELECT jsonb_build_object(${tables.map(([key,table])=>`${q(key)},has_table_privilege('authenticated','public.${table}','SELECT')`).join(',')});`));
 const actors=JSON.parse(await query("SELECT coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'role',role) ORDER BY role,user_id),'[]') FROM (SELECT DISTINCT ON(role) user_id,role FROM sales_private.crm_user_roles WHERE is_active ORDER BY role,user_id) actors;"));
 const covered=[],sessionsValidated=[],missingSessionRoles=[];
 for(const actor of actors){
  const claims={sub:actor.userId,role:'authenticated'};
  const session=sessionIds instanceof Map?(sessionIds.get(actor.userId)??sessionIds.get(actor.role)):(sessionIds[actor.userId]??sessionIds[actor.role]);
  const sessionId=typeof session==='string'?session:session?.sessionId;
  if(sessionId){assert.match(sessionId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);claims.session_id=sessionId;}else missingSessionRoles.push(actor.role);
  const asActor=sql=>`BEGIN;SET LOCAL "request.jwt.claim.sub"=${q(actor.userId)};SET LOCAL "request.jwt.claims"=${q(JSON.stringify(claims))};SET LOCAL ROLE authenticated;${sql}ROLLBACK;`;
  if(sessionId){check(await query(asActor('SELECT public.crm_v2_role();'))===actor.role,`${actor.role} supplied synthetic session validates the actual CRM role`);sessionsValidated.push(actor.role);}
  const canonicalReader=['sales','admin','owner'].includes(actor.role);
  for(const [key,table] of tables){
   const sql=asActor(`SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM public.${table};`);
   if(!selectGrants[key]){await assert.rejects(query(sql),/permission denied|42501/);cases.push(`${actor.role} direct ${table} SELECT retains original missing table grant`);continue;}
   const result=JSON.parse(await query(sql));
   check(JSON.stringify(result)===JSON.stringify(key==='sales'||canonicalReader?expected[key]:[]),`${actor.role} direct ${table} SELECT preserves existing permission and exact active identity set`);
  }
  covered.push(actor.role);
 }
 check(covered.includes('sales')&&covered.includes('admin'),'actual captured Sales and Admin identities exercised with SET LOCAL ROLE authenticated');
 for(const signature of ['rls_customer_member(uuid)','rls_interest_member(uuid)','rls_sale_member(uuid)']){
  check(await query(`SELECT has_function_privilege('authenticated','customer_source_membership_private.${signature}','EXECUTE') AND NOT has_function_privilege('anon','customer_source_membership_private.${signature}','EXECUTE');`)==='t',`${signature} boolean-only helper execute grants exclude anonymous`);
 }
 check(await query("SELECT NOT has_table_privilege('authenticated','customer_source_membership_private.members','SELECT') AND NOT has_function_privilege('authenticated','customer_source_membership_private.activate(jsonb,text,text)','EXECUTE');")==='t','direct-role policy helpers do not grant membership ledger reads or activation commands');
 await query('SELECT customer_source_membership_private.assert_catalog();');cases.push('restrictive SELECT policies and exact helper definitions pass catalog drift guard');
 report.results.sourceMembershipSelectParity={passed:cases.length,cases,authorityActive:authority,rolesCovered:covered,ownerRoleCovered:covered.includes('owner'),sessionsValidated,missingSessionRoles,selectGrants,counts:{customers:expected.customers.length,interests:expected.interests.length,sales:expected.sales.length}};
 report.results.sourceMembershipSelectParityPhases??=[];
 report.results.sourceMembershipSelectParityPhases.push(report.results.sourceMembershipSelectParity);
 return report.results.sourceMembershipSelectParity;
}
export async function installSourceMembership({query,root,report,syntheticDraftBody}){
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 const path='sql/sales/31_customer_source_membership_draft.sql',source=readFileSync(join(root,path),'utf8');
 report.sources[path]=createHash('sha256').update(source).digest('hex');
 for(const file of ['scripts/sales-runtime/source-membership.mjs','scripts/sales-runtime/source-membership-adapters.mjs'])report.sources[file]=createHash('sha256').update(readFileSync(join(root,file))).digest('hex');
 await query(syntheticDraftBody(path,source));
 const catalog=JSON.parse(await query(sourceMembershipCatalogSql));
 const compiled=compileSourceMembershipAdapters(catalog);await query(`BEGIN;${compiled.sql}COMMIT;`);
 report.sourceMembershipAdapters={count:compiled.entries.length,entries:compiled.entries};
 return compiled;
}
export async function runSourceMembershipActivation({query,report,payload,inputDigest,adminId}){
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 assert.equal(payload.records.length,958);
 const cases=[];const check=(value,label)=>{assert.ok(value,label);cases.push(label);};
 const actor=sql=>`BEGIN;SET LOCAL "request.jwt.claim.sub"=${q(adminId)};${sql}COMMIT;`;
 const activate=(p=payload,digest=inputDigest)=>actor(`SELECT customer_source_membership_private.activate(${j(p)},${q(digest)},'SYNTHETIC whole-cohort membership rehearsal');`);
 const stateSql=`SELECT jsonb_build_object('customers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.sales_customers t),'interests',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.lead_project_interests t),'sales',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.sales t),'plots',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.plots t),'leads',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.leads t),'roles',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id),'[]') FROM sales_private.crm_user_roles t),'flags',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM public.crm_settings t));`;
 const before=await query(stateSql);
 check(await query('SELECT bool_and(customer_source_membership_private.report_requires_legacy_mapping(id)) FROM public.leads;')==='t','inactive replacement preserves original all-Lead report completeness guard');
 const wrong={...payload,sourceSha256:'0'.repeat(64)};
 await assert.rejects(query(activate(wrong)),/CUSTOMER_MEMBERSHIP_REVIEW_REQUIRED/);cases.push('wrong reviewed source digest rejects activation');
 check(await query('SELECT count(*) FROM customer_source_membership_private.head;')==='0','rejected activation leaves no authority pointer');
 const swapped=structuredClone(payload);const pair=swapped.records.filter(r=>r.customerId&&r.interestId&&!r.saleId&&![438,439,440,444,680,894].includes(r.sourceRow)).slice(0,2);
 assert.equal(pair.length,2);assert.notEqual(pair[0].customerId,pair[1].customerId);
 for(const field of ['customerId','interestId','projectName']){const prior=pair[0][field];pair[0][field]=pair[1][field];pair[1][field]=prior;}
 await assert.rejects(query(activate(swapped)),/CUSTOMER_MEMBERSHIP_BINDING_REQUIRED/);cases.push('swapping valid customer and Interest UUIDs cannot move reviewed history to another source row');
 check(await query('SELECT count(*) FROM customer_source_membership_private.head;')==='0','source identity permutation leaves authority pointer absent');
 const result=JSON.parse(await query(activate()));check(result.sourceRows===958&&!result.replayed,'complete exact-bound cohort activates');
 check(await query(stateSql)===before,'activation preserves all physical business rows, Lead, plots, roles and flags');
 const replay=JSON.parse(await query(activate()));check(replay.replayed===true&&replay.revisionId===result.revisionId,'exact activation replay returns same revision');
 await assert.rejects(query(activate(payload,'f'.repeat(64))),/CUSTOMER_MEMBERSHIP_REPLAY_CONFLICT/);cases.push('changed input certificate cannot replay active revision');
 check(await query(`SELECT count(*)=958 AND count(DISTINCT customer_id)=957 AND count(DISTINCT interest_id)=948 AND count(DISTINCT sale_id)=298 FROM customer_source_membership_private.members WHERE revision_id=${q(result.revisionId)}::uuid;`)==='t','ledger contains complete source and canonical identity counts');
 check(await query('SELECT count(*)=973 FROM customer_source_membership_private.scope_leads;')==='t','reviewed original973 legacy Lead identities are scoped independently without creating identity links');
 check(await query("SELECT md5(string_agg(id::text,E'\\n' ORDER BY id))='96bca8c3499c91241b9f4258175f4f2d' FROM customer_source_membership_private.scope_leads;")==='t','legacy archive scope contains precisely the reviewed UUID identity fingerprint');
 check(await query('SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_leads old_lead WHERE NOT EXISTS(SELECT 1 FROM public.crm_legacy_lead_links link WHERE link.legacy_lead_id=old_lead.id) AND customer_source_membership_private.report_requires_legacy_mapping(old_lead.id));')==='t','only reviewed old unlinked Leads are exempt from canonical replacement report mapping');
 check(await query('SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_leads old_lead WHERE NOT old_lead.exempt_mapping AND NOT customer_source_membership_private.report_requires_legacy_mapping(old_lead.id));')==='t','original active canonical links remain protected even after later unlink');
 check(await query(`SELECT customer_source_membership_private.report_requires_legacy_mapping(${q(randomUUID())}::uuid);`)==='t','future unreviewed Lead identities retain original mapping completeness requirement');
 check(await query(`SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.customers c JOIN customer_source_membership_private.scope_customers s ON s.id=c.id WHERE NOT EXISTS(SELECT 1 FROM customer_source_membership_private.members m WHERE m.customer_id=c.id));`)==='t','excluded legacy customer IDs are hidden from canonical reader relation');
 check(await query(`SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.interests i JOIN customer_source_membership_private.scope_interests s ON s.id=i.id WHERE NOT EXISTS(SELECT 1 FROM customer_source_membership_private.members m WHERE m.interest_id=i.id));`)==='t','excluded legacy Interest IDs are hidden before searches and pages');
 check(await query(`SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.sales s JOIN customer_source_membership_private.scope_sales ss ON ss.id=s.id WHERE NOT EXISTS(SELECT 1 FROM customer_source_membership_private.members m WHERE m.sale_id=s.id));`)==='t','excluded legacy Sale IDs are hidden from canonical reader relation');
 check(await query(`SELECT bool_and(NOT customer_source_membership_private.source_member('5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5',row)) FROM unnest(ARRAY[859,951,954,958,959,960,961,969,967,968,970,971,972,973,974,975,976,977,978,979,980]) row;`)==='t','all manual rental and held source rows remain excluded independently of shared parents');
 check(await query(`SELECT customer_source_membership_private.source_member(${q(randomUUID())}::uuid,859);`)==='t','later unrelated source batches remain visible');
 const history=JSON.parse(await query(actor(`SELECT customer_source_membership_private.history('[]',NULL,NULL,NULL,NULL);`)));
 check(history.length===958,'approved historical row projection includes all958 source rows');
 const byRow=new Map(history.map(r=>[r.sourceRow,r]));for(const record of payload.records){assert.deepEqual(byRow.get(record.sourceRow)?.events,record.history.map(({kind,date,precision})=>({kind,date,precision})));}
 cases.push('all approved known and unknown history days survive exactly without invented timestamps');
 const retired=await query('SELECT s.id FROM customer_source_membership_private.scope_customers s WHERE NOT customer_source_membership_private.customer_member(s.id) ORDER BY id LIMIT 1;');
 if(retired){await assert.rejects(query(actor(`SELECT public.crm_v2_lead_work_snapshot(${q(retired)}::uuid,NULL);`)),/CRM_WORK_NOT_FOUND/);cases.push('inactive direct customer context refuses old source ID');await assert.rejects(query(actor(`SELECT customer_source_membership_private.assert_payload(jsonb_build_object('customerId',${q(retired)}));`)),/CRM_SOURCE_RETIRED/);cases.push('inactive cached command source ID fails before replay');await assert.rejects(query(`UPDATE public.sales_customers SET customer_name=customer_name WHERE id=${q(retired)}::uuid;`),/CRM_SOURCE_RETIRED|EXTERNAL/);cases.push('inactive parent mutation is denied');}
 check(await query(stateSql)===before,'denials and replay preserve all complete business rows');
 report.results.sourceMembership={passed:cases.length,cases,revisionId:result.revisionId,sourceRows:958};
 return result;
}
