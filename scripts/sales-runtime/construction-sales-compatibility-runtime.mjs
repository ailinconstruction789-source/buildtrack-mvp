// Exact reviewed trigger-chain regression in the owned synthetic runtime only.
// No connection, credentials, environment files or real customer records.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlainSql } from './safety.mjs';

export const constructionChainFixturePath = 'sql/sales/runtime/fixtures/construction-live-chain.sql';
export const constructionTransferMigrationPath = 'supabase/migrations/20260929092748_construction_completion_sales_transfer_only.sql';
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const house = 'c0290000-0000-4000-8000-000000000001';
const first = 'c0290000-0000-4000-8000-000000000011';
const second = 'c0290000-0000-4000-8000-000000000012';
const settings = "SET buildtrack.construction_sales_project='kbthmdedilswdmmczfay'; SET buildtrack.construction_sales_review='user_approved_sales_only_transfer_20260929';";
async function assertRuntime(query) {
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_user ~ '^runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
}
function load(root, report, path) {
    const source = readFileSync(join(root, path), 'utf8');
    assertPlainSql(source);
    report.sources[path] = createHash('sha256').update(source).digest('hex');
    return source;
}
export async function prepareConstructionSalesCompatibilityRuntime({ query, root, report }) {
    await assertRuntime(query);
    await query(load(root, report, constructionChainFixturePath));
}

