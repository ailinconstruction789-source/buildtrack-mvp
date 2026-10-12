import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { approvedRetirementRows, loadRentalSourceRetirementInputs, prepareRentalSourceRetirement,
  rentalSourceEvidence, bindRentalSourceRetirementInputs } from './prepare-rental-source-retirement.mjs';

const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const plan = JSON.parse(readFileSync('reports/canonical-customer-adapter-plan-2026-10-10.json'));
const snapshot = JSON.parse(readFileSync('reports/customer-replacement-live-reference-2026-10-10.json'));
const manifest = loadRentalSourceRetirementInputs();
const evidenceRows = manifest.records.map(r => ({ sourceRow: r.sourceRow, rowSha256: r.rowSha256,
  value: r.sourceRow === 958 ? 'เช่าซื้อ, ซื้อพร้อมผู้เช่า' : 'เช่าซื้อ' }));
const fixture = () => ({ plan: structuredClone(plan), snapshot: structuredClone(snapshot), evidenceRows: structuredClone(evidenceRows) });
const resealPlan = p => { const { adapterPlanDigest, ...body } = p; p.adapterPlanDigest = digest(body); };
const captures = () => manifest.records.map(r => {
  const b = r.binding;
  const customer = { id: b.customerId, merged_into_customer_id: null, external_snapshot_batch_id: r.sourceBatchId,
    external_customer_key: r.customerSourceKey, lifecycle_revision: r.referenceRevisions.customer };
  const interest = { id: b.interestId, customer_id: b.customerId, project_name: r.projectName,
    external_interest_key: r.interestSourceKey, lifecycle_revision: r.referenceRevisions.interest };
  const sale = { id: b.saleId, project_interest_id: b.interestId, plot_id: b.plotId, external_booking_id: b.saleId,
    booking_revision: r.referenceRevisions.sale, crm_stage: 'booked', lead_id: null, contract_status: 'Reserved',
    cancelled_at: null, contracted_at: null, transferred_at: null, crm_handover_at: null };
  const plot = { id: b.plotId, project_name: r.projectName, has_customer: true };
  const inventory = r.referenceInventory.map(a => a.id === sale.id ? structuredClone(sale)
    : { ...sale, id: a.id, project_interest_id: a.interestId, external_booking_id: a.id,
      crm_stage: 'cancelled', contract_status: 'Cancelled', cancelled_at: '2025-01-01T00:00:00Z' });
  return { sourceRow: r.sourceRow, columns: Object.fromEntries(Object.entries({ customer, interest, sale, plot }).map(([k, v]) => [k, Object.keys(v)])),
    before: { customer, interest, sale, plot, inventory,
      dependencies: { constraints: [{ table: 'public.fixture_dependency', constraint: 'fixture_fk', rows: [] }], unconstrained: [] },
      source: { preparedBooking: { id: sale.id }, bookingHistory: { id: sale.id },
        sourceRecord: { source_row: r.sourceRow }, cutoverReceiptDigest: 'a'.repeat(64), writerRelease: { released: true } } } };
});
const bind = c => bindRentalSourceRetirementInputs({ manifest, captures: c });

