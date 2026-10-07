// Exact candidate tests. Receives only a verified disposable cluster adapter.
import assert from 'node:assert/strict';
import {crmFoundationCandidatePath} from './crm-foundation-candidate.mjs';
import {sharedSchemaFixtureSql, sharedShapeQuery, assertReviewedSharedShape, sharedDepartmentSnapshotQuery} from './shared-schema-fixture.mjs';
export {crmFoundationCandidatePath};
const settings=patch=>Object.entries({release:'sealed_crm_v1_20260928',project:'kbthmdedilswdmmczfay',
    backup:'SYNTHETIC backup',auth_compatibility:'SYNTHETIC Auth fixture only',legacy_clients_reviewed:'yes',
    mode:'sealed_no_backfill',counts:'{"projects":1,"plots":2,"leads":1,"sales":1,"voices":1}',...patch})
    .map(([k,v])=>`SET buildtrack.crm_foundation_${k}='${v.replaceAll("'","''")}';`).join('\n');
const asClient=sql=>`BEGIN; SET LOCAL ROLE authenticated; ${sql}; ROLLBACK;`;

export async function runCrmFoundationCutover({query,source,plotSyncSource}) {
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_user ~ '^runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t');
    const cases=[];
    const check=async(label,sql)=>{assert.equal(await query(sql),'t',label);cases.push(label);};
    const deny=async(label,sql,pattern)=>{await assert.rejects(query(sql),pattern);cases.push(label);};
    await query(`CREATE FUNCTION public.update_user_last_seen(p_username text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ UPDATE public.users SET last_seen_at=now() WHERE username=p_username; $$;
      ${sharedSchemaFixtureSql()}
      INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC',false);
      INSERT INTO public.plots(id,project_name,foreman_name,has_customer,sale_status) VALUES('A','SYNTHETIC','SYNTHETIC foreman',true,'active'),('B','SYNTHETIC','SYNTHETIC foreman',false,'active');
      INSERT INTO public.leads(id,phone,customer_name,project_name) VALUES('d0280000-0000-4000-8000-000000000001','0000000000','SYNTHETIC history','SYNTHETIC');
      INSERT INTO public.sales(id,lead_id,plot_id,contract_status) VALUES('e0280000-0000-4000-8000-000000000001','d0280000-0000-4000-8000-000000000001','A','Reserved');
      INSERT INTO public.customer_voices(id,customer_name,lead_id,score_knowledge) VALUES('f0280000-0000-4000-8000-000000000001','SYNTHETIC history','d0280000-0000-4000-8000-000000000001',3);
      INSERT INTO public.house_visit_checklists VALUES(1,'d0280000-0000-4000-8000-000000000001','SYNTHETIC checklist');
      INSERT INTO public.plot_promotions VALUES(1,'A','SYNTHETIC promotion');
      INSERT INTO public.task_material_requests(plot_id,note) VALUES('A','SYNTHETIC material request');
      ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY; ALTER TABLE public.customer_voices ENABLE ROW LEVEL SECURITY;
      CREATE POLICY synthetic_legacy_sales ON public.sales FOR ALL TO authenticated USING(true) WITH CHECK(true);
      CREATE POLICY synthetic_legacy_voices ON public.customer_voices FOR ALL TO authenticated USING(true) WITH CHECK(true);
      GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales,public.customer_voices,public.plots TO authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;`);
    assertReviewedSharedShape(JSON.parse(await query(sharedShapeQuery)));
    cases.push('all 130 reviewed legacy columns and 10 constraints match before installation');
    const sharedDepartmentBaseline = await query(sharedDepartmentSnapshotQuery);
    const sync=plotSyncSource.match(/CREATE OR REPLACE FUNCTION sync_plot_customer_status\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/g);
    assert.equal(sync?.length,1,'Reviewed legacy plot trigger body required');
    await query(sync[0]+` CREATE TRIGGER trigger_sync_plot_customer_status AFTER INSERT OR UPDATE OF plot_id,contract_status OR DELETE ON public.sales FOR EACH ROW EXECUTE FUNCTION sync_plot_customer_status();`);
    await deny('unattended installation blocked',source,/CRM_FOUNDATION_REVIEW_REQUIRED/);
    for(const k of ['release','project','backup','auth_compatibility','legacy_clients_reviewed','mode']) {
        await deny(`missing ${k} evidence blocks installation`,settings({[k]:''})+source,/CRM_FOUNDATION_REVIEW_REQUIRED/);
    }
    await deny('changed legacy counts block installation',settings({counts:'{}'})+source,/CRM_FOUNDATION_COUNT_BASELINE_CHANGED/);
    const tampered=source.replace('DO $verify$',"UPDATE public.sales SET booking_amount=123;\nDO $verify$");
    await deny('late data change rolls back entire candidate',settings({})+tampered,/CRM_FOUNDATION_LEGACY_DATA_CHANGED/);
    await check('failed install leaves no schema or legacy value changes',"SELECT to_regnamespace('sales_private') IS NULL AND to_regclass('account_security_private.reviewed_roles') IS NULL AND (SELECT booking_amount=0 FROM public.sales);");
    const timedOut=source.replace("transaction_timeout='30s'","transaction_timeout='200ms'")
        .replace('DO $verify$','SELECT pg_sleep(1);\nDO $verify$');
    await deny('whole transaction timeout aborts candidate',settings({})+timedOut,/transaction timeout/);
    await check('timeout rolls back DDL and preserves legacy rows',"SELECT to_regnamespace('sales_private') IS NULL AND to_regclass('account_security_private.reviewed_roles') IS NULL AND (SELECT booking_amount=0 FROM public.sales);");
    await query(settings({})+source);
    assertReviewedSharedShape(JSON.parse(await query(sharedShapeQuery)), {allowCrmAdditions:true});
    cases.push('legacy types defaults nullability and foreign keys preserved after installation');
    assert.equal(await query(sharedDepartmentSnapshotQuery), sharedDepartmentBaseline);
    cases.push('synthetic incoming child references rows and dependent view preserved');
    await check('sales legacy precision defaults and nullable additions coexist', `BEGIN;
      INSERT INTO public.sales(id,plot_id,sale_price) VALUES('e0280000-0000-4000-8000-000000000003','B',1234567.895);
      SELECT sale_price=1234567.90 AND booking_amount=0 AND bank_status='Pending' AND contract_status='Reserved'
        AND created_at IS NOT NULL AND updated_at IS NOT NULL AND project_interest_id IS NULL AND crm_stage IS NULL
      FROM public.sales WHERE id='e0280000-0000-4000-8000-000000000003'; ROLLBACK;`);
    await deny('reviewed sales lead foreign key remains enforced', "INSERT INTO public.sales(lead_id) VALUES('d0280000-0000-4000-8000-000000000099');", /foreign key constraint/);
    await deny('reviewed sales plot foreign key remains enforced', "INSERT INTO public.sales(plot_id) VALUES('SYNTHETIC missing');", /foreign key constraint/);
    await deny('reviewed lead project foreign key remains enforced', "INSERT INTO public.leads(customer_name,project_name) VALUES('SYNTHETIC','MISSING');", /foreign key constraint/);
    await deny('reviewed voice lead foreign key remains enforced', "INSERT INTO public.customer_voices(customer_name,lead_id) VALUES('SYNTHETIC','d0280000-0000-4000-8000-000000000099');", /foreign key constraint/);
    await deny('construction foreman remains required', "INSERT INTO public.plots(id) VALUES('SYNTHETIC missing foreman');", /not-null constraint/);
    await deny('legacy survey customer name remains required', 'INSERT INTO public.customer_voices DEFAULT VALUES;', /not-null constraint/);
    await check('legacy timestamp trigger still updates on write', `BEGIN;
      UPDATE public.sales SET updated_at='2000-01-01Z'; SELECT bool_and(updated_at=now()) FROM public.sales; ROLLBACK;`);
    await check('no customer import or staff permission seed',`SELECT NOT EXISTS(SELECT 1 FROM public.sales_customers)
      AND NOT EXISTS(SELECT 1 FROM account_security_private.reviewed_roles)
      AND NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles) AND NOT EXISTS(SELECT 1 FROM public.crm_settings);`);
    await check('legacy IDs money and missing provenance unchanged',`SELECT
      (SELECT count(*)=1 AND bool_and(id='e0280000-0000-4000-8000-000000000001' AND booking_amount=0 AND project_interest_id IS NULL AND crm_stage IS NULL) FROM public.sales)
      AND (SELECT count(*)=1 AND bool_and(visit_id IS NULL AND score_knowledge=3) FROM public.customer_voices);`);
    await check('stock uniqueness deferred until frozen writer cutover',"SELECT to_regclass('public.sales_active_plot_booking_idx') IS NULL;");
    for(const role of ['anon','authenticated','service_role']) {
        await deny(`new RPC sealed for ${role}`,`BEGIN; SET LOCAL ROLE ${role}; SELECT public.crm_v2_capabilities(); ROLLBACK;`,/permission denied/);
        await deny(`new table sealed for ${role}`,`BEGIN; SET LOCAL ROLE ${role}; SELECT * FROM public.sales_customers; ROLLBACK;`,/permission denied/);
    }
    await deny('legacy table-wide grant cannot inject sale stage',asClient("UPDATE public.sales SET crm_stage='booked'"),/CRM_FOUNDATION_COLUMNS_SEALED/);
    await deny('legacy table-wide grant cannot inject voice evidence',asClient("UPDATE public.customer_voices SET crm_form_version='forged'"),/CRM_FOUNDATION_COLUMNS_SEALED/);
    await deny('owner also cannot bypass sealed new columns',"UPDATE public.sales SET discount_amount=1;",/CRM_FOUNDATION_COLUMNS_SEALED/);
    await check('legacy cancel still releases plot',asClient("UPDATE public.sales SET contract_status='Cancelled'; SELECT NOT has_customer FROM public.plots WHERE id='A'"));
    await check('legacy transfer still updates plot',asClient("UPDATE public.sales SET contract_status='Transferred'; SELECT has_customer AND sale_status='transferred' FROM public.plots WHERE id='A'"));
    await check('legacy plot move keeps original trigger behavior',asClient("UPDATE public.sales SET plot_id='B'; SELECT (SELECT NOT has_customer FROM public.plots WHERE id='A') AND (SELECT has_customer FROM public.plots WHERE id='B')"));
    await check('legacy survey edit still works',asClient('UPDATE public.customer_voices SET score_knowledge=4; SELECT score_knowledge=4 FROM public.customer_voices'));
    await check('legacy insert and delete still work',asClient("INSERT INTO public.sales(id,plot_id,contract_status) VALUES('e0280000-0000-4000-8000-000000000002','B','Reserved'); DELETE FROM public.sales WHERE plot_id='B'; SELECT NOT has_customer FROM public.plots WHERE id='B'"));
    await deny('snapshots reject overwrite even by owner',"UPDATE sales_private.crm_legacy_source_snapshots SET source_payload='{}';",/ROLE_REVIEW_HISTORY_APPEND_ONLY/);
    await deny('snapshots reject truncate even by owner','BEGIN; TRUNCATE sales_private.crm_legacy_source_snapshots CASCADE; ROLLBACK;',/ROLE_REVIEW_HISTORY_APPEND_ONLY/);
    await check('failed cascade truncate preserved legacy sale','SELECT count(*)=1 FROM public.sales;');
    await check('Auth update for non-CRM employee still works',"BEGIN; UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='a0250000-0000-4000-8000-000000000004'; SELECT NOT EXISTS(SELECT 1 FROM account_security_private.crm_auth_suspensions); ROLLBACK;");
    await deny('rerun does not create duplicate foundation',settings({})+source,/CRM_FOUNDATION_EXISTING_INSTALL_REVIEW_REQUIRED/);
    return {assertions:cases.length,cases,productionChanged:false,realSupabaseAuthTested:false,
        exactCandidateTested:true,backfillPerformed:false,legacyPlotTriggerSource:'sync_plot_sales_status.sql (function only; no retroactive DML)',
        reviewedSharedColumns:130,reviewedSharedConstraints:10,fullProductionSchemaRehearsed:false,
        sharedSchemaLimits:['Auth/PostgREST remain synthetic','department child tables/view reproduce references only, not full schemas','platform extensions/event triggers/publications not replayed']};
}
