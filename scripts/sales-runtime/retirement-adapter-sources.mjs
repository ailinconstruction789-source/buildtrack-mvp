// Build exact, fail-closed adapters from reviewed repository function bodies.
// This reads SQL source only. It neither connects to a database nor installs SQL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const md5=v=>createHash('md5').update(v).digest('hex');
const q=v=>`'${v.replaceAll("'","''")}'`;
export function reviewedRetirementAdapters(root) {
 const read=p=>readFileSync(join(root,p),'utf8').replaceAll('\r\n','\n');
 const body=(s,name,tag)=>{const start=s.indexOf(`FUNCTION ${name}(`);assert.ok(start>=0,name);const pos=s.indexOf(`AS ${tag}`,start);assert.ok(pos>=0);const end=s.indexOf(tag,pos+tag.length+3);assert.ok(end>pos);return s.slice(pos+tag.length+3,end);};
 const tagged=(s,tag)=>{const start=s.indexOf(tag);assert.ok(start>=0);return s.slice(start+tag.length,s.indexOf(tag,start+tag.length));};
 const externalBase=read('sql/sales/21_post_booking_draft.sql');
 let external=tagged(externalBase,'$expected_cutover$');
 external=external.replace('  IF permit.transaction_id IS NULL THEN','  IF permit.transaction_id IS NULL THEN'+tagged(externalBase,'$hook$'));
 assert.equal(md5(external),'e0959fce0d5b49f4d571eb9224ea6395');
 external=external.replace('  IF permit.transaction_id IS NULL THEN','  IF permit.transaction_id IS NULL THEN'+tagged(read('sql/sales/28_historical_sale_revision_draft.sql'),'$hook$'));
 const booking=body(read('sql/sales/18_booking_history_draft.sql'),'sales_private.crm_booking_protect_sale','$protect$');
 let plot=body(read('sql/sales/external_booking_writer_draft.sql'),'crm_external_private.guard_booking_plot_stock','$$');
 plot=plot.replace('BEGIN','BEGIN'+tagged(read('sql/sales/28_historical_sale_revision_draft.sql'),'$historical_plot_hook$'));
 const records=body(read('sql/sales/29_imported_history_projection_draft.sql'),'sales_history_read_private.records','$records$');
 let excel=body(read('sql/sales/excel_report_evidence_draft.sql'),'crm_excel_private.evidence','$evidence$');
 assert.equal(md5(excel),'738a8d0787d234d2fd06dce3966bdc11');
 excel=excel.replace("s.payload->'reviewedHistory'->>'expectedTransferDate' AS source_day","sales_import_private.expected_transfer_date(sale.id,s.payload->'reviewedHistory'->>'expectedTransferDate') AS source_day");
 const syncBody=body(read('sync_plot_sales_status.sql'),'sync_plot_customer_status','$$');
 const saleHook="BEGIN\n IF rental_source_retirement_private.sale_allowed(TG_OP,CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;";
 const plotHook="BEGIN\n IF TG_OP='UPDATE' AND rental_source_retirement_private.plot_allowed(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;";
 const adapters=[
  {fn:'sales_private.crm_booking_protect_sale()',body:booking,secured:true,config:['search_path=pg_catalog'],old:'BEGIN',next:saleHook,count:1},
  {fn:'crm_external_private.guard_cutover_sale()',body:external,secured:true,config:['search_path=""'],old:'BEGIN',next:saleHook,count:1},
  {fn:'crm_external_private.guard_booking_plot_stock()',body:plot,secured:true,config:['search_path=""'],old:'BEGIN',next:plotHook,count:1},
  {fn:'sales_history_read_private.records(uuid,uuid,uuid,text)',body:records,secured:true,config:['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD'],old:"s.disposition='mapped_for_review'",next:"s.disposition='mapped_for_review' AND NOT rental_source_retirement_private.excluded(s.batch_id,s.source_row)",count:2},
  {fn:'sales_history_read_private.original_excel(text)',body:excel,secured:true,config:['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD'],old:"s.disposition='mapped_for_review'",next:"s.disposition='mapped_for_review' AND NOT rental_source_retirement_private.excluded(s.batch_id,s.source_row)",count:3},
 ];
 let sql=`-- Actual legacy sync remains unchanged; both reviewed bodies have identical SQL tokens.\nDO $sync_review$\nBEGIN\n IF (SELECT md5(replace(prosrc,E'\\r\\n',E'\\n')) FROM pg_proc WHERE oid='public.sync_plot_customer_status()'::regprocedure) NOT IN ('${md5(syncBody)}','d14049d669231cf3b2435b42c869e011')\n  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.sales'::regclass AND tgfoid='public.sync_plot_customer_status()'::regprocedure AND tgname='trigger_sync_plot_customer_status' AND NOT tgisinternal AND tgenabled IN('O','A') AND tgtype=29)\n THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_SYNC_REVIEW_REQUIRED'; END IF;\nEND;\n$sync_review$;\n`;
 for(const [i,a] of adapters.entries()) {
  assert.equal(a.body.split(a.old).length-1,a.count,a.fn);
  sql+=`DO $retirement_adapter_${i}$\nDECLARE definition text; src text; settings text[]; secured boolean; owner_name text; marker text:=${q(a.old)};\nBEGIN\n SELECT pg_get_functiondef(oid),replace(prosrc,E'\\r\\n',E'\\n'),proconfig,prosecdef,pg_get_userbyid(proowner) INTO definition,src,settings,secured,owner_name FROM pg_proc WHERE oid=${q(a.fn)}::regprocedure;\n IF md5(src) IS DISTINCT FROM '${md5(a.body)}' OR owner_name IS DISTINCT FROM current_user OR secured IS DISTINCT FROM ${a.secured}\n  OR settings IS DISTINCT FROM ARRAY[${a.config.map(q).join(',')}] OR (length(src)-length(replace(src,marker,'')))/length(marker)<>${a.count}\n THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_ADAPTER_REVIEW_REQUIRED'; END IF;\n EXECUTE replace(replace(definition,E'\\r\\n',E'\\n'),marker,${q(a.next)});\nEND;\n$retirement_adapter_${i}$;\n`;
 }
 return {sql,hashes:adapters.map(a=>({function:a.fn,md5:md5(a.body)})),syncMd5:md5(syncBody)};
}