test('full current workbook and approved plan produce only six source-bound retirement candidates', () => {
  assert.deepEqual(manifest.approvedSourceRows, approvedRetirementRows);
  assert.deepEqual(manifest.records.map(r => r.sourceRow), approvedRetirementRows);
  assert.deepEqual(manifest.skippedRowsWithoutSale, [961, 969]);
  assert.equal(manifest.sourceSha256, plan.sourceSha256);
  assert.equal(manifest.adapterPlanDigest, plan.adapterPlanDigest);
  assert.equal(manifest.businessWritesAllowed, false);
  assert(manifest.records.every(r => !r.executable && r.freshBeforeImage === null));
});
test('source rental evidence keeps unknown A/B/C and flags the purchase-with-tenant row for review', () => {
  assert.deepEqual(manifest.records.filter(r => r.sourceRentalEvidence.purchaseWithTenant).map(r => r.sourceRow), [958]);
  assert(manifest.records.every(r => r.sourceProgram === null && r.sourceRentalEvidence.column === 'I'));
  assert.equal(manifest.records[0].sourceRentalEvidence.valueHash.length, 64);
  assert.throws(() => rentalSourceEvidence('เช่าซื้อ A'), /EXPLICIT_RENTAL_SOURCE/);
});
test('manifest preserves visit/booking day evidence without inventing business cancellation', () => {
  assert(manifest.records.every(r => r.cancellationDate === null && r.operation === 'administrative_retirement'
    && r.history.every(h => ['visited', 'booked'].includes(h.kind))));
  assert.equal(manifest.records[0].history[0].date, '2026-06-27');
  assert.equal(manifest.records[0].history[1].date, '2026-07-01');
});
test('saved redacted shape contains no customer names, phone, full before-images or import permission', () => {
  assert.equal(manifest.rawPersonalDataIncluded, false);
  assert(manifest.records.every(r => !('customerName' in r) && !('phone' in r) && !('before' in r)));
  assert.equal(manifest.policy.rawDeleteAllowed, false);
});
test('candidate includes exactly supplied whole snapshots and is detached from caller mutation', () => {
  const c = captures(), p = bind(c);
  assert.equal(p.version, 'reviewed-rental-source-retirement-v1');
  assert.equal(p.records.length, 6);
  assert.deepEqual(p.records[0].before, c[0].before);
  c[0].before.plot.has_customer = false;
  assert.equal(p.records[0].before.plot.has_customer, true);
  assert(!('cancelledDate' in p.records[0]));
});
test('order-independent JSON key order preserves complete inventory comparison', () => {
  const c = captures();
  const sale = c[0].before.inventory.find(s => s.id === c[0].before.sale.id);
  c[0].before.inventory[c[0].before.inventory.indexOf(sale)] = Object.fromEntries(Object.entries(sale).reverse());
  assert.equal(bind(c).records.length, 6);
});
test('SQL21 civil date columns may be absent before installation or explicitly null after installation', () => {
  const c = captures();
  for (const capture of c) {
    capture.columns.sale.push('crm_transfer_date', 'crm_handover_date');
    for (const sale of [capture.before.sale, ...capture.before.inventory]) {
      sale.crm_transfer_date = null; sale.crm_handover_date = null;
    }
  }
  assert.equal(bind(c).records.length, 6);
});
for (const field of ['crm_transfer_date', 'crm_handover_date'])
  test('known SQL21 ' + field + ' blocks administrative rental retirement', () => {
    const c = captures();
    c[0].columns.sale.push(field);
    c[0].before.sale[field] = '2026-10-10';
    for (const sale of c[0].before.inventory) sale[field] = sale.id === c[0].before.sale.id ? '2026-10-10' : null;
    assert.throws(() => bind(c), /UNADVANCED_RENTAL/);
  });

