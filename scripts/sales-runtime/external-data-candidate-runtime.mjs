// Exact saved candidate rehearsal in a fresh synthetic-only native PostgreSQL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assembleExternalDataCandidate, externalDataCandidatePath, externalDataHeader, externalDataFooter, externalDataParts } from './external-data-candidate.mjs';
export async function runExternalDataCandidateRuntime({ query, root, report }) {
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_user ~ '^runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
    const paths = [externalDataHeader, ...externalDataParts, externalDataFooter];
    const texts = new Map(paths.map(p => [p, readFileSync(join(root, p), 'utf8')]));
    const candidate = readFileSync(join(root, externalDataCandidatePath), 'utf8').replaceAll('\r\n', '\n');
    assert.equal(candidate, assembleExternalDataCandidate(texts));
    for (const [p, s] of [...texts, [externalDataCandidatePath, candidate]]) report.sources[p] = createHash('sha256').update(s).digest('hex');
    const cases = ['saved migration equals assembled source hashes'];
    const check = async (label, sql) => { assert.equal(await query(sql), 't', label); cases.push(label); };
    const deny = async (label, sql, pattern) => { await assert.rejects(query(sql), pattern); cases.push(label); };
    const reviews = `SET buildtrack.external_data_release='sealed_external_data_rows_2_966_v1';
      SET buildtrack.external_data_project='kbthmdedilswdmmczfay';
      SET buildtrack.external_data_mode='schema_only_no_import';
      SET buildtrack.external_data_backup='SYNTHETIC backup review';
      SET buildtrack.external_data_review='SYNTHETIC local schema review';`;
    const image = `SELECT jsonb_build_object(
      'sales',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales t),
      'plots',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.plots t),
      'relations',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'acl',c.relacl,'owner',c.relowner,'rls',c.relrowsecurity) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace IN ('public'::regnamespace,'sales_private'::regnamespace)),
      'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY attrelid,attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace IN ('public'::regnamespace,'sales_private'::regnamespace)),
      'functions',(SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'sales_private'::regnamespace) AND p.prokind='f'),
      'triggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace IN ('public'::regnamespace,'sales_private'::regnamespace) AND NOT t.tgisinternal));`;
    const before = await query(image);
    await deny('candidate requires review attestations', candidate, /EXTERNAL_DATA_REVIEW_REQUIRED/);
    await deny('different target attestation rejected', reviews.replace('kbthmdedilswdmmczfay', 'another-project') + candidate, /EXTERNAL_DATA_REVIEW_REQUIRED/);
    await deny('backup attestation required', reviews.replace('SYNTHETIC backup review', '') + candidate, /EXTERNAL_DATA_REVIEW_REQUIRED/);
    await deny('client role cannot install schema', reviews + 'SET ROLE authenticated;' + candidate, /permission denied|EXTERNAL_DATA_OPERATOR_REQUIRED/);
    await deny('enabled CRM rejected before installation', reviews + candidate.replace('DO $external_data_review$', "INSERT INTO public.crm_settings(id,central_intake_enabled) VALUES(true,true);\nDO $external_data_review$"), /EXTERNAL_DATA_EMPTY_DISABLED_CRM_REQUIRED/);
    await deny('late failure rolls all schema changes back', reviews + candidate.replace('DO $external_data_after$', 'SELECT 1/0;\nDO $external_data_after$'), /division by zero/);
    assert.equal(await query(image), before); cases.push('late failure preserves exact legacy schema/data/function/trigger image');
    await check('late failure removes entire private schema', "SELECT to_regnamespace('crm_external_private') IS NULL;");
    await deny('shared data mutation fails postcheck atomically', reviews + candidate.replace('DO $external_data_after$', 'UPDATE public.plots SET has_customer=NOT coalesce(has_customer,false);\nDO $external_data_after$'), /EXTERNAL_DATA_SHARED_DATA_CHANGED/);
    await deny('unsealed inherited access fails postcheck', reviews + candidate.replace('DO $external_data_after$', 'GRANT SELECT ON crm_external_private.snapshot_batches TO authenticated;\nDO $external_data_after$'), /EXTERNAL_DATA_UNSEALED_OBJECT/);
    await deny('whole transaction timeout rolls installation back', reviews + candidate.replace("transaction_timeout='30s'", "transaction_timeout='200ms'").replace('DO $external_data_after$', 'SELECT pg_sleep(1);\nDO $external_data_after$'), /transaction timeout/);
    assert.equal(await query(image), before); cases.push('postcheck failures leave original image untouched');
    // Deliberately permissive defaults must not expose any new objects.
    await query('ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO service_role,synthetic_guard_delegate; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO service_role,synthetic_guard_delegate;');
    await query(reviews + candidate);
    cases.push('exact saved five-part candidate installs before any source data');
    await check('installation leaves CRM flags and source data empty', `SELECT NOT EXISTS(SELECT 1 FROM crm_external_private.snapshot_batches)
      AND NOT EXISTS(SELECT 1 FROM public.sales_customers) AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests)
      AND NOT EXISTS(SELECT 1 FROM public.crm_settings) AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_cutover_receipts);`);
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        await check(`all private grants sealed for ${role}`, `SELECT NOT has_schema_privilege('${role}','crm_external_private','USAGE')
          AND NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='crm_external_private'::regnamespace AND c.relkind IN ('r','v') AND has_table_privilege('${role}',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
          AND NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='crm_external_private'::regnamespace AND has_function_privilege('${role}',p.oid,'EXECUTE'));`);
    }
    const asClient = sql => `BEGIN; SET LOCAL ROLE authenticated; ${sql}; ROLLBACK;`;
    await check('pre-cutover legacy cancellation still releases plot', asClient("UPDATE public.sales SET contract_status='Cancelled'; SELECT NOT has_customer FROM public.plots WHERE id='A'"));
    await check('pre-cutover legacy transfer still updates original stock trigger', asClient("UPDATE public.sales SET contract_status='Transferred'; SELECT has_customer AND sale_status='transferred' FROM public.plots WHERE id='A'"));
    await check('pre-cutover legacy booking insert/delete still works', asClient("INSERT INTO public.sales(id,plot_id,contract_status) VALUES('e0280000-0000-4000-8000-000000000002','B','Reserved'); DELETE FROM public.sales WHERE plot_id='B'; SELECT NOT has_customer FROM public.plots WHERE id='B'"));
    await check('pre-cutover construction pause/resume still works', asClient("UPDATE public.plots SET sale_status='ready_for_sale' WHERE id='A'; UPDATE public.plots SET sale_status='active' WHERE id='A'; SELECT has_customer AND sale_status='active' FROM public.plots WHERE id='A'"));
    await check('pre-cutover legacy survey still editable', asClient('UPDATE public.customer_voices SET score_knowledge=4; SELECT score_knowledge=4 FROM public.customer_voices'));
    await deny('legacy direct grant cannot set new source columns', asClient("UPDATE public.sales SET external_source_stage='booked'"), /CRM_FOUNDATION_COLUMNS_SEALED/);
    await deny('legacy direct grant cannot set existing sealed CRM fields', asClient("UPDATE public.sales SET crm_stage='booked'"), /CRM_FOUNDATION_COLUMNS_SEALED/);
    await deny('installation cannot silently rerun', reviews + candidate, /EXTERNAL_DATA_FRESH_SEALED_FOUNDATION_REQUIRED/);
    return { assertions: cases.length, cases, syntheticOnly: true, productionChanged: false, importedCustomerRows: 0, activationReady: false };
}
