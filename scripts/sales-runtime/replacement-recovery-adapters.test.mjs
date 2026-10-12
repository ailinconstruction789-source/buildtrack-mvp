import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {reviewedReplacementRecoveryAdapters,recoveryIdentityAnchorSql} from './replacement-recovery-adapters.mjs';

const root=resolve(import.meta.dirname,'../..');
const normalize=x=>x.replaceAll('\r\n','\n');
const md5=x=>createHash('md5').update(x).digest('hex');
const live=JSON.parse(readFileSync(join(root,'node_modules/.cache/buildtrack-sales-runtime/live-catalog-2026-10-11.json'),'utf8'));
const sqlFiles=readdirSync(join(root,'sql/sales')).filter(x=>x.endsWith('.sql')&&!x.startsWith('32_'));
const sources=sqlFiles.map(x=>normalize(readFileSync(join(root,'sql/sales',x),'utf8'))).join('\n');
const required=[['sales_private','crm_booking_protect_sale'],['crm_external_private','guard_cutover_sale'],['sales_revision_private','marker_guard'],['sales_private','crm_customer_deal_details_guard'],['sales_import_private','forecast_guard'],['crm_external_private','guard_booking_plot_stock'],['public','update_sales_updated_at_column'],['customer_source_membership_private','customer_member'],['customer_source_membership_private','interest_member'],['sales_revision_private','assert_stock_catalog'],['customer_source_membership_private','assert_catalog'],['sales_history_read_private','records'],['sales_history_read_private','original_excel'],['sales_revision_private','history']];
// Fixture metadata is explicit. Root must compile the generated SQL against a
// separately captured post-31 native catalog; these tests do not simulate PG.
function catalogFixture(){return {functions:required.map(([schema,name])=>{
 const old=live.functions.find(f=>f.schema===schema&&f.name===name);
 if(old)return structuredClone(old);
 let body;
 if(name==='update_sales_updated_at_column')body='\nBEGIN\n NEW.updated_at=now(); RETURN NEW;\nEND;\n';
 else if(name==='original_excel')body=normalize(live.functions.find(f=>f.schema==='crm_excel_private'&&f.name==='evidence').body);
 else {
  const match=sources.match(new RegExp('CREATE (?:OR REPLACE )?FUNCTION '+schema+'\\.'+name+'\\([\\s\\S]*?\\bAS (\\$[a-zA-Z0-9_]*\\$)([\\s\\S]*?)\\1;'));
  assert.ok(match,'fixture body '+schema+'.'+name);body=match[2];
 }
 return {schema,name,body,md5:md5(body),owner:'postgres',securityDefiner:name!=='customer_member'&&name!=='interest_member',config:['search_path=pg_catalog'],definition:`CREATE OR REPLACE FUNCTION ${schema}.${name}() RETURNS void LANGUAGE plpgsql AS $fixture$${body}$fixture$;`};
})};}
const recovery=normalize(readFileSync(join(root,'sql/sales/32_customer_replacement_recovery_draft.sql'),'utf8'));

