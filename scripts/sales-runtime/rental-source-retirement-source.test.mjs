import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const sql=readFileSync('sql/sales/30_rental_source_retirement_draft.sql','utf8');
const source=sql.split('CREATE FUNCTION rental_source_retirement_private.source(')[1].split('END; $$;')[0];
test('original archive comparison permits only the absent additive revision field',()=>{
 assert.ok(source.includes("CASE WHEN member ? 'booking_revision' THEN member"));
 assert.ok(source.includes("ELSE member||jsonb_build_object('booking_revision',s->'booking_revision') END"));
 assert.match(source,/to_jsonb\(jsonb_populate_record\(NULL::public.sales,[\s\S]+\)\)=s/);
 assert.match(source,/s->>'booking_revision' ~\*/);
 assert.doesNotMatch(source,/\bmember\s*-\s*'booking_revision'|\b(?:UPDATE|INSERT|DELETE)\b/);
 assert.ok(sql.includes("b->'sale'->'booking_revision' IS DISTINCT FROM approved->'referenceRevisions'->'sale'"));
});
test('source compatibility retains complete reviewed provenance and rollback checks',()=>{
 for(const guard of ["sr->>'customer_key' IS DISTINCT FROM c->>'external_customer_key'","p->>'stage' IS DISTINCT FROM 'booked'","p->'payload'->>'customer_id' IS DISTINCT FROM c->>'id'","p->'payload'->>'interest_id' IS DISTINCT FROM s->>'project_interest_id'","p->>'plot_id' IS DISTINCT FROM s->>'plot_id'","sb.feed='customer-sheet' AND sb.plan_digest=w->>'plan_digest'",'FROM crm_external_private.sales_rollback_receipts'])assert.ok(source.includes(guard));
});
const backup='.local-backups/customer-replacement-2026-10-11/tables/';
test('read-only captured six original Sales differ from original receipt only by additive booking_revision',{skip:!existsSync(backup+'public.sales.json')},()=>{
 const read=name=>JSON.parse(readFileSync(backup+name+'.json','utf8'));
 const manifest=JSON.parse(readFileSync('reports/rental-source-retirement-inputs-2026-10-10.json','utf8'));
 const sales=read('public.sales'),receipts=read('crm_external_private.sales_cutover_receipts');
 for(const row of manifest.records){
  const sale=sales.find(s=>s.id===row.binding.saleId);
  const receipt=receipts.find(r=>r.batch_id===row.sourceBatchId);
  const member=receipt.after_sales.find(s=>s.id===sale.id);
  assert.equal(Object.hasOwn(member,'booking_revision'),false,'original immutable receipt predates added revision column');
  assert.equal(sale.booking_revision,row.referenceRevisions.sale,'fresh captured revision matches independent reviewed binding');
  const original=JSON.stringify(member);
  const typed=Object.fromEntries(Object.keys(sale).map(k=>[k,k==='booking_revision'?sale.booking_revision:(member[k]??null)]));
  assert.deepEqual(typed,sale,'every other archived Sale column remains exact after nullable typed projection');
  assert.equal(JSON.stringify(member),original,'comparison preserves the original archive bytes');
 }
 assert.equal(manifest.records.length,6);
});