export async function runConstructionSalesCompatibilityRuntime({ query, root, report, migrationPath = constructionTransferMigrationPath }) {
    await assertRuntime(query);
    const cases = [];
    const check = async (label, sql) => { assert.equal(await query(sql), 't', label); cases.push(label); };
    const deny = async (label, sql, pattern) => { await assert.rejects(query(sql), pattern); cases.push(label); };
    await check('writer is genuinely enabled and chosen synthetic booking is active', `SELECT
      EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
      AND EXISTS(SELECT 1 FROM public.sales WHERE plot_id='A-53' AND crm_stage='booked')
      AND EXISTS(SELECT 1 FROM public.plots WHERE id='A-53' AND has_customer AND sale_status='active');`);
    const selected = ['A-53', 'vacant', 'incomplete', 'transferred', 'transferred-vacant', 'bulk-one', 'bulk-two']
        .map(value => value === 'A-53' ? value : `SYNTHETIC-CONSTRUCTION-${value}`);
    const plotList = selected.map(literal).join(',');
    await query(`UPDATE public.plots SET house_type_id='${house}' WHERE id='A-53';
      INSERT INTO public.task_updates(plot_id,task_template_id,user_name,role,action,progress,created_at)
      SELECT p.id,t.id,'SYNTHETIC foreman','Foreman','progress',99,'2026-09-29T00:00:00Z'::timestamptz
      FROM public.plots p CROSS JOIN public.task_templates t
      WHERE p.id IN (${plotList}) AND t.id IN ('${first}','${second}');
      INSERT INTO public.defects(plot_id,task_id,progress)
      SELECT id,'${first}',99 FROM public.plots WHERE id IN (${plotList});
      INSERT INTO public.defects(plot_id,task_template_id,progress)
      SELECT id,'${second}',99 FROM public.plots WHERE id IN (${plotList});`);
    const complete = (plot, task = null) => `UPDATE public.task_updates SET progress=100,action='SYNTHETIC complete'
      WHERE plot_id=${literal(plot)}${task ? ` AND task_template_id='${task}'` : ''};`;
    await query(complete('A-53', first));
    await check('one of two counted tasks does not change sales status', "SELECT has_customer AND sale_status='active' FROM public.plots WHERE id='A-53';");
    await deny('old live function rolls final construction update back under writer guard', complete('A-53', second), /EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED/);
    await check('failed old update leaves task assignment and defect at prior progress', `SELECT
      (SELECT progress=99 FROM public.task_updates WHERE plot_id='A-53' AND task_template_id='${second}')
      AND (SELECT current_progress=99 AND actual_end_date IS NULL FROM public.plot_task_assignments WHERE plot_id='A-53' AND task_template_id='${second}')
      AND (SELECT progress=99 FROM public.defects WHERE plot_id='A-53' AND task_template_id='${second}');`);
    const migration = load(root, report, migrationPath);
    const stateSql = `SELECT jsonb_build_object('plots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),
      'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),
      'tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.task_updates t),
      'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.plot_task_assignments a),
      'defects',(SELECT jsonb_agg(to_jsonb(d) ORDER BY plot_id,task_id,task_template_id) FROM public.defects d));`;
    const before = await query(stateSql);
    const functionSql = "SELECT replace(pg_get_functiondef('public.auto_update_plot_sale_status()'::regprocedure),E'\\r\\n',E'\\n');";
    const beforeFunction = await query(functionSql);
    await deny('migration requires explicit reviewed change', migration, /CONSTRUCTION_SALES_REVIEW_REQUIRED/);
    await deny('migration refuses changed live function', settings + migration.replace('DO $construction_sales_boundary$',
        "ALTER FUNCTION public.auto_update_plot_sale_status() SET search_path=public; DO $construction_sales_boundary$"), /CONSTRUCTION_SALES_LIVE_DEFINITION_CHANGED/);
    await deny('migration late failure restores original function', settings + migration.replace(/COMMIT;\s*$/,
        "DO $late$ BEGIN RAISE EXCEPTION 'SYNTHETIC_CONSTRUCTION_LATE_FAILURE'; END; $late$; COMMIT;"), /SYNTHETIC_CONSTRUCTION_LATE_FAILURE/);
    assert.equal(await query(functionSql), beforeFunction);
    cases.push('failed repairs preserve original function exactly');
    await query(settings + migration);
    assert.equal(await query(stateSql), before);
    cases.push('exact migration changes no existing plot sale task assignment or defect data');
    await deny('migration refuses accidental reapplication', settings + migration, /CONSTRUCTION_SALES_LIVE_DEFINITION_CHANGED/);
    await query(complete('A-53', second));
    await check('booked construction completes without transfer and defects sync', `SELECT
      (SELECT has_customer AND sale_status='active' FROM public.plots WHERE id='A-53')
      AND EXISTS(SELECT 1 FROM public.sales WHERE plot_id='A-53' AND crm_stage='booked')
      AND (SELECT bool_and(current_progress=100 AND actual_end_date IS NOT NULL AND actual_start_date IS NOT NULL AND latest_action='SYNTHETIC complete') FROM public.plot_task_assignments WHERE plot_id='A-53')
      AND (SELECT bool_and(progress=100) FROM public.defects WHERE plot_id='A-53');`);
    for (const suffix of ['vacant', 'transferred', 'transferred-vacant']) {
        const plot = `SYNTHETIC-CONSTRUCTION-${suffix}`;
        await query(complete(plot));
        await check(`${suffix} completion preserves correct sales state`, `SELECT sale_status='${suffix === 'vacant' ? 'ready_for_sale' : 'transferred'}'
          AND has_customer=${suffix === 'transferred' ? 'true' : 'false'} FROM public.plots WHERE id='${plot}';`);
    }
    await query(complete('SYNTHETIC-CONSTRUCTION-incomplete', first));
    await check('incomplete construction remains active', "SELECT sale_status='active' AND NOT has_customer FROM public.plots WHERE id='SYNTHETIC-CONSTRUCTION-incomplete';");
    await query("UPDATE public.task_updates SET progress=100 WHERE plot_id IN ('SYNTHETIC-CONSTRUCTION-bulk-one','SYNTHETIC-CONSTRUCTION-bulk-two');");
    await check('bulk construction completion succeeds per plot', "SELECT count(*)=2 AND bool_and(sale_status='ready_for_sale' AND NOT has_customer) FROM public.plots WHERE id IN ('SYNTHETIC-CONSTRUCTION-bulk-one','SYNTHETIC-CONSTRUCTION-bulk-two');");
    await check('non-counted task remains unnecessary and nullable flag still counts', `SELECT
      NOT EXISTS(SELECT 1 FROM public.plot_task_assignments WHERE task_template_id='c0290000-0000-4000-8000-000000000013')
      AND (SELECT count(*)=2 FROM public.plot_task_assignments WHERE plot_id='SYNTHETIC-CONSTRUCTION-vacant' AND actual_end_date IS NOT NULL);`);
    await deny('manual transfer remains forbidden after construction repair', "UPDATE public.plots SET sale_status='transferred' WHERE id='A-53';", /EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED/);
    await deny('manual booking occupancy change remains forbidden', "UPDATE public.plots SET has_customer=false WHERE id='A-53';", /EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED/);
    const repairedDefinitionMd5 = await query("SELECT md5(replace(pg_get_functiondef('public.auto_update_plot_sale_status()'::regprocedure),E'\\r\\n',E'\\n')); ");
    return { assertions: cases.length, cases, syntheticOnly: true, productionChanged: false,
        repairedDefinitionMd5,
        exactLiveChainTested: true, oldFailureReproduced: true, salesOnlyTransferBoundaryTested: true,
        realSupabasePoliciesTested: false, activationReady: false };
}