test('catalog adapters retain exact old authorization and add 13 narrowly reviewed bodies',()=>{
 const c=catalogFixture(), result=reviewedReplacementRecoveryAdapters(root,c);
 assert.equal(result.executed,false);assert.equal(result.productionChanged,false);
 assert.ok(result.functions.length>=13);assert.match(result.sourceSha256,/^[a-f0-9]{64}$/);
 assert.ok(result.functions.every(x=>x.beforeMd5!==x.afterMd5));
 for(const f of c.functions.slice(0,7)){
  const tail=f.body.split('BEGIN')[1].replaceAll("'","''");
  assert.ok(result.sql.includes(tail),'retains original body '+f.name);
 }
 assert.match(result.sql,/TG_TABLE_NAME=''sales'' AND TG_OP=''UPDATE'' AND sales_recovery_private.row_allowed/);
 assert.doesNotMatch(result.sql,/DISABLE TRIGGER|DROP TRIGGER|session_replication_role/i);
});
test('history compensation filtering occurs inside original readers and exact catalog compatibility is sealed',()=>{
 const result=reviewedReplacementRecoveryAdapters(root,catalogFixture());
 assert.match(result.sql,/active_revision_events/);assert.match(result.sql,/active_creation_records/);assert.match(result.sql,/active_unknown_records/);
 assert.match(result.sql,/adapter_matches\(a.signature,a.after_md5/);
 assert.match(result.sql,/NOT sales_recovery_private.retired_parent\(''customer'',p_id\)/);
 assert.match(result.sql,/pg_get_userbyid\(proowner\)=current_user/);
 assert.match(result.sql,/proconfig IS NOT DISTINCT FROM/);
 assert.match(result.sql,/CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED/);
});
test('missing timestamp function fails closed',()=>{
 const c=catalogFixture();c.functions=c.functions.filter(f=>f.name!=='update_sales_updated_at_column');
 assert.throws(()=>reviewedReplacementRecoveryAdapters(root,c),/EXACT_CATALOG_FUNCTION_REQUIRED/);
});
test('duplicate overload fails closed rather than selecting a guessed signature',()=>{
 const c=catalogFixture();c.functions.push(structuredClone(c.functions[0]));
 assert.throws(()=>reviewedReplacementRecoveryAdapters(root,c),/EXACT_CATALOG_FUNCTION_REQUIRED/);
});
test('body checksum, exact declaration and security metadata are required',()=>{
 for(const patch of [{md5:'0'.repeat(32)},{definition:'SELECT 1'},{securityDefiner:undefined},{config:undefined}]){
  const c=catalogFixture();Object.assign(c.functions[0],patch);
  assert.throws(()=>reviewedReplacementRecoveryAdapters(root,c),/VERIFIED_CATALOG_BODY_REQUIRED/);
 }
});
test('unknown stock catalog format blocks adapter preparation',()=>{
 const c=catalogFixture(),f=c.functions.find(f=>f.name==='assert_stock_catalog');
 f.body=f.body.replace('eb32ae486d63956e802027ec8ce6fd28','0'.repeat(32));f.md5=md5(f.body);f.definition='$fixture$'+f.body+'$fixture$';
 assert.throws(()=>reviewedReplacementRecoveryAdapters(root,c),/STOCK_CATALOG_SOURCE_REQUIRED/);
});
test('repeated recovery installation fails closed',()=>{
 const c=catalogFixture(),f=c.functions[0];f.body=f.body.replace('BEGIN','BEGIN\n PERFORM sales_recovery_private.operator();');f.md5=md5(f.body);f.definition='$fixture$'+f.body+'$fixture$';
 assert.throws(()=>reviewedReplacementRecoveryAdapters(root,c),/ALREADY_ADAPTED_CATALOG/);
});
test('identity migration replaces only two reviewed single-column Sale FK targets',()=>{
 const bundle=reviewedReplacementRecoveryAdapters(root,catalogFixture());
 assert.equal((bundle.sql.match(/DO \$recovery_sale_identity_fks\$/g)||[]).length,1);
 const sql=recoveryIdentityAnchorSql();assert.match(sql,/found_count<>1/);
 assert.match(sql,/confrelid='public.sales'::regclass/);assert.match(sql,/conkey=ARRAY\[column_number\]/);
 assert.match(sql,/confdeltype NOT IN\('a','r'\)/);assert.match(sql,/fk.condeferrable IS DISTINCT FROM target.deferred/);
 assert.match(sql,/REFERENCES sales_recovery_private.sale_identities\(id\) ON DELETE RESTRICT/);
 assert.doesNotMatch(sql,/CASCADE|DROP TABLE|DELETE FROM/);
 assert.equal((sql.match(/historical_sale_identity_fk/g)||[]).length,1);
 assert.equal((sql.match(/membership_sale_identity_fk/g)||[]).length,1);
});
test('journal draft has exact before/after drift gates, typed record restoration and immutable retained-parent disclosure',()=>{
 assert.match(recovery,/captured IS DISTINCT FROM s.after_state/);
 assert.match(recovery,/CUSTOMER_RECOVERY_BEFORE_BUSINESS_PARITY_REQUIRED/);
 assert.match(recovery,/GET DIAGNOSTICS changed=ROW_COUNT/);
 assert.match(recovery,/jsonb_populate_record\(NULL::%s,\$1\)/);
 assert.match(recovery,/expected_old IS DISTINCT FROM NEW.old_row OR expected_new IS DISTINCT FROM NEW.new_row/);
 assert.match(recovery,/physicalParentsRetained',true/);assert.match(recovery,/immutableEvidenceRetained',true/);
 assert.ok(recovery.indexOf('CUSTOMER_RECOVERY_BEFORE_BUSINESS_PARITY_REQUIRED')<recovery.indexOf('INSERT INTO sales_recovery_private.recoveries VALUES'));
 assert.doesNotMatch(recovery,/DROP TRIGGER|DISABLE TRIGGER|DROP SCHEMA|EXCEPTION WHEN/i);
});
test('journal blocks browser invocation and never captures user/auth/session credentials',()=>{
 assert.match(recovery,/current_user IS DISTINCT FROM session_user/);
 assert.match(recovery,/public.crm_v2_role\(\) IS DISTINCT FROM 'admin'/);
 assert.match(recovery,/REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_recovery_private FROM PUBLIC,anon,authenticated/);
 assert.doesNotMatch(recovery,/FROM public.users|FROM auth.users|FROM auth.sessions/);
 assert.match(recovery,/SENSITIVE_RELATION_REVIEW_REQUIRED/);
 assert.match(recovery,/t='crm_settings' AND attname='voice_token_ttl_hours'/);
});
