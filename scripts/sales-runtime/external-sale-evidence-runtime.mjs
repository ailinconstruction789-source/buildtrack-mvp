// Read-only history projection verification in the owning disposable fixture.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertPlainSql, syntheticDraftBody } from './safety.mjs';

export const externalSaleEvidenceDraftPath = 'sql/sales/external_sale_evidence_draft.sql';
export function externalSaleEvidenceTestBody(source) {
    assertPlainSql(source);
    const guard = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: external sale evidence requires isolated verification and operational integration';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(guard)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)) throw new Error('EXTERNAL_SALE_EVIDENCE_GUARD_CHANGED');
    return source.replace(guard, 'BEGIN;').replace(/\bROLLBACK;\s*$/, 'COMMIT;');
}

// Install only the exact private read helper and its deny-all ACL block, not
// the operational writer, public RPCs, schema columns or feature switches.
export function bookingEvidenceHelperTestBody(source) {
    syntheticDraftBody('sql/sales/18_booking_history_draft.sql', source);
    const helpers = [...source.matchAll(/CREATE (?:OR REPLACE )?FUNCTION sales_private\.crm_booking_imported_history\(p_sale jsonb\)[\s\S]*?END;\s*\$imported_acl\$;/g)];
    if (helpers.length !== 1 || (helpers[0][0].match(/CREATE (?:OR REPLACE )?FUNCTION/g) ?? []).length !== 1) throw new Error('BOOKING_EVIDENCE_HELPER_CHANGED');
    return `BEGIN;\n${helpers[0][0]}\nCOMMIT;`;
}

export async function runExternalSaleEvidenceRuntime({ query, root, report, dataSchemaInstalled = false }) {
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_user ~ '^runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
    const source = readFileSync(join(root, externalSaleEvidenceDraftPath), 'utf8');
    report.sources[externalSaleEvidenceDraftPath] = createHash('sha256').update(source).digest('hex');
    const cases = [];
    const check = async (label, sql) => { assert.equal(await query(sql), 't', label); cases.push(label); };
    const deny = async (label, sql, pattern = /EXTERNAL_SALE_EVIDENCE_REQUIRED/) => { await assert.rejects(query(sql), pattern); cases.push(label); };
    await deny('evidence draft cannot run directly', source, /DESIGN ONLY/);
    const dependencyBefore = await query('SELECT crm_external_private.cutover_dependency_image();');
    if (!dataSchemaInstalled) await query(externalSaleEvidenceTestBody(source));
    const bookingPath = 'sql/sales/18_booking_history_draft.sql';
    const bookingSource = readFileSync(join(root, bookingPath), 'utf8');
    report.sources[bookingPath] = createHash('sha256').update(bookingSource).digest('hex');
    await query(bookingEvidenceHelperTestBody(bookingSource));
    const reader = 'crm_external_private.sale_history(to_jsonb(s))';
    const imageSql = 'SELECT crm_external_private.cutover_sales_image();';
    const before = await query(imageSql);
    const rows = JSON.parse(await query(`BEGIN READ ONLY; SELECT jsonb_agg(${reader} ORDER BY id) FROM public.sales s; COMMIT;`));
    assert.equal(rows.length, 2);
    for (const row of rows) {
        assert.deepEqual(Object.keys(row).sort(), ['source', 'batchId', 'sourceRow', 'sourceStage', 'bookedDate', 'cancelledDate', 'transferredDate'].sort());
        assert.equal(row.source, 'customer_sheet');
        assert.ok(['booked', 'transferred', 'cancelled'].includes(row.sourceStage));
        assert.equal(typeof row.sourceRow, 'number');
    }
    cases.push('read-only evidence exposes exactly seven provenance and day-precision fields');
    const wrapped = JSON.parse(await query('BEGIN READ ONLY; SELECT jsonb_agg(sales_private.crm_booking_imported_history(to_jsonb(s)) ORDER BY id) FROM public.sales s; COMMIT;'));
    assert.deepEqual(wrapped, rows);
    cases.push('exact private SQL18 optional wrapper returns the same persisted evidence without public activation');
    await check('wrapper accepts native schema without external columns', "SELECT sales_private.crm_booking_imported_history('{\"id\":\"e0290000-0000-4000-8000-000000000099\"}') IS NULL;");
    await deny('wrapper rejects partial provenance', "SELECT sales_private.crm_booking_imported_history('{\"external_source_stage\":\"booked\"}');", /CRM_BOOKING_SETUP_REQUIRED/);
    await check('imported day is not turned into a timestamp', `SELECT bool_and(e->>'bookedDate' IN ('2026-08-01','2026-08-02'))
      FROM public.sales s CROSS JOIN LATERAL (SELECT ${reader} e) p;`);
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        await check(`default execute grants removed for ${role}`, `SELECT NOT has_function_privilege('${role}','crm_external_private.sale_history(jsonb)','EXECUTE');`);
        await deny(`direct evidence access denied for ${role}`, `BEGIN; SET LOCAL ROLE ${role}; SELECT crm_external_private.sale_history('{}'); ROLLBACK;`, /permission denied/);
        await check(`private optional wrapper grants removed for ${role}`, `SELECT NOT has_function_privilege('${role}','sales_private.crm_booking_imported_history(jsonb)','EXECUTE');`);
    }
    await deny('nonexistent sale rejected', "SELECT crm_external_private.sale_history('{\"id\":\"e0290000-0000-4000-8000-000000000099\"}');");
    for (const [key, value] of [['external_booking_id', null], ['external_source_stage', 'booked'], ['plot_id', 'wrong'], ['booking_round', 1], ['project_interest_id', null], ['booked_at', '2026-01-01']]) {
        await deny(`corrupt projected ${key} rejected`, `SELECT crm_external_private.sale_history(to_jsonb(s)||'${JSON.stringify({ [key]: value })}'::jsonb) FROM public.sales s;`);
    }
    await deny('rolled back cutover cannot supply operational evidence', `BEGIN;
      INSERT INTO crm_external_private.sales_rollback_receipts(batch_id,request,response)
        SELECT batch_id,'{}','{}' FROM crm_external_private.sales_cutover_receipts;
      SELECT ${reader} FROM public.sales s; ROLLBACK;`);
    assert.equal(await query(imageSql), before);
    assert.equal(await query('SELECT crm_external_private.cutover_dependency_image();'), dependencyBefore);
    cases.push('projection installation and reads leave sale data and rollback dependencies unchanged');
    return { assertions: cases.length, cases, syntheticOnly: true, productionChanged: false, activationReady: false };
}
