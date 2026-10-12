// Isolated metadata correction rehearsal; never a database installer or live-data test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const admin = 'cc220000-0000-4000-8000-000000000001';
const other = 'cc220000-0000-4000-8000-000000000002';
const owner = 'cc220000-0000-4000-8000-000000000003';
const session = (sql, actor, readOnly = false) => `BEGIN${readOnly ? ' READ ONLY' : ''}; SET LOCAL ROLE authenticated;
 SET LOCAL "request.jwt.claim.sub"=${quote(actor)}; ${sql} COMMIT;`;
const firstJson = value => JSON.parse(value.split(/\r?\n/).find(line => line.startsWith('{')) ?? '{}');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Seed only BEFORE the real historical cutover guard is installed. No bypass or weakened guard.
export async function prepareCustomerDealDetailsFixtures({query,root,report}) {
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 assert.equal(await query("SELECT to_regprocedure('crm_external_private.guard_cutover_sale()') IS NULL;"),'t');
 const source=readFileSync(join(root,'scripts/sales-runtime/customer-deal-details.mjs'),'utf8');
 report.sources['scripts/sales-runtime/customer-deal-details.mjs']=createHash('sha256').update(source).digest('hex');
 const actor='cc220000-0000-4000-8000-000000000004',projectName='SYNTHETIC DETAILS EMPTY-SOURCE';
 const defaults=firstJson(await query(`SELECT jsonb_build_object('bank',(SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.sales'::regclass AND a.attname='bank_name'),
  'occupation',(SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.sales_customers'::regclass AND a.attname='occupation'));`));
 const restore=(table,column,value)=>`ALTER TABLE public.${table} ALTER COLUMN ${column} ${value===null?'DROP DEFAULT':`SET DEFAULT ${value}`};`;
 const payload={command:'book',reason:'SYNTHETIC SOURCE DEFAULT FIXTURE',customerId:null,
  newCustomer:{name:'\u00a0SYNTHETIC RAW EDGE NAME\u00a0',phone:'0902222222',channel:'phone',notes:'SYNTHETIC ONLY',assignedSalesUserId:null},
  projectName,expectedInterestRevision:null,plotId:'SYNTHETIC-DETAILS-EMPTY-SOURCE',paymentMethod:'mortgage',bookingRoute:'without_visit',visitId:null,
  listPriceSatang:100000000,discountSatang:0,depositSatang:10000,previousSaleId:null};
 const receipt=firstJson(await query(`BEGIN;
  INSERT INTO auth.users(id) VALUES('${actor}'); INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES('${actor}','sales','SYNTHETIC EMPTY SOURCE SALES',true);
  INSERT INTO public.projects(name,is_closed) VALUES(${quote(projectName)},false);
  INSERT INTO public.plots(id,project_name,has_customer,sale_status) VALUES('SYNTHETIC-DETAILS-EMPTY-SOURCE',${quote(projectName)},false,'available');
  ALTER TABLE public.sales ALTER COLUMN bank_name SET DEFAULT '';
  ALTER TABLE public.sales_customers ALTER COLUMN occupation SET DEFAULT '';
  SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${actor}';
  SELECT public.crm_v2_booking_command('${randomUUID()}',${json(payload)});
  RESET ROLE; ${restore('sales','bank_name',defaults.bank)} ${restore('sales_customers','occupation',defaults.occupation)} COMMIT;`));
 assert.ok(receipt.saleId && receipt.customerId && receipt.interestId);
 return {saleId:receipt.saleId,customerId:receipt.customerId,interestId:receipt.interestId,actor,projectName,syntheticOnly:true};
}