for (const [label, mutate, pattern] of [
  ['missing capture', c => c.pop(), /COMPLETE_SIX_BEFORE/],
  ['duplicate capture', c => { c[1] = structuredClone(c[0]); }, /COMPLETE_SIX_BEFORE/],
  ['missing source image', c => { delete c[0].before.source; }, /FULL_BEFORE_IMAGES/],
  ['redacted customer treated as full', c => { c[0].before.customer = { id: c[0].before.customer.id }; }, /FULL_COLUMN_CAPTURE/],
  ['missing column catalog', c => { delete c[0].columns; }, /FULL_BEFORE_IMAGES/],
  ['duplicate catalog column', c => c[0].columns.sale.push('id'), /FULL_COLUMN_CAPTURE/],
  ['merged customer', c => { c[0].before.customer.merged_into_customer_id = c[1].before.customer.id; }, /BINDING_CHANGED/],
  ['wrong interest customer', c => { c[0].before.interest.customer_id = c[1].before.customer.id; }, /BINDING_CHANGED/],
  ['wrong source customer key', c => { c[0].before.customer.external_customer_key = 'changed'; }, /PROVENANCE_CHANGED/],
  ['changed booking revision', c => { c[0].before.sale.booking_revision = 'changed'; }, /PROVENANCE_CHANGED/],
  ['contract stage advanced', c => { c[0].before.sale.crm_stage = 'contracted'; }, /UNADVANCED_RENTAL/],
  ['actual transfer timestamp', c => { c[0].before.sale.transferred_at = '2026-10-10T00:00:00Z'; }, /UNADVANCED_RENTAL/],
  ['missing whole plot inventory', c => { c[0].before.inventory = []; }, /SORTED_PLOT_INVENTORY/],
  ['different inventory snapshot', c => { c[0].before.inventory.find(s => s.id === c[0].before.sale.id).contract_status = 'Changed'; }, /SORTED_PLOT_INVENTORY/],
  ['inventory order changed', c => c[1].before.inventory.reverse(), /SORTED_PLOT_INVENTORY/],
  ['nonempty foreign key dependency', c => c[0].before.dependencies.constraints[0].rows.push({ id: 'dependent' }), /DEPENDENCIES_REQUIRE/],
  ['missing unconstrained scan', c => { delete c[0].before.dependencies.unconstrained; }, /DEPENDENCY_CAPTURE/],
  ['nonempty unconstrained dependency', c => c[0].before.dependencies.unconstrained.push({ table: 'public.fixture', column: 'sale_id', rows: [{ id: 'dependent' }] }), /DEPENDENCIES_REQUIRE/],
  ['missing booking history source', c => { delete c[0].before.source.bookingHistory; }, /COMPLETE_SOURCE_BEFORE/],
  ['empty writer release', c => { c[0].before.source.writerRelease = {}; }, /COMPLETE_SOURCE_BEFORE/],
]) test(label + ' is rejected before any SQL', () => {
  const c = captures(); mutate(c); assert.throws(() => bind(c), pattern);
});

for (const [label, mutate, pattern] of [
  ['tampered plan digest', f => { f.plan.rows[0].sourceRow = 2000; }, /SEALED_APPROVED/],
  ['source row hash drift', f => { f.evidenceRows[0].rowSha256 = 'changed'; }, /SOURCE_ROW_CHANGED/],
  ['one evidence row absent', f => f.evidenceRows.pop(), /COMPLETE_SOURCE_EVIDENCE/],
  ['another active sale on plot', f => { const s = f.snapshot.sales.find(s => s.id === manifest.records[0].referenceInventory.find(s => s.stage === 'cancelled').id); s.stage = 'transferred'; }, /OTHER_ACTIVE_SALE/],
  ['rental data reappeared', f => { f.snapshot.counts.rentalPayments = 1; }, /RENTAL_DATA_REAPPEARED/],
  ['new cancellation source history', f => { f.plan.rows.find(r => r.sourceRow === 859).history.push({ kind: 'cancelled', date: null, precision: 'unknown' }); resealPlan(f.plan); }, /NO_CANCELLATION_INVENTION/],
  ['missing live sale', f => { f.snapshot.sales = f.snapshot.sales.filter(s => s.id !== manifest.records[0].binding.saleId); }, /COMPLETE_REFERENCE/],
]) test(label + ' blocks manifest preparation', () => {
  const f = fixture(); mutate(f); assert.throws(() => prepareRentalSourceRetirement(f), pattern);
});
test('altered sealed manifest cannot bind a before-image payload', () => {
  const m = structuredClone(manifest); m.records[0].sourceRentalEvidence.purchaseWithTenant = true;
  assert.throws(() => bindRentalSourceRetirementInputs({ manifest: m, captures: captures() }), /SEALED_RETIREMENT/);
});
