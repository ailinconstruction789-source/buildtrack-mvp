// Actual canonical/external guard bodies on synthetic rows in the owned loopback cluster.
// These tests are not a live import, full schema/cutover certification or Supabase Auth test.
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { syntheticDraftBody } from './safety.mjs';
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const uuid=v=>v===null?'NULL':`${q(v)}::uuid`;
const admin='ca280000-0000-4000-8000-000000000001',other='ca280000-0000-4000-8000-000000000002';
const session=(sql,actor=admin,role='')=>`BEGIN; ${role?`SET LOCAL ROLE ${role};`:''} SET LOCAL "request.jwt.claim.sub"=${q(actor)}; ${sql} COMMIT;`;
const hash=v=>createHash('sha256').update(v).digest('hex');
export async function runHistoricalSaleRevision({query,root,report}) {
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 const cases=[],check=(ok,label)=>{assert.ok(ok,label);cases.push(label);};
 const deny=async(label,sql,pattern)=>{await assert.rejects(query(sql),pattern);cases.push(label);};
 const read=p=>{const s=readFileSync(join(root,p),'utf8');report.sources[p]=hash(s);return s;};
 read('scripts/sales-runtime/historical-sale-revision.mjs');
 // Install the unchanged real guards BEFORE historical writes, so this composed
 // fixture catches stock compatibility failures rather than masking them.
 const writer=read('sql/sales/external_booking_writer_draft.sql');
 const ddlStart=writer.indexOf('CREATE TABLE crm_external_private.booking_writer_releases'),ddlEnd=writer.indexOf('CREATE TRIGGER booking_writer_release_immutable');
 const guardStart=writer.indexOf('CREATE FUNCTION crm_external_private.guard_booking_plot_stock('),guardEnd=writer.indexOf('$$;',guardStart);
 const sync=read('sync_plot_sales_status.sql'),syncEnd=sync.indexOf('$$ LANGUAGE plpgsql;');
 const salesMigration=read('sales_system_migration.sql');
 const updaterStart=salesMigration.indexOf('CREATE OR REPLACE FUNCTION update_sales_updated_at_column()');
 const updaterEnd=salesMigration.indexOf("$$ language 'plpgsql';",updaterStart);
 assert.ok(ddlStart>=0&&ddlEnd>ddlStart&&guardStart>=0&&guardEnd>guardStart&&syncEnd>0);
 assert.ok(updaterStart>=0&&updaterEnd>updaterStart);
 await query(`${writer.slice(ddlStart,ddlEnd)}
  INSERT INTO crm_external_private.booking_writer_releases(batch_id,plan_digest,review_reference) SELECT batch_id,'SYNTHETIC permit review','SYNTHETIC composed guard review' FROM crm_external_private.sales_cutover_receipts;
  ${writer.slice(guardStart,guardEnd+3)}
  CREATE TRIGGER actual_booking_plot_stock BEFORE INSERT OR UPDATE ON public.plots FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_booking_plot_stock();
  REVOKE ALL ON FUNCTION crm_external_private.guard_booking_plot_stock() FROM PUBLIC,anon,authenticated;
  ${sync.slice(0,syncEnd+'$$ LANGUAGE plpgsql;'.length).replace('FUNCTION sync_plot_customer_status()','FUNCTION public.sync_plot_customer_status()')}
  CREATE TRIGGER trigger_sync_plot_customer_status AFTER INSERT OR UPDATE OF plot_id,contract_status OR DELETE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.sync_plot_customer_status();
  ${salesMigration.slice(updaterStart,updaterEnd+"$$ language 'plpgsql';".length).replace('FUNCTION update_sales_updated_at_column()','FUNCTION public.update_sales_updated_at_column()')}
  CREATE TRIGGER update_sales_table_updated_at BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.update_sales_updated_at_column();`);
 const path='sql/sales/28_historical_sale_revision_draft.sql',sql=syntheticDraftBody(path,read(path));
 const oldGuard=await query("SELECT pg_get_functiondef('crm_external_private.guard_cutover_sale()'::regprocedure);");
 await query(oldGuard.replace('DECLARE permit','-- SYNTHETIC unknown definition\nDECLARE permit'));
 await deny('unknown external seal rejects revision installation atomically',sql,/HISTORICAL_REVISION_GUARD_REVIEW_REQUIRED/);
 check(await query("SELECT to_regnamespace('sales_revision_private') IS NULL;")==='t','failed adapter leaves no revision schema or constraints');
 await query(oldGuard);
 await query(sql);
 await deny('duplicate installation is refused',sql,/already exists/);
 const pending=report.syntheticHistoricalPendingDeals;
 assert.equal(pending?.length,2,'two actual sealed pending synthetic imports must be prepared before cutover guard');
 await query(`INSERT INTO auth.users(id) VALUES('${admin}'),('${other}');
  INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES('${admin}','admin','SYNTHETIC HISTORICAL ADMIN',true),('${other}','sales','SYNTHETIC HISTORICAL OTHER',true);
  INSERT INTO public.plots(id,project_name,has_customer,sale_status) VALUES('SYNTHETIC-REVISION-NEW','SYNTHETIC HISTORICAL DEALS',false,'ready_for_sale'),('SYNTHETIC-REVISION-RACE','SYNTHETIC HISTORICAL DEALS',false,'active'),('SYNTHETIC-REVISION-CONCURRENT','SYNTHETIC HISTORICAL DEALS',false,'available');`);
 const capture=async(binding)=>JSON.parse(await query(`SELECT jsonb_build_object('customer',to_jsonb(c),'interest',to_jsonb(i),'sale',(SELECT to_jsonb(s) FROM public.sales s WHERE id=${uuid(binding.saleId)}),
  'plot',to_jsonb(p),'inventory',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM public.sales s WHERE plot_id=p.id),
  'details',(SELECT to_jsonb(d) FROM sales_private.deal_details_corrections d WHERE sale_id=${uuid(binding.saleId)}),
  'forecast',(SELECT to_jsonb(f) FROM sales_import_private.forecast_corrections f WHERE sale_id=${uuid(binding.saleId)}))
  FROM public.sales_customers c JOIN public.lead_project_interests i ON i.customer_id=c.id JOIN public.plots p ON p.id=${q(binding.plotId)}
  WHERE c.id=${q(binding.customerId)}::uuid AND i.id=${q(binding.interestId)}::uuid;`));
 const record=async(deal,row,operation='cancel')=> {
  const binding={saleId:deal.saleId,customerId:deal.customerId,interestId:deal.interestId,plotId:deal.plotId};
  const before=await capture(binding),bookedDate=operation==='cancel'?'2024-02-01':'2026-09-29';
  return {sourceRow:row,sourceKey:hash(`SYNTHETIC source ${row}`),rowSha256:hash(`SYNTHETIC cells ${row}`),operation,binding,before,
   patch:{bookedDate,cancelledDate:operation==='cancel'?'2026-10-07':null,expectedTransferDate:operation==='cancel'?null:'2026-10-30',salePriceSatang:operation==='cancel'?333333300:264300000,
    closingSalesId:before.sale?.closing_sales_user_id??before.interest.owner_user_id},
   history:[{kind:'visited',date:'2024-01-30',precision:'day'},{kind:'booked',date:bookedDate,precision:'day'},...(operation==='cancel'?[{kind:'cancelled',date:'2026-10-07',precision:'day'}]:[])]};
 };
 const payload=(records,datasetKey='SYNTHETIC-REVISION-BUNDLE')=>({version:'reviewed-historical-sale-revision-v1',datasetKey,sourceSha256:'a'.repeat(64),reviewSha256:'b'.repeat(64),records,leadReplayAllowed:false});
 const apply=p=>`SELECT sales_revision_private.apply(${j(p)});`;
 const state=()=>query(`SELECT jsonb_build_object('sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),'plots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),
  'batches',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM sales_revision_private.batches b),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM sales_revision_private.events e),
  'details',(SELECT jsonb_agg(to_jsonb(d) ORDER BY sale_id) FROM sales_private.deal_details_corrections d),'forecasts',(SELECT jsonb_agg(to_jsonb(f) ORDER BY sale_id) FROM sales_import_private.forecast_corrections f),
  'plotPermits',(SELECT jsonb_agg(to_jsonb(p) ORDER BY event_id) FROM sales_revision_private.plot_permits p),
  'permits',(SELECT count(*) FROM sales_revision_private.permits)+(SELECT count(*) FROM sales_private.booking_write_permits)+(SELECT count(*) FROM sales_private.customer_deal_details_permits));`);
 const sources=()=>query(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c),
  'interests',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.lead_project_interests i),'prepared',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM crm_external_private.prepared_booking_sales p),
  'cutover',(SELECT jsonb_agg(to_jsonb(c)) FROM crm_external_private.sales_cutover_receipts c),'leads',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l));`);
 const originalSources=await sources();
 await query(session(`DO $$ DECLARE d sales_private.deal_details_corrections%ROWTYPE; BEGIN
  d.sale_id:=${q(pending[0].saleId)}::uuid;d.sale_price:=2222222;d.bank_name:='SYNTHETIC EXISTING BANK';d.revision:=gen_random_uuid();d.actor_user_id:=auth.uid();d.reason:='SYNTHETIC prior operational correction';d.recorded_at:=clock_timestamp();
  INSERT INTO sales_private.customer_deal_details_permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),'deal',d.sale_id,NULL,to_jsonb(d));
  INSERT INTO sales_private.deal_details_corrections SELECT d.*;
  DELETE FROM sales_private.customer_deal_details_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid(); END $$;`));
 const cancelled=[await record(pending[0],926),await record(pending[1],944)];
 const book=await record({...pending[0],saleId:null,plotId:'SYNTHETIC-REVISION-NEW'},964,'create_booking');
 book.patch.closingSalesId=other;
 const p=payload([...cancelled,book]);
 for(const [label,actor,role] of [['Sales operator',other,''],['missing identity','',''],['browser Admin',admin,'authenticated']]) await deny(`${label} cannot call private historical writer`,session(apply(p),actor,role),/HISTORICAL_REVISION_FORBIDDEN|permission denied/);
 for(const table of ['batches','events','permits','plot_permits']) for(const role of ['anon','authenticated']) await deny(`${role} cannot read historical ${table}`,session(`SELECT * FROM sales_revision_private.${table};`,admin,role),/permission denied/);
 const before=await state();
 // Removing either actual guard in a rollback-only fixture must refuse even a
 // valid payload before writing. Never disable a trigger to execute an import.
 for(const [name,table] of [['actual_booking_plot_stock','public.plots'],['trigger_sync_plot_customer_status','public.sales'],['update_sales_table_updated_at','public.sales']]) {
  await deny(`missing ${name} blocks execution`,session(`DROP TRIGGER ${name} ON ${table};${apply(p)}`),/HISTORICAL_REVISION_STOCK_REVIEW_REQUIRED/);
  check(await state()===before,`${name} refusal preserves all rows and permits`);
 }
 const stockDefinition=await query("SELECT pg_get_functiondef('crm_external_private.guard_booking_plot_stock()'::regprocedure);");
 await deny('changed stock body blocks execution',session(`${stockDefinition.replace('DECLARE permit','-- SYNTHETIC changed catalog\nDECLARE permit')};${apply(p)}`),/HISTORICAL_REVISION_STOCK_REVIEW_REQUIRED/);
 check(await state()===before,'changed stock catalog refusal preserves complete business rows');
 const updaterDefinition=await query("SELECT pg_get_functiondef('public.update_sales_updated_at_column()'::regprocedure);");
 await deny('changed actual Sale updater blocks execution',session(`${updaterDefinition.replace('NEW.updated_at = NOW();','NEW.updated_at = clock_timestamp();')};${apply(p)}`),/HISTORICAL_REVISION_STOCK_REVIEW_REQUIRED/);
 check(await state()===before,'changed updater refusal preserves full sales stock and receipts');
 await deny('disabled actual Sale updater blocks execution',session(`ALTER TABLE public.sales DISABLE TRIGGER update_sales_table_updated_at;${apply(p)}`),/HISTORICAL_REVISION_STOCK_REVIEW_REQUIRED/);
 check(await state()===before,'disabled updater refusal preserves full sales stock and receipts');
 const occupied=await record({...pending[0],saleId:null,plotId:'SYNTHETIC-HISTORY-2'},965,'create_booking');
 await deny('historical transferred or handed-over plot remains occupied',session(apply(payload([occupied],'SYNTHETIC-OCCUPIED'))),/HISTORICAL_REVISION_OCCUPIED/);
 check(await state()===before,'occupied plot refusal cannot release transferred ownership');
 for(const [label,mutate,pattern] of [
  ['unknown input',p=>{p.extra=true;},/IMPORT_DETAILS_INVALID/],
  ['unknown version',p=>{p.version=null;},/HISTORICAL_REVISION_INVALID/],
  ['numeric source digest cannot masquerade as hex string',p=>{p.sourceSha256=1e63;},/HISTORICAL_REVISION_INVALID/],
  ['numeric row digest cannot masquerade as hex string',p=>{p.records[0].rowSha256=1e63;},/HISTORICAL_REVISION_INVALID/],
  ['Lead replay enabled',p=>{p.leadReplayAllowed=true;},/HISTORICAL_REVISION_INVALID/],
  ['caller supplied fictional new Sale UUID',p=>{p.records[2].binding.saleId=randomUUID();},/HISTORICAL_REVISION_INVALID/],
  ['stale Customer',p=>{p.records[0].before.customer.owner_user_id=other;},/HISTORICAL_REVISION_STALE/],
  ['stale Interest',p=>{p.records[0].before.interest.lifecycle_revision=randomUUID();},/HISTORICAL_REVISION_STALE/],
  ['stale Sale money',p=>{p.records[0].before.sale.sale_price=1;},/HISTORICAL_REVISION_STALE/],
  ['incomplete full inventory',p=>{p.records[0].before.inventory=[];},/HISTORICAL_REVISION_STALE/],
  ['stale plot occupancy',p=>{p.records[0].before.plot.has_customer=false;},/HISTORICAL_REVISION_STALE/],
  ['zero revised money',p=>{p.records[0].patch.salePriceSatang=0;},/HISTORICAL_REVISION_INVALID/],
  ['fractional satang',p=>{p.records[0].patch.salePriceSatang=1.5;},/HISTORICAL_REVISION_INVALID/],
  ['invalid late forecast',p=>{p.records[2].patch.expectedTransferDate='2026-02-30';},/HISTORICAL_REVISION_INVALID/],
  ['invented timestamp day',p=>{p.records[0].patch.cancelledDate='2026-10-07T00:00:00Z';},/HISTORICAL_REVISION_INVALID/],
  ['unknown day with known precision',p=>{p.records[0].history[0].date=null;},/HISTORICAL_REVISION_INVALID/],
  ['missing day precision',p=>{p.records[0].history[0].precision=null;},/HISTORICAL_REVISION_INVALID/],
  ['duplicate booked evidence',p=>{p.records[2].history.push(p.records[2].history[1]);},/HISTORICAL_REVISION_INVALID/],
  ['changed booked source day',p=>{p.records[0].patch.bookedDate='2024-02-02';p.records[0].history[1].date='2024-02-02';},/HISTORICAL_REVISION_PROVENANCE/],
  ['correct UUID paired with wrong immutable source row',p=>{p.records[0].sourceRow=927;},/HISTORICAL_REVISION_PROVENANCE/],
  ['known cancellation forecast requires separate verified adapter',p=>{p.records[0].patch.expectedTransferDate='2026-10-30';},/HISTORICAL_REVISION_FORECAST_REVIEW_REQUIRED/],
  ['wrong closing Sales',p=>{p.records[0].patch.closingSalesId=other;},/HISTORICAL_REVISION_OPERATIONAL_HISTORY/],
  ['duplicate sale after cancellation',p=>{p.records.push(structuredClone(p.records[0]));p.records[3].sourceRow=945;p.records[3].sourceKey=hash('SYNTHETIC duplicate');},/HISTORICAL_REVISION_STALE|duplicate key/]
 ]) {const bad=structuredClone(p);mutate(bad);await deny(label,session(apply(bad)),pattern);check(await state()===before,`${label} rolls back all three canonical operations and receipts`);}
 await query(`CREATE FUNCTION sales_revision_private.synthetic_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_row=944 THEN RAISE EXCEPTION 'SYNTHETIC_HISTORICAL_LATE_FAILURE'; END IF; RETURN NEW; END; $$;
  REVOKE ALL ON FUNCTION sales_revision_private.synthetic_late_failure() FROM PUBLIC,anon,authenticated;
  CREATE TRIGGER synthetic_late_failure BEFORE INSERT ON sales_revision_private.events FOR EACH ROW EXECUTE FUNCTION sales_revision_private.synthetic_late_failure();`);
 await deny('late second cancellation failure rejects entire batch',session(apply(p)),/SYNTHETIC_HISTORICAL_LATE_FAILURE/);
 check(await state()===before,'late failure restores first cancellation, money overlay, plot flags and new booking');
 await query('DROP TRIGGER synthetic_late_failure ON sales_revision_private.events; DROP FUNCTION sales_revision_private.synthetic_late_failure();');
 await deny('late sync changes to another plot field reject all three operations',session(`CREATE FUNCTION public.synthetic_late_plot_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.id='SYNTHETIC-REVISION-NEW' THEN NEW.plot_name:='SYNTHETIC UNAPPROVED FIELD'; END IF; RETURN NEW;END;$$;
  CREATE TRIGGER z_synthetic_late_plot_change BEFORE UPDATE ON public.plots FOR EACH ROW EXECUTE FUNCTION public.synthetic_late_plot_change();${apply(p)}`),/HISTORICAL_REVISION_STOCK_SYNC_REQUIRED/);
 check(await state()===before,'late unexpected complete plot post-image rolls back two cancellations new booking money and every permit');
 const receipt=JSON.parse(await query(session(apply(p))));
 const newSaleId=receipt.bindings.find(x=>x.sourceRow===964)?.saleId;
 assert.match(newSaleId,/^[a-f0-9-]{36}$/);
 check(receipt.records===3&&!receipt.replayed,'three reviewed corrections commit together through actual sealed guards');
 check(await query(`SELECT count(*)=2 AND bool_and(s.updated_at IS NOT NULL AND to_jsonb(s)=e.after_sale AND s.updated_at=(e.after_sale->>'updated_at')::timestamptz AND s.updated_at IS DISTINCT FROM (e.before_sale->>'updated_at')::timestamptz) FROM public.sales s JOIN sales_revision_private.events e ON e.sale_id=s.id WHERE e.operation='cancel';`)==='t','actual unchanged BEFORE updater matches predicted full cancellation post-images');
 check(await query(`SELECT (e.after_sale->'updated_at')='null'::jsonb AND s.updated_at IS NULL FROM public.sales s JOIN sales_revision_private.events e ON e.sale_id=s.id WHERE e.operation='create_booking';`)==='t','historical INSERT retains unknown technical timestamp without an UPDATE trigger effect');
 check(await query(`SELECT count(*)=2 AND bool_and(cancelled_at IS NULL AND booked_at IS NULL AND crm_stage='cancelled') FROM public.sales WHERE id IN(${pending.map(x=>q(x.saleId)).join(',')});`)==='t','two historical cancellations preserve unknown operational timestamps');
 check(await query(`SELECT count(*)=2 AND bool_and(NOT has_customer AND sale_status='reserved') FROM public.plots WHERE id IN(${pending.map(x=>q(x.plotId)).join(',')});`)==='t','only exact cancelled occupancy is released while original construction status is preserved');
 check(await query("SELECT has_customer AND sale_status='ready_for_sale' FROM public.plots WHERE id='SYNTHETIC-REVISION-NEW';")==='t','new historical booking preserves original ready_for_sale construction status through the actual sync trigger');
 await deny('no historical permit permits a later manual occupancy change',session("UPDATE public.plots SET has_customer=false WHERE id='SYNTHETIC-REVISION-NEW';"),/EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED/);
 await deny('construction sale status cannot be overwritten as booked stock',session("UPDATE public.plots SET sale_status='reserved' WHERE id='SYNTHETIC-REVISION-NEW';"),/EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED/);
 check(await query('SELECT NOT EXISTS(SELECT 1 FROM sales_revision_private.plot_permits);')==='t','exact stock permits are removed after actual sync and final verification');
 check(await query(`SELECT crm_stage='booked' AND lead_id IS NULL AND external_booking_id IS NULL AND external_source_stage IS NULL AND booking_round IS NULL AND booked_at IS NULL AND sale_price=2643000 AND expected_transfer_date=DATE '2026-10-30' FROM public.sales WHERE id=${q(newSaleId)}::uuid;`)==='t','independent historical booking keeps exact money forecast and no fabricated external snapshot or Lead');
 for(const r of p.records) {
  const evidence=JSON.parse(await query(`SELECT sales_private.crm_booking_imported_history(to_jsonb(s)) FROM public.sales s WHERE id=${q(r.binding.saleId??newSaleId)}::uuid;`));
  check(evidence.sourceRow===r.sourceRow&&evidence.bookedDate===r.patch.bookedDate&&evidence.cancelledDate===r.patch.cancelledDate,`source row ${r.sourceRow} projects civil days through actual history helper`);
 }
 check(await query(`SELECT sales_import_private.expected_transfer_date(${q(newSaleId)}::uuid,NULL);`)==='2026-10-30','new independent booking forecast projects through exact Excel getter adapter');
 check(await query(`SELECT sales_private.crm_effective_sale_price(${q(pending[0].saleId)}::uuid)=3333333 AND (SELECT bank_name FROM sales_private.deal_details_corrections WHERE sale_id=${q(pending[0].saleId)}::uuid)='SYNTHETIC EXISTING BANK';`)==='t','whole cancellation corrects money and preserves effective existing bank');
 const publicSnapshot=JSON.parse(await query(session(`SET LOCAL ROLE authenticated; SELECT public.crm_v2_project_sales('SYNTHETIC HISTORICAL DEALS','all','',0);`)));
 check(publicSnapshot.rows.find(x=>x.saleId===newSaleId)?.importedHistory?.bookedDate==='2026-09-29','actual project Sales reader includes independent historical booking under source integrity checks');
 const context=JSON.parse(await query(session(`SET LOCAL ROLE authenticated; SELECT public.crm_v2_post_booking_context(${q(newSaleId)}::uuid);`)));
 check(context.sale.paymentMethod===null&&!context.sale.canEdit&&context.sale.importedHistory.bookedDate==='2026-09-29','public post-booking context preserves unknown payment method and safely disables progression');
 const advance={command:'advance',saleId:newSaleId,customerId:book.binding.customerId,expectedSaleRevision:context.sale.revision,expectedInterestRevision:context.sale.interestRevision,reason:'SYNTHETIC refusal',nextStage:'contracted',occurredAt:new Date().toISOString(),evidenceNote:'SYNTHETIC'};
 await deny('unknown payment method cannot silently progress a new imported booking',session(`SET LOCAL ROLE authenticated; SELECT public.crm_v2_post_booking_command('${randomUUID()}',${j(advance)});`),/CRM_POST_BOOKING_SETUP_REQUIRED|CRM_POST_BOOKING_CONFLICT|CRM_POST_BOOKING_INVALID_INPUT/);
 check(await query('SELECT count(*)=3 AND bool_and(jsonb_array_length(source_history)>=2) FROM sales_revision_private.events;')==='t','visited/booked/cancelled days remain durable immutable provenance');
 check(await sources()===originalSources,'Customer Interest old immutable sources and Lead tables remain byte-for-byte unchanged');
 const completed=await state(),replay=JSON.parse(await query(session(apply(p))));
 check(replay.replayed&&replay.batchId===receipt.batchId&&await state()===completed,'exact replay returns same receipt without duplicate history money or stock mutation');
 await query(`UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${other}';`);
 await deny('inactive independent closing Sales blocks exact replay',session(apply(p)),/HISTORICAL_REVISION_OWNER_CHANGED/);
 await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${other}';`);
 const changed=structuredClone(p);changed.records[2].patch.salePriceSatang++;
 await deny('changed replay cannot alter accepted booking',session(apply(changed)),/HISTORICAL_REVISION_REPLAY_CONFLICT/);
 for(const table of ['batches','events']) await deny(`${table} immutable after successful import`,session(`DELETE FROM sales_revision_private.${table};`),/HISTORICAL_REVISION_SEALED/);
 await deny('ordinary booking permit cannot rewrite source marker',session(`INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid()); UPDATE public.sales SET historical_import_id=NULL WHERE id=${q(newSaleId)}::uuid;`),/HISTORICAL_REVISION_SEALED|EXTERNAL_CUTOVER_SALES_SEALED/);
 check(await query('SELECT NOT EXISTS(SELECT 1 FROM sales_revision_private.permits) AND NOT EXISTS(SELECT 1 FROM sales_private.booking_write_permits) AND NOT EXISTS(SELECT 1 FROM sales_private.customer_deal_details_permits);')==='t','success and failures leave no reusable capabilities');
 const raceA=await record({...pending[0],saleId:null,plotId:'SYNTHETIC-REVISION-CONCURRENT'},965,'create_booking');
 const raceB=structuredClone(raceA);raceB.sourceRow=966;raceB.sourceKey=hash('SYNTHETIC CONCURRENT B');
 const race=await Promise.allSettled([
  query(session(apply(payload([raceA],'SYNTHETIC-CONCURRENT-A')))),
  query(session(apply(payload([raceB],'SYNTHETIC-CONCURRENT-B')))),
 ]);
 check(race.filter(x=>x.status==='fulfilled').length===1&&race.filter(x=>x.status==='rejected').length===1,'two independent PostgreSQL clients competing for one plot yield one commit and one refusal');
 check(race.some(x=>x.status==='rejected'&&/HISTORICAL_REVISION_STALE|HISTORICAL_REVISION_OCCUPIED/.test(String(x.reason))),'losing concurrent import is rejected by freshness or occupancy guard');
 check(await query("SELECT (SELECT count(*) FROM public.sales WHERE plot_id='SYNTHETIC-REVISION-CONCURRENT')=1 AND (SELECT count(*) FROM sales_revision_private.events WHERE plot_id='SYNTHETIC-REVISION-CONCURRENT')=1 AND (SELECT count(*) FROM sales_revision_private.batches WHERE dataset_key IN('SYNTHETIC-CONCURRENT-A','SYNTHETIC-CONCURRENT-B'))=1 AND (SELECT has_customer AND sale_status='available' FROM public.plots WHERE id='SYNTHETIC-REVISION-CONCURRENT');")==='t','concurrent loser leaves no retained batch or extra Sale and stock remains occupied without changing construction status');
 check(await query('SELECT NOT EXISTS(SELECT 1 FROM sales_revision_private.permits) AND NOT EXISTS(SELECT 1 FROM sales_private.booking_write_permits) AND NOT EXISTS(SELECT 1 FROM sales_private.customer_deal_details_permits);')==='t','both concurrent clients leave no reusable permits');
 report.syntheticHistoricalRevisionFixture={adminId:admin,payload:payload([await record({...pending[0],saleId:null,plotId:'SYNTHETIC-REVISION-RACE'},965,'create_booking')],'SYNTHETIC-CROSS-ADAPTER-REVISION')};
 return {cases,assertions:cases.length,syntheticOnly:true,actualGuardBodies:true,realDatabaseTested:false,fullExternalDeploymentTested:false,operationalAuthCertified:false};
}
