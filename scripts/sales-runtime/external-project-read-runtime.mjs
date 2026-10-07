import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';
export const externalProjectReadDraftPath = 'sql/sales/external_project_sales_read_draft.sql';
export function externalProjectReadTestBody(source) {
    assertPlainSql(source);
    const guard = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: prepared project sales reader requires isolated verification';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(guard)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)) throw new Error('EXTERNAL_PROJECT_READ_GUARD_CHANGED');
    return source.replace(guard, 'BEGIN;').replace(/\bROLLBACK;\s*$/, 'COMMIT;');
}
export async function runExternalProjectReadRuntime({ query, root, report, parsePrepared, parseOperational }) {
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_user ~ '^runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
    const source = readFileSync(join(root, externalProjectReadDraftPath), 'utf8');
    report.sources[externalProjectReadDraftPath] = createHash('sha256').update(source).digest('hex');
    const cases = [];
    const check = async (label, sql) => { assert.equal(await query(sql), 't', label); cases.push(label); };
    const deny = async (label, sql, pattern) => { await assert.rejects(query(sql), pattern); cases.push(label); };
    // plot_name already exists in the reviewed legacy fixture.
    await deny('draft remains inert', source, /DESIGN ONLY: prepared project sales reader/);
    await query(externalProjectReadTestBody(source));
    const literal = value => value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;
    const call = (project = 'PROJECT K', tab = 'all', search = '', page = 0) =>
        `SELECT crm_external_private.read_prepared_project_sales(id,${literal(project)},${literal(tab)},${literal(search)},${page}) FROM crm_external_private.snapshot_batches;`;
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        await deny(`reader not exposed to ${role}`, `BEGIN; SET LOCAL ROLE ${role}; ${call()} ROLLBACK;`, /permission denied/);
    }
    const baselineSql = `SELECT jsonb_build_object(
      'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),
      'plots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),
      'receipts',(SELECT jsonb_agg(to_jsonb(r)) FROM crm_external_private.booking_release_receipts r),
      'prepared',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM crm_external_private.prepared_booking_sales p));`;
    const before = await query(baselineSql);
    const snapshots = [];
    for (const args of [[null, 'booked', '', 0], ['PROJECT K', 'all', '', 0], ['PROJECT K', 'transferred', '', 0],
        ['PROJECT K', 'cancelled', '', 0], ['PROJECT K', 'booked', '', 0], ['PROJECT A', 'cancelled', '', 0],
        ['PROJECT K', 'all', 'SYNTHETIC SAME', 0], ['PROJECT K', 'all', '%_', 0], ['PROJECT K', 'all', '', 1]]) {
        const raw = JSON.parse(await query(call(...args)));
        const scope = { projectName: args[0], tab: args[1], query: args[2], page: args[3] };
        const parsed = parsePrepared(raw, scope);
        assert.deepEqual(parsed, raw);
        assert.throws(() => parseOperational(raw, scope));
        snapshots.push(raw);
    }
    cases.push('native reader matches prepared parser and is rejected by operational parser in nine scopes');
    assert.equal(snapshots[0].rows.length, 0);
    assert.equal(snapshots[1].rows.length, 2); // One transferred and one held cancellation, no old Reserved sale.
    assert.equal(snapshots[2].rows.length, 1);
    assert.equal(snapshots[3].rows.length, 1);
    assert.equal(snapshots[3].rows[0].historyEvidence.held, true);
    assert.equal(snapshots[4].rows.length, 0);
    assert.equal(snapshots[5].rows.length, 1);
    assert.equal(snapshots[6].rows.length, 1);
    assert.equal(snapshots[7].rows.length, 0);
    assert.equal(snapshots[8].rows.length, 0);
    cases.push('discovery tab filters literal search and page scope are correct');
    assert.ok(snapshots.every(s => s.prepared.pendingUnlinkedHistories === 1));
    cases.push('held known-plot booking remains in pending total without blocking projects');
    assert.ok(snapshots[1].rows.every(r => r.bookingRound === null && r.bookedAt === null && r.previousSaleId === null));
    assert.equal(snapshots[2].rows[0].historyEvidence.transferredDate, '2026-09-01');
    cases.push('unknown round and day precision preserved without invented timestamp');
    await check('old and new sale IDs are not combined', `SELECT NOT EXISTS(SELECT 1 FROM public.sales s
      JOIN crm_external_private.prepared_booking_sales p ON p.id=s.id);`);
    await deny('invalid tab refused', call('PROJECT K', 'lost'), /INVALID_INPUT/);
    await deny('single Unicode codepoint refused', call('PROJECT K', 'all', '😀'), /INVALID_INPUT/);
    await deny('negative page refused', call('PROJECT K', 'all', '', -1), /INVALID_INPUT/);
    await deny('unknown project refused', call('NOT REGISTERED'), /NOT_FOUND/);
    await deny('discovery cannot conceal search', call(null, 'all', 'search'), /INVALID_INPUT/);
    await deny('banned reviewer refused', `BEGIN; UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='a0250000-0000-4000-8000-000000000001'; ${call()} ROLLBACK;`, /REVIEWED_ADMIN_REQUIRED/);
    await deny('owner history cannot be deleted to conceal rows', `BEGIN; DELETE FROM sales_private.crm_user_roles WHERE user_id='a0290000-0000-4000-8000-000000000201'; ${call()} ROLLBACK;`, /CRM_ROLE_HISTORY_PRESERVED/);
    await deny('plot moved to another project blocks reads before filtering', `BEGIN; UPDATE public.plots SET project_name='PROJECT A' WHERE id='K-9'; ${call('PROJECT A', 'booked')} ROLLBACK;`, /INTEGRITY_REQUIRED/);
    assert.equal(await query(baselineSql), before); cases.push('reads do not write public data prepared records or receipts');
    return { assertions: cases.length, cases, syntheticOnly: true, projectionParity: true,
        productionChanged: false, publicReaderActivated: false, publicSalesCutoverTested: false };
}
