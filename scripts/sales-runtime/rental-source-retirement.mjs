// Actual retirement/booking/source-reader/plot guard bodies over synthetic data.
// No production certificate: upstream materialization is typed fixture setup.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {syntheticDraftBody} from './safety.mjs';
import {reviewedRetirementAdapters} from './retirement-adapter-sources.mjs';
import {bindRentalSourceRetirementInputs} from '../sales-import/prepare-rental-source-retirement.mjs';
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const sha=v=>createHash('sha256').update(v).digest('hex');
const admin='ca280000-0000-4000-8000-000000000001',sales='cb310000-0000-4000-8000-000000000001',owner='cb310000-0000-4000-8000-000000000003';
const request=(sql,id=admin,role='')=>`BEGIN;${role?`SET LOCAL ROLE ${role};`:''} SET LOCAL "request.jwt.claim.sub"=${q(id)};${sql} COMMIT;`;
export async function runRentalSourceRetirement({query,root,report,parseHistory,parseExcel}) {
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
 const cases=[],check=(ok,label)=>{assert.ok(ok,label);cases.push(label);};
 const deny=async(label,sql,pattern)=>{await assert.rejects(query(sql),pattern);cases.push(label);};
 const read=p=>{const s=readFileSync(join(root,p),'utf8');report.sources[p]=sha(s);return s;};
 read('scripts/sales-runtime/rental-source-retirement.mjs');read('scripts/sales-runtime/retirement-adapter-sources.mjs');read('scripts/sales-import/prepare-rental-source-retirement.mjs');
 const deals=report.syntheticRentalDeals;assert.equal(deals?.length,6);
 // Model one genuinely unknown old visit day before registering any retirement
 // capture. This is typed synthetic setup, never an edit to an immutable/live source.
 await query(`UPDATE crm_external_private.source_records SET payload=jsonb_set(payload,'{reviewedHistory,visitHistoryDate}','null') WHERE source_row=959;`);
 const writer=read('sql/sales/external_booking_writer_draft.sql');
 const at=writer.indexOf('CREATE FUNCTION crm_external_private.guard_booking_plot_stock('),last=writer.indexOf('$$;',at);
 const bookingAt=writer.indexOf('CREATE FUNCTION crm_external_private.booking_sale_allowed('),bookingEnd=writer.indexOf('$$;',bookingAt);
 assert.ok(at>=0&&last>at);
 const sync=read('sync_plot_sales_status.sql');const end=sync.indexOf('$$ LANGUAGE plpgsql;');assert.ok(end>0);
 // Install the actual functions, without the unrelated retroactive UPDATEs.
 // Historical revision already installed and adapted the actual plot guard and
 // sync before its writes. Preserve that composed definition; never replace it
 // with the base body after the compatibility check.
 assert.equal(await query("SELECT to_regprocedure('crm_external_private.guard_booking_plot_stock()') IS NOT NULL AND to_regprocedure('public.sync_plot_customer_status()') IS NOT NULL;"),'t');
 await query(writer.slice(bookingAt,bookingEnd+3));
 const path='sql/sales/30_rental_source_retirement_draft.sql',source=read(path),sql=syntheticDraftBody(path,source);
 const adapters=reviewedRetirementAdapters(root);
 check(source.includes(adapters.sql),'checked-in adapters match exact reviewed generator output');
 const definition=await query("SELECT pg_get_functiondef('sales_private.crm_booking_protect_sale()'::regprocedure);");
 await query(definition.replace('DECLARE linked','-- SYNTHETIC unknown body\nDECLARE linked'));
 await deny('unknown booking guard rejects installation atomically',sql,/RENTAL_RETIREMENT_ADAPTER_REVIEW_REQUIRED/);
 check(await query("SELECT to_regnamespace('rental_source_retirement_private') IS NULL;")==='t','failed guard review leaves no retirement tables');
 await query(definition);await query(sql);
 check(await query("SELECT position('sales_revision_private.plot_allowed' IN prosrc)>0 AND position('rental_source_retirement_private.plot_allowed' IN prosrc)>0 FROM pg_proc WHERE oid='crm_external_private.guard_booking_plot_stock()'::regprocedure;")==='t','composed stock guard retains both historical revision and retirement hooks');
 await query(request('SELECT sales_revision_private.assert_stock_catalog();'));
 check(true,'execution-time historical stock review accepts exactly the reviewed retirement composition');
 const state=()=>query(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.sales_customers x),'interests',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.lead_project_interests x),'sales',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.sales x),'plots',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.plots x),'prepared',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM crm_external_private.prepared_booking_sales x),'source',(SELECT jsonb_agg(to_jsonb(x) ORDER BY batch_id,source_row) FROM crm_external_private.source_records x),'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY batch_id) FROM crm_external_private.sales_cutover_receipts x),'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.crm_audit_events x));`);
 const beforeState=await state();
 const m=JSON.parse(read('reports/rental-source-retirement-inputs-2026-10-10.json'));delete m.inputDigest;
 const capture=async(d)=>JSON.parse(await query(request(`SELECT jsonb_build_object('sourceRow',${d.sourceRow},'before',rental_source_retirement_private.capture(${j({customerId:d.customerId,interestId:d.interestId,saleId:d.saleId,plotId:d.plotId})},${d.sourceRow}),
 'columns',jsonb_build_object('customer',(SELECT jsonb_agg(attname ORDER BY attname) FROM pg_attribute WHERE attrelid='public.sales_customers'::regclass AND attnum>0 AND NOT attisdropped),'interest',(SELECT jsonb_agg(attname ORDER BY attname) FROM pg_attribute WHERE attrelid='public.lead_project_interests'::regclass AND attnum>0 AND NOT attisdropped),'sale',(SELECT jsonb_agg(attname ORDER BY attname) FROM pg_attribute WHERE attrelid='public.sales'::regclass AND attnum>0 AND NOT attisdropped),'plot',(SELECT jsonb_agg(attname ORDER BY attname) FROM pg_attribute WHERE attrelid='public.plots'::regclass AND attnum>0 AND NOT attisdropped)));`)));
 const captures=[];
 for(const d of deals) {
  const c=await capture(d);captures.push(c);const b=c.before,r=m.records.find(x=>x.sourceRow===d.sourceRow);
  r.binding={customerId:d.customerId,interestId:d.interestId,saleId:d.saleId,plotId:d.plotId};r.projectName=b.plot.project_name;
  r.sourceBatchId=b.customer.external_snapshot_batch_id;r.customerSourceKey=b.customer.external_customer_key;r.interestSourceKey=b.interest.external_interest_key;
  r.referenceRevisions={customer:b.customer.lifecycle_revision,interest:b.interest.lifecycle_revision,sale:b.sale.booking_revision};
  r.referenceInventory=b.inventory.map(s=>({id:s.id,stage:s.crm_stage,interestId:s.project_interest_id}));
 }
 m.inputDigest=sha(JSON.stringify(m));
 const payload=bindRentalSourceRetirementInputs({manifest:m,captures});
 check(payload.records.length===6,'offline binder accepts complete catalog-backed synthetic before-images');
 for(const captureEntry of captures){
  const b=captureEntry.before,n=captureEntry.sourceRow;
  await deny(`source ${n} requires a valid captured booking revision UUID`,request(`SELECT rental_source_retirement_private.source(jsonb_set(${j(b.sale)},'{booking_revision}','null'),${j(b.customer)},${n});`),/RENTAL_RETIREMENT_SOURCE_REQUIRED/);
  await deny(`source ${n} still rejects any changed archived Sale amount`,request(`SELECT rental_source_retirement_private.source(jsonb_set(${j(b.sale)},'{sale_price}',${j(b.sale.sale_price===1?2:1)}),${j(b.customer)},${n});`),/RENTAL_RETIREMENT_SOURCE_REQUIRED/);
 }
 for(const role of ['anon','authenticated']) {
  await deny(`${role} cannot read retirement archive`,request('SELECT * FROM rental_source_retirement_private.archives;',sales,role),/permission denied/);
  await deny(`${role} cannot run private retirement`,request(`SELECT rental_source_retirement_private.apply(${j(payload)},'SYNTHETIC reviewed');`,sales,role),/permission denied/);
 }
 await deny('Sales cannot register private review even as DB owner',request(`SELECT rental_source_retirement_private.register_review(${j(m)});`,sales),/RENTAL_RETIREMENT_FORBIDDEN/);
 await deny('Owner cannot register private review',request(`SELECT rental_source_retirement_private.register_review(${j(m)});`,owner),/RENTAL_RETIREMENT_FORBIDDEN/);
 const malformed=structuredClone(m);malformed.records[0].rowSha256=null;
 await deny('missing source hash fails closed',request(`SELECT rental_source_retirement_private.register_review(${j(malformed)});`),/RENTAL_RETIREMENT_REVIEW_INVALID/);
 await query(request(`SELECT rental_source_retirement_private.register_review(${j(m)});`));
 const apply= p=>`SELECT rental_source_retirement_private.apply(${j(p)},'SYNTHETIC reviewed administrative retirement');`;
 await deny('inactive Admin cannot retire rows',request(`UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id=${q(admin)};${apply(payload)}`),/RENTAL_RETIREMENT_FORBIDDEN/);
 for(const [label,mutate] of [
  ['changed before-image',p=>{p.records[5].before.sale.sale_price=1;}],
  ['incomplete before-image',p=>{delete p.records[0].before.customer.owner_user_id;}],
  ['missing dependent catalog entry',p=>{p.records[0].before.dependencies.constraints.pop();}],
  ['incomplete source receipt',p=>{p.records[0].before.source.cutoverReceiptDigest='0'.repeat(32);}],
  ['wrong exact source binding',p=>{p.records[0].binding.saleId=p.records[1].binding.saleId;}],
  ['invented cancellation history',p=>{p.records[0].history.push({kind:'cancelled',date:'2026-10-10',precision:'day'});}]
 ]){const p=structuredClone(payload);mutate(p);await deny(label,request(apply(p)),/RENTAL_RETIREMENT_(STALE|BINDING_CHANGED)/);}
 const extra=structuredClone(payload);extra.records.pop();await deny('partial five-row retirement rejected',request(apply(extra)),/RENTAL_RETIREMENT_INVALID_INPUT/);
 await deny('plain DELETE still blocked',request(`DELETE FROM public.sales WHERE id=${q(deals[0].saleId)};`),/CRM_BOOKING_FORBIDDEN|EXTERNAL_CUTOVER_SALES_SEALED/);
 await deny('ordinary booking permit cannot DELETE',request(`INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid()); DELETE FROM public.sales WHERE id=${q(deals[0].saleId)};`),/CRM_BOOKING_CONFLICT|EXTERNAL_CUTOVER_SALES_SEALED/);
 check(await state()===beforeState,'all initial rejected operations preserve business rows byte-for-byte');
 // Dependency fixtures are transactionally rolled back, never added to source DB.
 for(const [label,ddl] of [
  ['CASCADE child','CREATE TABLE public.synthetic_retirement_child(sale_id uuid REFERENCES public.sales ON DELETE CASCADE);'],
  ['SET NULL child','CREATE TABLE public.synthetic_retirement_child(sale_id uuid REFERENCES public.sales ON DELETE SET NULL);'],
  ['composite deferred CASCADE child','CREATE TABLE public.synthetic_retirement_child(sale_id uuid,interest_id uuid,FOREIGN KEY(sale_id,interest_id) REFERENCES public.sales(id,project_interest_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED);'],
  ['unconstrained entity reference','CREATE TABLE public.synthetic_retirement_child(entity_id uuid);']
 ]) {
  const column=label.includes('entity')?'entity_id':'sale_id';
  await deny(`${label} blocks the whole batch`,request(`${ddl} INSERT INTO public.synthetic_retirement_child(${column}${label.includes('composite')?',interest_id':''}) VALUES(${q(deals[5].saleId)}${label.includes('composite')?`,${q(deals[5].interestId)}`:''});
   DO $$ DECLARE p jsonb:=${j(payload)};d jsonb;k integer;BEGIN FOR k IN 0..5 LOOP SELECT rental_source_retirement_private.dependencies(p->'records'->k->'before'->'sale') INTO d;
    p:=jsonb_set(p,ARRAY['records',k::text,'before','dependencies'],d); END LOOP; PERFORM rental_source_retirement_private.apply(p,'SYNTHETIC dependency review'); END; $$;`),/RENTAL_RETIREMENT_DEPENDENCIES/);
 }
 check(await state()===beforeState,'dependent CASCADE and SET NULL rows never cause side effects');
 // Force a last-row DELETE failure: preceding archives/deletes/plot updates must roll back.
 await deny('last-row trigger failure rolls back earlier retirements',request(`CREATE FUNCTION public.synthetic_retirement_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id=${q(deals[5].saleId)}::uuid THEN RAISE EXCEPTION 'SYNTHETIC_RETIREMENT_FAILURE'; END IF;RETURN OLD;END;$$;
 CREATE TRIGGER z_synthetic_retirement_failure BEFORE DELETE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.synthetic_retirement_failure();${apply(payload)}`),/SYNTHETIC_RETIREMENT_FAILURE/);
 check(await state()===beforeState,'failed last-row retirement preserves the entire prior business snapshot');
 check(await query('SELECT count(*) FROM rental_source_retirement_private.archives;')==='0','failed batch leaves no archives or leaked permit');
 const history=async(d)=>{const result=JSON.parse(await query(request(`SELECT public.crm_v2_customer_history(${q(d.customerId)},NULL,NULL,0);`,sales,'authenticated')));parseHistory(result,{customerId:d.customerId,interestId:null,saleId:null,page:0});return result;};
 const excel=async()=>{const projectName='SYNTHETIC HISTORICAL DEALS',result=JSON.parse(await query(request(`SELECT public.crm_v2_excel_evidence(${q(projectName)});`,sales,'authenticated'))),salePages=[];
  for(let page=0;page<200;page++) {const s=JSON.parse(await query(request(`SELECT public.crm_v2_project_sales(${q(projectName)},'all','',${page});`,sales,'authenticated')));salePages.push({page:s.page,hasMore:s.hasMore,rows:s.rows});if(!s.hasMore)break;}
  parseExcel(result,{projectName,actor:result.actor,salePages});return result;};
 const historiesBefore=await Promise.all(deals.map(history)),excelBefore=await excel();
 const receipt=JSON.parse(await query(request(apply(payload))));check(receipt.retired===6&&!receipt.replayed,'six exact Sales retired successfully');
 const after=JSON.parse(await state()),before=JSON.parse(beforeState);
 check(JSON.stringify(after.customers)===JSON.stringify(before.customers)&&JSON.stringify(after.interests)===JSON.stringify(before.interests),'all Customers and Interests remain byte-for-byte intact');
 check(after.sales.length===before.sales.length-6&&after.sales.every(s=>!deals.some(d=>d.saleId===s.id)),'only six selected Sales removed');
 check(after.plots.every(p=>JSON.stringify(p)===JSON.stringify(deals.some(d=>d.plotId===p.id)?{...before.plots.find(x=>x.id===p.id),has_customer:false}:before.plots.find(x=>x.id===p.id))),'actual legacy sync changes only six occupancy flags');
 for(const key of ['prepared','source','receipts','audit'])check(JSON.stringify(after[key])===JSON.stringify(before[key]),`${key} remains untouched; no cancellation invented`);
 check(await query('SELECT count(*) FROM rental_source_retirement_private.permits;')==='0','successful retirement leaves no reusable permits');
 for(const d of deals){const h=await history(d);check(!h.records.some(r=>r.sourceRow===d.sourceRow),`source row ${d.sourceRow} excluded from customer timeline`);}
 check((await history(deals[0])).records.some(r=>r.sourceRow===4),'same Customer keeps its independent non-rental deal and history');
 check(after.sales.some(s=>s.id===report.syntheticRentalCancelledPrior.saleId)&&JSON.stringify(after.sales.find(s=>s.id===report.syntheticRentalCancelledPrior.saleId))===JSON.stringify(before.sales.find(s=>s.id===report.syntheticRentalCancelledPrior.saleId)),'cancelled prior Sale on the retired plot is preserved byte-for-byte');
 const excelAfter=await excel();
 check(excelAfter.legacyVisits.length===excelBefore.legacyVisits.length-5,'Excel visit fallback cannot reintroduce five known-day rental sources');
 check(excelAfter.unknownLegacyDates===excelBefore.unknownLegacyDates-1,'unknown rental visit is removed from its counter without inventing a civil day');
 check(!excelAfter.forecasts.some(f=>deals.some(d=>d.saleId===f.saleId)),'Excel forecasts exclude retired Sales');
 const replay=JSON.parse(await query(request(apply(payload))));check(replay.replayed&&replay.batchId===receipt.batchId,'identical retry returns existing verified receipt');
 await deny('raw INSERT restore is blocked without scoped permit',request(`INSERT INTO public.sales SELECT (jsonb_populate_record(NULL::public.sales,${j(payload.records[0].before.sale)})).*;`),/CRM_BOOKING_FORBIDDEN|EXTERNAL_CUTOVER_SALES_SEALED/);
 await deny('changed plot blocks restore',request(`UPDATE public.plots SET plot_name='SYNTHETIC changed after retirement' WHERE id=${q(deals[5].plotId)};SELECT rental_source_retirement_private.restore(${q(receipt.batchId)},'SYNTHETIC stale restore');`),/RENTAL_RETIREMENT_RESTORE_STALE/);
 await deny('changed plot blocks success replay',request(`UPDATE public.plots SET plot_name='SYNTHETIC changed after retirement' WHERE id=${q(deals[5].plotId)};${apply(payload)}`),/RENTAL_RETIREMENT_REPLAY_STALE/);
 const newSale=randomUUID(),d=deals[0];
 await deny('new legitimate booking on freed plot blocks the entire restore',request(`SELECT crm_external_private.begin_booking_write(auth.uid(),${q(d.customerId)},${q(d.interestId)},${q(newSale)},'book');
 INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
 INSERT INTO public.sales(id,project_interest_id,plot_id,crm_stage,contract_status,payment_method,booking_route,booking_route_reason,booking_round,booked_at,sale_price,list_price,discount_amount,closing_sales_user_id)
 VALUES(${q(newSale)},${q(d.interestId)},${q(d.plotId)},'booked','Reserved','cash','without_visit','SYNTHETIC new booking after retirement',99,now(),1000000,1000000,0,${q(sales)});
 SELECT crm_external_private.end_booking_write(); DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
 SELECT rental_source_retirement_private.restore(${q(receipt.batchId)},'SYNTHETIC stale new-booking restore');`),/RENTAL_RETIREMENT_RESTORE_STALE/);
 await deny('archive cannot be rewritten',request(`UPDATE rental_source_retirement_private.archives SET source_row=1;`),/RENTAL_RETIREMENT_IMMUTABLE/);
 await deny('archive cannot be truncated',request('TRUNCATE rental_source_retirement_private.archives CASCADE;'),/RENTAL_RETIREMENT_IMMUTABLE/);
 const retiredState=await state();
 await deny('last-row restore failure rolls back earlier inserts and plot sync',request(`CREATE FUNCTION public.synthetic_restore_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=${q(deals[5].saleId)}::uuid THEN RAISE EXCEPTION 'SYNTHETIC_RESTORE_FAILURE';END IF;RETURN NEW;END;$$;
 CREATE TRIGGER z_synthetic_restore_failure BEFORE INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION public.synthetic_restore_failure();SELECT rental_source_retirement_private.restore(${q(receipt.batchId)},'SYNTHETIC restore failure');`),/SYNTHETIC_RESTORE_FAILURE/);
 check(await state()===retiredState,'failed restoration preserves the entire retired business state');
 check(await query('SELECT count(*) FROM rental_source_retirement_private.restores;')==='0','failed restoration leaves no success receipt');
 const restored=JSON.parse(await query(request(`SELECT rental_source_retirement_private.restore(${q(receipt.batchId)},'SYNTHETIC reviewed restoration');`)));
 check(restored.restored===6,'guarded restore returns same six Sale IDs');
 check(await state()===beforeState,'restore returns complete original business/source snapshot exactly');
 check(JSON.stringify(await Promise.all(deals.map(history)))===JSON.stringify(historiesBefore),'customer history returns exactly after restore');
 check(JSON.stringify(await excel())===JSON.stringify(excelBefore),'Excel visits/forecasts/counters return exactly after restore');
 await deny('repeat restore rejected',request(`SELECT rental_source_retirement_private.restore(${q(receipt.batchId)},'SYNTHETIC reviewed restoration');`),/RENTAL_RETIREMENT_ALREADY_RESTORED/);
 await deny('retirement retry cannot remove restored Sales',request(apply(payload)),/RENTAL_RETIREMENT_ALREADY_RESTORED/);
 check(await query('SELECT count(*) FROM rental_source_retirement_private.permits;')==='0','all restore failures leave no permits');
 return {passed:cases.length,failed:0,cases,sourceRows:deals.map(d=>d.sourceRow),scope:'synthetic fixtures with actual guard/reader/sync bodies; not full production materialization or replacement',businessWrites:false,productionChanged:false,restoredExactly:true};
}
