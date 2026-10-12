import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customerSheetHeaders } from '../sales-runtime/sheet-import-review.mjs';
import { prepareWorkbookPlan, planWorkbookFile } from './plan-workbook.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const id = '11111111-1111-4111-8111-111111111111';
const catalog = () => ({ version: 'customer-import-catalog-v1', projectRef: 'kbthmdedilswdmmczfay',
  generatedAt: '2026-10-10T03:00:00Z', projects: [{ name: 'ไอลิน 3' }],
  plots: [{ id: 'SYNTHETIC-PLOT', projectName: 'ไอลิน 3', plotName: '1' }],
  canonicalRoles: [{ userId: id, displayName: 'PRIVATE OWNER', role: 'sales', isActive: true }] });
const extraction = () => ({ version: 'customer-sheet-extract-v1', sheet: 'ข้อมูลลูกค้า',
  sha256: 'a'.repeat(64), snapshotDate: '2026-10-10', phonePolicy: 'unknown_confirmed',
  headers: [...customerSheetHeaders], maxRow: 2, rows: [{ rowNumber: 2, hidden: false, formulaColumns: [6, 14],
    values: ['2026-09-01', '2026-09-02', 'PRIVATE CUSTOMER', 'PRIVATE JOB', 'AL3', '1', null,
      'โอนเเล้ว', 'PRIVATE BANK', null, null, 'PRIVATE OWNER', null, null, null, null, null] }] });

test('keeps every proposal unapproved, no customer/Lead creation, no fabricated price/day', () => {
  const input = extraction(), copy = structuredClone(input), p = prepareWorkbookPlan(input, '2026-10-10', catalog());
  assert.deepEqual(input, copy);
  assert.equal(p.rows[0].salePrice, null);
  assert.deepEqual(p.rows[0].sourceEvents.at(-1), { kind: 'transferred', date: null, precision: 'unknown' });
  assert.equal(p.rows[0].customerId, null);
  assert.equal(p.rows[0].leadRequired, false);
  assert.equal(p.rows[0].canonicalWritesAllowed, false);
  assert.deepEqual(p.rows[0].candidatePlotIds, ['SYNTHETIC-PLOT']);
  assert.deepEqual(p.ownerProposals[0].candidateUserIds, [id]);
  assert.equal(p.ownerProposals[0].confirmed, false);
  assert.equal(p.projectProposals[0].matchKind, 'unapproved_alias_candidate');
  assert.equal(p.counts.canonicalImportRows, 0);
  assert.doesNotMatch(JSON.stringify(p.rows), /PRIVATE CUSTOMER|PRIVATE BANK|PRIVATE JOB/);
});
test('same names remain separate source rows and require explicit identity decisions', () => {
  const input = extraction(); input.rows.push({ ...structuredClone(input.rows[0]), rowNumber: 3 }); input.maxRow = 3;
  const p = prepareWorkbookPlan(input, '2026-10-10', catalog());
  assert.equal(p.rows.length, 2);
  assert.notEqual(p.rows[0].sourceKey, p.rows[1].sourceKey);
  assert.deepEqual(p.identityGroups[0], { group: 'N001', rows: [2, 3], decision: null, customerId: null });
  assert.ok(p.rows.every(r => r.holds.includes('CUSTOMER_IDENTITY_DECISION_REQUIRED')));
});
test('does not treat inactive/Owner accounts or fuzzy names as Sales bindings', () => {
  const c = catalog(); c.canonicalRoles[0].isActive = false;
  assert.deepEqual(prepareWorkbookPlan(extraction(), '2026-10-10', c).ownerProposals[0].candidateUserIds, []);
  c.canonicalRoles[0].isActive = true; c.canonicalRoles[0].role = 'owner';
  assert.deepEqual(prepareWorkbookPlan(extraction(), '2026-10-10', c).ownerProposals[0].candidateUserIds, []);
  c.canonicalRoles[0].role = 'sales'; c.canonicalRoles[0].displayName = 'PRIVATE OWNER EXTRA';
  assert.deepEqual(prepareWorkbookPlan(extraction(), '2026-10-10', c).ownerProposals[0].candidateUserIds, []);
});
test('holds absent/ambiguous plot labels and retains cancelled history without active occupancy', () => {
  const e = extraction(); e.rows[0].values[7] = 'ยกเลิกจอง'; e.rows[0].values[9] = '2026-09-05';
  const c = catalog(); c.plots.push({ ...c.plots[0], id: 'SYNTHETIC-OTHER' });
  const p = prepareWorkbookPlan(e, '2026-10-10', c);
  assert.equal(p.rows[0].sourceStage, 'cancelled');
  assert.ok(p.rows[0].holds.includes('PLOT_BINDING_REVIEW'));
  assert.equal(p.rows[0].sourceEvents.at(-1).kind, 'cancelled');
  assert.equal(p.rows[0].sourceEvents.at(-1).date, '2026-09-05');
  e.rows[0].values[5] = '01';
  assert.deepEqual(prepareWorkbookPlan(e, '2026-10-10', c).rows[0].candidatePlotIds, []);
});
test('rejects invalid catalog IDs, foreign plot projects and duplicate identities', () => {
  const c = catalog(); c.canonicalRoles[0].userId = 'not-uuid';
  assert.throws(() => prepareWorkbookPlan(extraction(), '2026-10-10', c), /REFERENCE_CATALOG_INVALID/);
  const other = catalog(); other.plots[0].projectName = 'wrong';
  assert.throws(() => prepareWorkbookPlan(extraction(), '2026-10-10', other), /REFERENCE_CATALOG_INVALID/);
  const dupe = catalog(); dupe.canonicalRoles.push({ ...dupe.canonicalRoles[0] });
  assert.throws(() => prepareWorkbookPlan(extraction(), '2026-10-10', dupe), /REFERENCE_CATALOG_INVALID/);
});
test('fingerprints source, catalog, layout and history changes and is deterministic', () => {
  const e = extraction(), c = catalog(), p = prepareWorkbookPlan(e, '2026-10-10', c);
  assert.equal(prepareWorkbookPlan(e, '2026-10-10', c).planDigest, p.planDigest);
  e.rows[0].values[10] = '2026-09-10';
  assert.notEqual(prepareWorkbookPlan(e, '2026-10-10', c).planDigest, p.planDigest);
  const other = catalog(); other.canonicalRoles[0].isActive = false;
  assert.notEqual(prepareWorkbookPlan(extraction(), '2026-10-10', other).planDigest, p.planDigest);
});
test('pins source/catalog and refuses overwrite or changed inputs during preparation', t => {
  const directory = mkdtempSync(join(root, 'reports', '.plan-workbook-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'source.xlsx'), reference = join(directory, 'catalog.json'), output = join(directory, 'plan.json');
  writeFileSync(source, 'synthetic opaque workbook'); writeFileSync(reference, JSON.stringify(catalog()));
  const sha256 = createHash('sha256').update(readFileSync(source)).digest('hex');
  const options = { source, catalog: reference, output, python: 'unit-only', sha256, inspectionDate: '2026-10-10' };
  const extract = () => ({ ...extraction(), sha256 });
  assert.throws(() => planWorkbookFile(options, () => {
    writeFileSync(reference, JSON.stringify({ ...catalog(), generatedAt: '2026-10-10T03:01:00Z' })); return extract();
  }), /PLAN_INPUT_CHANGED/);
  assert.equal(existsSync(output), false);
  const plan = planWorkbookFile(options, extract);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).planDigest, plan.planDigest);
  assert.throws(() => planWorkbookFile(options, extract), /OUTPUT_ALREADY_EXISTS/);
});