export async function runCustomerDealDetails({ query, root, report, parseSnapshot, parseInput, parseResult }) {
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
 const cases = [], groups = [];
 const check = (condition, label) => { assert.ok(condition, label); cases.push(label); };
 const deny = async (label, sql, pattern) => { await assert.rejects(query(sql), pattern); cases.push(label); };
 const read = path => { const source = readFileSync(join(root, path), 'utf8'); assertPlainSql(source);
  report.sources[path] = createHash('sha256').update(source).digest('hex'); return source; };
 const loadDraft = source => {
  const wrapper = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: [^'\r\n]+';\s*END;\s*\$draft_only\$;/g;
  assert.equal([...source.matchAll(wrapper)].length, 1); assert.ok(/\bROLLBACK;\s*$/.test(source));
  return source.replace(wrapper, 'BEGIN;').replace(/\bROLLBACK;\s*$/, 'COMMIT;');
 };
 // Reviewed optional central search is installed ONLY in this fresh marked loopback fixture.
 if (await query("SELECT to_regprocedure('public.crm_v2_central_search(jsonb,integer)') IS NULL;") === 't')
  await query(loadDraft(read('sql/sales/22_central_search_draft.sql')));
 const draft = read('sql/sales/22_customer_deal_details_draft.sql');
 // Changed reader source must fail atomically before replacing a single function or retaining correction tables.
 const original = await query("SELECT pg_get_functiondef('public.crm_v2_booking_context(uuid,integer)'::regprocedure);");
 await query(`BEGIN; ${original.replace('DECLARE', '-- SYNTHETIC UNKNOWN READER\nDECLARE')}; COMMIT;`);
 await deny('unknown original reader body refuses adapter installation', loadDraft(draft), /CRM_CUSTOMER_DEAL_DETAILS_READER_REVIEW_REQUIRED/);
 check(await query("SELECT to_regclass('sales_private.customer_profile_corrections') IS NULL;") === 't', 'failed reader review rolls back all new tables');
 await query(`BEGIN; ${original}; COMMIT;`);
 await query(loadDraft(draft));
 await query(`INSERT INTO auth.users(id) VALUES('${admin}'),('${other}'),('${owner}');
  INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
  ('${admin}','admin','SYNTHETIC DETAILS ADMIN',true),('${other}','sales','SYNTHETIC DETAILS OTHER SALES',true),('${owner}','owner','SYNTHETIC DETAILS OWNER',true);`);
 const native = firstJson(await query(`SELECT jsonb_build_object('saleId',s.id,'customerId',c.id,'interestId',i.id,'actor',i.owner_user_id,'projectName',i.project_name)
  FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id JOIN public.sales_customers c ON c.id=i.customer_id
  JOIN sales_private.crm_user_roles r ON r.user_id=i.owner_user_id AND r.is_active AND r.role='sales'
  WHERE s.booking_round IS NOT NULL AND s.crm_stage NOT IN ('cancelled','transferred','handover') AND c.owner_user_id=i.owner_user_id AND i.project_name='SYNTHETIC DETAILS EMPTY-SOURCE' ORDER BY s.id LIMIT 1;`));
 const historical = firstJson(await query(`SELECT jsonb_build_object('saleId',s.id,'customerId',c.id,'interestId',i.id,'actor',i.owner_user_id,'projectName',i.project_name)
  FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id JOIN public.sales_customers c ON c.id=i.customer_id
  WHERE s.external_booking_id IS NOT NULL AND s.crm_stage='contracted' ORDER BY s.id LIMIT 1;`));
 const terminal = firstJson(await query(`SELECT jsonb_build_object('saleId',s.id,'customerId',i.customer_id,'interestId',i.id,'actor',i.owner_user_id,'projectName',i.project_name)
  FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id WHERE s.external_booking_id IS NOT NULL AND s.crm_stage='handover' ORDER BY s.id LIMIT 1;`));
 for (const value of [native,historical,terminal]) assert.ok(value.saleId && value.actor && value.customerId);
 const snapshot = async (deal, actor = deal.actor) => {
  const value = firstJson(await query(session(`SELECT public.crm_v2_customer_deal_details_context('${deal.saleId}',${quote(deal.projectName)});`, actor, true)));
  return parseSnapshot(value, {saleId: deal.saleId, projectName: deal.projectName});
 };
 const input = async (deal, patches, actor = deal.actor) => {
  const s = await snapshot(deal, actor);
  return parseInput({ requestId: randomUUID(), command:'update_details',customerId:s.customer.id,saleId:s.deal.id,projectName:s.deal.projectName,
   expectedCustomerRevision:s.customer.revision,expectedInterestRevision:s.deal.interestRevision,expectedSaleRevision:s.deal.revision,
   expectedCustomerDetailsRevision:s.customer.detailsRevision,expectedDealDetailsRevision:s.deal.detailsRevision,
   reason:'SYNTHETIC VERIFIED METADATA CORRECTION',profile:null,dealDetails:null,...patches });
 };
 const sql = value => { const { requestId, ...payload } = value;
  return `SELECT public.crm_v2_customer_deal_details_command('${requestId}',${json(payload)});`; };
 const save = async (value, actor) => parseResult(firstJson(await query(session(sql(value),actor))),value);
 const baseSnapshot = `SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c),
  'interests',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.lead_project_interests i),
  'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),'plots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),
  'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.loan_attempts a),
  'sources',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM crm_external_private.prepared_booking_sales p),
  'cutover',(SELECT jsonb_agg(to_jsonb(r)) FROM crm_external_private.sales_cutover_receipts r));`;
 const sourceBefore = await query(baseSnapshot);
 const caps = firstJson(await query(session('SELECT public.crm_v2_customer_deal_details_capabilities();',owner,true)));
 check(caps.contract_version==='customer_deal_details_v1' && caps.enabled, 'capabilities exactly match enabled post-booking v3');
 const originalNative = await snapshot(native), originalHistory = await snapshot(historical);
 check(originalNative.customer.canEdit && originalNative.deal.canEdit && !originalNative.customer.detailsRevision && !originalNative.deal.detailsRevision, 'native customer and interest owner can correct metadata');
 check(originalNative.customer.name==='SYNTHETIC RAW EDGE NAME' && originalNative.customer.sourceName==='SYNTHETIC RAW EDGE NAME'
  && originalNative.customer.occupation===null && originalNative.deal.bankName===null && originalNative.deal.sourceBankName===null,
  'raw edge whitespace and blank optional source fields normalize consistently without blocking edit');
 const rawDefaults=firstJson(await query(`SELECT jsonb_build_object('name',c.customer_name,'occupation',c.occupation,'bank',s.bank_name)
  FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id JOIN public.sales_customers c ON c.id=i.customer_id WHERE s.id='${native.saleId}';`));
 check(rawDefaults.name==='\u00a0SYNTHETIC RAW EDGE NAME\u00a0' && rawDefaults.occupation==='' && rawDefaults.bank==='',
  'actual booking fixture retains raw edge name and blank defaults beneath normalized projection');
 const uncorrectedBooking=firstJson(await query(session(`SELECT public.crm_v2_booking_context('${native.customerId}',0);`,native.actor,true)));
 const uncorrectedProject=firstJson(await query(session(`SELECT public.crm_v2_project_sales(${quote(native.projectName)},'all','SYNTHETIC RAW EDGE NAME',0);`,native.actor,true)));
 check(uncorrectedBooking.customer.name===originalNative.customer.name && uncorrectedProject.rows.find(r=>r.saleId===native.saleId).customerName===originalNative.customer.name,
  'unmodified whitespace source name agrees across detail booking and project readers');

 check(originalHistory.customer.phone===null && originalHistory.deal.sourceSalePrice===1000000, 'historical unknown phone and source price are preserved');
 const ownRead = await snapshot(native,owner), otherRead = await snapshot(native,other);
 check(!ownRead.customer.canEdit && !ownRead.deal.canEdit && !otherRead.customer.canEdit && !otherRead.deal.canEdit, 'Owner and non-owning Sales read without mutation authority');
 await deny('wrong project cannot expose scoped detail',session(`SELECT public.crm_v2_customer_deal_details_context('${native.saleId}','SYNTHETIC WRONG PROJECT');`,native.actor,true),/CRM_CUSTOMER_DEAL_DETAILS_NOT_FOUND/);
 const nativeChange = await input(native,{profile:{name:'SYNTHETIC CORRECTED CUSTOMER 22',phone:null,occupation:'SYNTHETIC engineer'},dealDetails:{salePriceSatang:123456789,bankName:'SYNTHETIC SELECTED BANK'}});
 await deny('Owner cannot submit correction',session(sql(nativeChange),owner),/CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN/);
 await deny('another Sales cannot submit correction',session(sql(nativeChange),other),/CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN/);
 const nativeReceipt = await save(nativeChange,native.actor), nativeReplay = await save(nativeChange,native.actor);
 check(nativeReplay.replayed && nativeReceipt.customerDetailsRevision===nativeReplay.customerDetailsRevision && nativeReceipt.dealDetailsRevision===nativeReplay.dealDetailsRevision, 'same request recovers exactly one profile/deal correction receipt');
 const correctedNative = await snapshot(native);
 check(correctedNative.customer.name===nativeChange.profile.name && correctedNative.customer.phone===null && correctedNative.customer.sourcePhone===originalNative.customer.phone
  && correctedNative.deal.salePrice===1234567.89 && correctedNative.deal.sourceSalePrice===originalNative.deal.salePrice && correctedNative.deal.bankName==='SYNTHETIC SELECTED BANK', 'explicit null current phone and effective price/bank retain original source values');
 check(correctedNative.customer.revision===originalNative.customer.revision && correctedNative.deal.revision===originalNative.deal.revision && correctedNative.deal.interestRevision===originalNative.deal.interestRevision, 'profile/deal corrections do not change sealed lifecycle revisions');
 await deny('same request with changed payload conflicts',session(sql({...nativeChange,reason:'SYNTHETIC CHANGED REASON'}),native.actor),/CRM_CUSTOMER_DEAL_DETAILS_IDEMPOTENCY_CONFLICT/);
 await deny('new request cannot use old overlay revisions',session(sql({...nativeChange,requestId:randomUUID()}),native.actor),/CRM_CUSTOMER_DEAL_DETAILS_STALE_STATE/);
 const noOp = await input(native,{profile:nativeChange.profile,dealDetails:nativeChange.dealDetails});
 await deny('unchanged full-record correction is rejected',session(sql(noOp),native.actor),/CRM_CUSTOMER_DEAL_DETAILS_CONFLICT/);
 const historicalChange = await input(historical,{profile:{name:'SYNTHETIC CORRECTED IMPORTED 22',phone:'0902211111',occupation:null},dealDetails:{salePriceSatang:150000000,bankName:'SYNTHETIC IMPORTED BANK'}});
 await save(historicalChange,historical.actor);
 check((await snapshot(historical)).customer.sourceName===originalHistory.customer.name && (await snapshot(historical)).deal.sourceSalePrice===1000000, 'sealed imported customer/source money remain available beneath operational correction');
 const intakePayload = phone => ({name:'SYNTHETIC INTAKE PHONE REVIEW',phone,channel:'phone',notes:'SYNTHETIC ONLY',interests:[]});
 const intakeSql = phone => `SELECT public.crm_v2_create_customer('${randomUUID()}',${json(intakePayload(phone))});`;
 await deny('corrected current phone retains existing duplicate-review warning',session(intakeSql(historicalChange.profile.phone),native.actor),/CRM_DUPLICATE_REVIEW_REQUIRED/);
 assert.ok(originalNative.customer.phone,'native synthetic source must provide actual phone');
 const oldPhoneIntake = firstJson(await query(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${native.actor}';
  ${intakeSql(originalNative.customer.phone)} ROLLBACK;`));
 check(!!oldPhoneIntake.customerId, 'corrected-away original phone no longer creates a false current-phone duplicate warning');

 // Existing read RPCs must converge on the corrected customer/deal, including filtering BEFORE page limits.
 const booking = firstJson(await query(session(`SELECT public.crm_v2_booking_context('${native.customerId}',0);`,native.actor,true)));
 check(booking.customer.name===nativeChange.profile.name && booking.customer.phone===null && booking.sales.find(s=>s.id===native.saleId).salePrice===1234567.89, 'booking context uses current canonical profile and effective price');
 const project = firstJson(await query(session(`SELECT public.crm_v2_project_sales(${quote(native.projectName)},'all','SYNTHETIC CORRECTED CUSTOMER 22',0);`,native.actor,true)));
 check(project.rows.some(s=>s.saleId===native.saleId && s.customerName===nativeChange.profile.name && s.phone===null && s.salePrice===1234567.89), 'project sales searches corrected profile before pagination and shares price');
 const search = firstJson(await query(session("SELECT public.crm_v2_booking_search('SYNTHETIC CORRECTED CUSTOMER 22',0);",native.actor,true)));
 check(search.customers.some(c=>c.id===native.customerId && c.name===nativeChange.profile.name && c.phone===null), 'booking search matches corrected name and explicit null phone');
 const central = firstJson(await query(session("SELECT public.crm_v2_central_search('{\"search\":\"SYNTHETIC CORRECTED CUSTOMER 22\",\"project\":\"\",\"channel\":\"\",\"owner\":\"\",\"status\":\"\",\"unassignedOnly\":false}'::jsonb,0);",native.actor,true)));
 check(central.customers.some(c=>c.id===native.customerId && c.name===nativeChange.profile.name && c.phone===null), 'central global search shares current profile with deal readers');
 const work = firstJson(await query(session(`SELECT public.crm_v2_lead_work_snapshot('${native.customerId}','${native.interestId}');`,native.actor,true)));
 check(work.customer.name===nativeChange.profile.name && work.customer.phone===null, 'lead work and lifecycle readthrough share corrected profile');
 const post = firstJson(await query(session(`SELECT public.crm_v2_post_booking_context('${native.saleId}');`,native.actor,true)));
 check(post.sale.customerName===nativeChange.profile.name, 'postbooking reader uses same corrected name');
 const reportValue = firstJson(await query(session(`SELECT public.crm_v2_sales_report(${quote(native.projectName)});`,owner,true)));
 const reportExpected = Number(await query(`SELECT COALESCE(sum(sales_private.crm_effective_sale_price(s.id)) FILTER(WHERE s.crm_stage<>'cancelled'),0) FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id WHERE i.project_name=${quote(native.projectName)};`));
 check(Number(reportValue.totals.knownNetSaleValue)===reportExpected, 'financial report totals use corrected price with unchanged source amounts');
 const nativeOverlay = await snapshot(native);
 // A deal owner is not automatically the owner of the customer shared across interests.
 await deny('interest owner cannot edit profile owned by different Sales',`BEGIN; UPDATE public.sales_customers SET owner_user_id='${other}' WHERE id='${native.customerId}'; SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claim.sub"='${native.actor}'; ${sql({...noOp,requestId:randomUUID(),profile:{...nativeChange.profile,name:'SYNTHETIC FORBIDDEN SHARED PROFILE'},dealDetails:null})} ROLLBACK;`,/CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN/);
 const sharedDeal = await input(native,{dealDetails:{salePriceSatang:123456790,bankName:'SYNTHETIC SHARED DEAL BANK'}});
 const shared = firstJson(await query(`BEGIN; UPDATE public.sales_customers SET owner_user_id='${other}' WHERE id='${native.customerId}'; SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claim.sub"='${native.actor}'; ${sql(sharedDeal)} ROLLBACK;`));
 check(shared.dealDetailsRevision!==nativeOverlay.deal.detailsRevision, 'interest owner may correct own deal without changing another Sales customer profile');
 const terminalInput = await input(terminal,{dealDetails:{salePriceSatang:200000000,bankName:'SYNTHETIC TERMINAL CORRECTION'}});
 await deny('ordinary Sales cannot correct terminal financial metadata',session(sql(terminalInput),terminal.actor),/CRM_CUSTOMER_DEAL_DETAILS_CONFLICT/);
 const terminalReceipt = await save(terminalInput,admin);
 check(!!terminalReceipt.dealDetailsRevision && (await snapshot(terminal,admin)).deal.stage==='handover', 'admin explicitly corrects terminal metadata without reopening finished workflow');
 await query(`CREATE FUNCTION sales_private.synthetic_details_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.reason_text='SYNTHETIC DETAILS ROLLBACK' THEN RAISE EXCEPTION 'SYNTHETIC_DETAILS_AUDIT_FAILURE'; END IF; RETURN NEW; END; $$;
  REVOKE ALL ON FUNCTION sales_private.synthetic_details_audit_failure() FROM PUBLIC,anon,authenticated;
  CREATE TRIGGER synthetic_details_failure BEFORE INSERT ON public.crm_audit_events FOR EACH ROW EXECUTE FUNCTION sales_private.synthetic_details_audit_failure();`);
 const stateSql = `SELECT jsonb_build_object('profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY customer_id) FROM sales_private.customer_profile_corrections p),
  'details',(SELECT jsonb_agg(to_jsonb(d) ORDER BY sale_id) FROM sales_private.deal_details_corrections d),
  'requests',(SELECT count(*) FROM sales_private.customer_deal_details_requests),'audits',(SELECT count(*) FROM public.crm_audit_events),'permits',(SELECT count(*) FROM sales_private.customer_deal_details_permits));`;
 const stateBefore = await query(stateSql);
 const failure = await input(native,{profile:{...nativeChange.profile,name:'SYNTHETIC ROLLBACK CUSTOMER'},dealDetails:{salePriceSatang:123456790,bankName:'SYNTHETIC ROLLBACK BANK'},reason:'SYNTHETIC DETAILS ROLLBACK'});
 await deny('late audit failure is surfaced',session(sql(failure),native.actor),/SYNTHETIC_DETAILS_AUDIT_FAILURE/);
 check(stateBefore===await query(stateSql), 'failed save rolls back profile price bank revisions receipt audit and permits together');
 const invalidInput = await input(native,{dealDetails:{salePriceSatang:123456790,bankName:'SYNTHETIC VALID BANK'}});
 const bad = patches => ({...invalidInput,requestId:randomUUID(),...patches});
 for (const [label,patches] of [
  ['unexpected business stage', {crm_stage:'transferred'}], ['empty correction', {profile:null,dealDetails:null}],
  ['zero price', {dealDetails:{salePriceSatang:0,bankName:null}}], ['fractional satang',{dealDetails:{salePriceSatang:1.1,bankName:null}}],
  ['over-limit price',{dealDetails:{salePriceSatang:100000000000,bankName:null}}], ['incorrect phone',{profile:{name:'SYNTHETIC name',phone:'not a phone',occupation:null}}],
  ['extra profile field',{profile:{name:'SYNTHETIC name',phone:null,occupation:null,ownerUserId:other}}], ['control bank',{dealDetails:{salePriceSatang:1,bankName:'bad\nBANK'}}]
 ]) await deny(`SQL rejects ${label}`,session(sql(bad(patches)),native.actor),/CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT/);
 await deny('anonymous context invocation denied',`BEGIN; SET LOCAL ROLE anon; SELECT public.crm_v2_customer_deal_details_context('${native.saleId}',${quote(native.projectName)}); COMMIT;`,/permission denied/);
 for (const table of ['customer_profile_corrections','deal_details_corrections','customer_deal_details_requests','customer_deal_details_permits'])
  await deny(`browser cannot select private ${table}`,session(`SELECT * FROM sales_private.${table};`,native.actor,true),/permission denied/);
 await deny('browser cannot call private effective price helper',session(`SELECT sales_private.crm_effective_sale_price('${native.saleId}');`,native.actor,true),/permission denied/);
 await deny('receipt cannot be rewritten even by runtime owner',`UPDATE sales_private.customer_deal_details_requests SET response='{}';`,/CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN/);
 await deny('private correction cannot be edited without exact permit',`UPDATE sales_private.deal_details_corrections SET sale_price=1 WHERE sale_id='${native.saleId}';`,/CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN/);
 // Two independent psql sessions exercise lock/revision races; no mocked command implementation.
 const same = await input(native,{dealDetails:{salePriceSatang:123456791,bankName:'SYNTHETIC SAME REQUEST'}});
 const sameResults = await Promise.all([save(same,native.actor),save(same,native.actor)]);
 check(sameResults.filter(r=>r.replayed).length===1 && sameResults[0].dealDetailsRevision===sameResults[1].dealDetailsRevision, 'simultaneous same request changes one overlay and replays same receipt'); groups.push('same request concurrency');
 const race = await input(native,{dealDetails:{salePriceSatang:123456792,bankName:'SYNTHETIC FIRST RACE'}});
 const raceResults = await Promise.allSettled([save(race,native.actor),save({...race,requestId:randomUUID(),dealDetails:{salePriceSatang:123456793,bankName:'SYNTHETIC SECOND RACE'}},native.actor)]);
 check(raceResults.filter(r=>r.status==='fulfilled').length===1 && raceResults.some(r=>r.status==='rejected' && /CRM_CUSTOMER_DEAL_DETAILS_STALE_STATE/.test(r.reason.message)), 'distinct concurrent requests cannot overwrite an unseen correction'); groups.push('distinct request concurrency');
 const replayInput = same;
 await query(`UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${native.actor}';`);
 await deny('deactivated actor cannot replay previous receipt',session(sql(replayInput),native.actor),/CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN/);
 await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${native.actor}';`);
 const queued = await input(native,{dealDetails:{salePriceSatang:123456795,bankName:'SYNTHETIC QUEUED ROLE CHANGE'}});
 const holderName=`SYNTHETIC_DETAILS_ROLE_${randomUUID()}`;
 const holder = query(`BEGIN; SET LOCAL application_name=${quote(holderName)}; SELECT pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
  SELECT pg_sleep(1); UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${native.actor}'; COMMIT;`);
 let observed=false;
 for(let n=0;n<50;n++) { if(await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(holderName)} AND wait_event='PgSleep');`)==='t'){observed=true;break;} await delay(20); }
 assert.ok(observed,'owned lock holder must be observed before role race');
 const waiting = assert.rejects(query(session(sql(queued),native.actor)),/CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN/);
 await holder; await waiting; cases.push('role is rechecked after waiting for shared command lock');
 await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${native.actor}';`); groups.push('role deactivation during lock wait');
 check(sourceBefore===await query(baseSnapshot), 'all base customer interest sale plot source loan and source-receipt rows stay byte-for-byte unchanged');
 check(await query('SELECT NOT EXISTS(SELECT 1 FROM sales_private.customer_deal_details_permits);')==='t', 'all success failure and concurrency cases leave no reusable write permits');
 return {cases,groups,assertions:cases.length,syntheticOnly:true,actualFunctionBodies:true,realDatabaseTested:false,fullExternalDeploymentTested:false};
}
