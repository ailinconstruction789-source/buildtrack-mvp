// Offline source-bound preparation only. Full business before-images remain in memory.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRemainingSourceInputs } from './prepare-remaining-canonical-inputs.mjs';
import { extractWorkbook, workspacePath } from './review-workbook.mjs';

const hash = v => createHash('sha256').update(v).digest('hex');
const digest = v => hash(JSON.stringify(v));
const check = (ok, code) => { if (!ok) throw new Error(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v, keys) => object(v) && same(Object.keys(v).sort(), [...keys].sort());
const canonical = v => Array.isArray(v) ? v.map(canonical) : object(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export const approvedRetirementRows = Object.freeze([859, 951, 954, 958, 959, 960]);
const skippedRows = [859, 951, 954, 958, 959, 960, 961, 969];
const index = (rows, code) => {
  check(Array.isArray(rows) && rows.every(r => typeof r.id === 'string')
    && new Set(rows.map(r => r.id)).size === rows.length, code);
  return new Map(rows.map(r => [r.id, r]));
};

// Only the two observed, reviewed source forms are accepted. Neither supplies A/B/C.
export function rentalSourceEvidence(value) {
  check(typeof value === 'string' && ['เช่าซื้อ', 'เช่าซื้อ, ซื้อพร้อมผู้เช่า'].includes(value), 'EXPLICIT_RENTAL_SOURCE_REQUIRED');
  return { column: 'I', valueHash: hash(value), classification: 'rent_to_own',
    purchaseWithTenant: value === 'เช่าซื้อ, ซื้อพร้อมผู้เช่า' };
}

export function prepareRentalSourceRetirement({ plan, snapshot, evidenceRows }) {
  const { adapterPlanDigest, ...body } = plan;
  check(digest(body) === adapterPlanDigest && plan.businessWritesAllowed === false
    && plan.canonicalImportReady === false && plan.rows.length === 979, 'SEALED_APPROVED_PLAN_REQUIRED');
  check(snapshot.projectId === 'kbthmdedilswdmmczfay' && Number.isFinite(Date.parse(snapshot.capturedAt)), 'DATED_TARGET_CAPTURE_REQUIRED');
  const customers = index(snapshot.customers, 'CUSTOMER_CAPTURE_REQUIRED');
  const interests = index(snapshot.interests, 'INTEREST_CAPTURE_REQUIRED');
  const sales = index(snapshot.sales, 'SALE_CAPTURE_REQUIRED');
  const plots = index(snapshot.plots, 'PLOT_CAPTURE_REQUIRED');
  for (const [key, rows] of Object.entries({ customers, interests, sales, plots }))
    check(snapshot.counts[key] === rows.size, 'COMPLETE_REFERENCE_CAPTURE_REQUIRED');
  check(snapshot.counts.rentalContracts === 0 && snapshot.counts.rentalPayments === 0, 'RENTAL_DATA_REAPPEARED');
  const rentals = plan.rows.filter(r => r.route === 'skip_rental');
  check(same(rentals.map(r => r.sourceRow), skippedRows)
    && same(rentals.filter(r => r.saleId !== null).map(r => r.sourceRow), approvedRetirementRows), 'EXACT_SIX_RENTAL_SALES_REQUIRED');
  check(Array.isArray(evidenceRows) && evidenceRows.length === 6
    && new Set(evidenceRows.map(r => r.sourceRow)).size === 6, 'COMPLETE_SOURCE_EVIDENCE_REQUIRED');
  const evidence = new Map(evidenceRows.map(r => [r.sourceRow, r]));
  const records = rentals.filter(r => r.saleId).map(r => {
    const c = customers.get(r.customerId), i = interests.get(r.interestId), s = sales.get(r.saleId), p = plots.get(r.plotId);
    const e = evidence.get(r.sourceRow);
    check(e?.rowSha256 === r.rowSha256, 'SOURCE_ROW_CHANGED');
    check(c && !c.mergedIntoId && i?.customerId === c.id && i.projectName === r.projectName
      && s?.interestId === i.id && s.plotId === r.plotId && p?.projectName === r.projectName, 'EXACT_RENTAL_BINDING_REQUIRED');
    check(s.stage === 'booked' && s.leadId === null && s.sourceBookingId === s.id, 'UNADVANCED_IMPORTED_RENTAL_SALE_REQUIRED');
    const inventory = snapshot.sales.filter(a => a.plotId === r.plotId).sort((a, b) => a.id.localeCompare(b.id));
    check(inventory.every(a => a.id === s.id || a.stage === 'cancelled'), 'OTHER_ACTIVE_SALE_ON_PLOT');
    check(r.history.every(a => ['visited', 'booked'].includes(a.kind)), 'NO_CANCELLATION_INVENTION');
    return { sourceRow: r.sourceRow, sourceKey: r.sourceKey, rowSha256: r.rowSha256,
      sourceRentalEvidence: rentalSourceEvidence(e.value), sourceProgram: null,
      binding: { customerId: c.id, interestId: i.id, saleId: s.id, plotId: p.id },
      projectName: r.projectName, sourceBatchId: c.sourceBatchId, customerSourceKey: c.sourceKey, interestSourceKey: i.sourceKey,
      referenceRevisions: { customer: c.revision, interest: i.revision, sale: s.revision },
      referenceInventory: inventory.map(a => ({ id: a.id, stage: a.stage, interestId: a.interestId })),
      history: structuredClone(r.history), operation: 'administrative_retirement', cancellationDate: null,
      executable: false, freshBeforeImage: null };
  });
  const result = { version: 'rental-source-retirement-inputs-v1', sourceSha256: plan.sourceSha256,
    reviewSha256: plan.reviewSha256, adapterPlanDigest, snapshotDigest: digest(snapshot), capturedAt: snapshot.capturedAt,
    datasetKey: `rental-source-retirement-${adapterPlanDigest}`, approvedSourceRows: [...approvedRetirementRows], records,
    skippedRowsWithoutSale: [961, 969], freshCaptureIncluded: false, canonicalImportReady: false,
    businessWritesAllowed: false, productionChanged: false, rawPersonalDataIncluded: false,
    policy: { administrativeRetirementOnly: true, inventCancellation: false, inventRentalProgram: false,
      rawDeleteAllowed: false, customerAndInterestPreserved: true, oldSourceArchiveImmutable: true } };
  return { ...result, inputDigest: digest(result) };
}

// This returns an in-memory candidate, never a saved import payload or permission to write.
// Column metadata is supplied by the independent read-only collector. SQL must still
// compare every captured full row and the complete dependency inventory under locks.
export function bindRentalSourceRetirementInputs({ manifest, captures }) {
  const { inputDigest, ...body } = manifest;
  check(digest(body) === inputDigest && manifest.version === 'rental-source-retirement-inputs-v1'
    && manifest.businessWritesAllowed === false && manifest.freshCaptureIncluded === false
    && same(manifest.approvedSourceRows, approvedRetirementRows), 'SEALED_RETIREMENT_INPUTS_REQUIRED');
  check(Array.isArray(captures) && captures.length === 6 && same([...captures.map(c => c.sourceRow)].sort((a, b) => a - b), approvedRetirementRows),
    'COMPLETE_SIX_BEFORE_IMAGES_REQUIRED');
  const byRow = new Map(captures.map(c => [c.sourceRow, c]));
  const records = manifest.records.map(r => {
    const capture = byRow.get(r.sourceRow), before = capture?.before, columns = capture?.columns;
    check(exactKeys(before, ['customer', 'interest', 'sale', 'plot', 'inventory', 'dependencies', 'source'])
      && exactKeys(columns, ['customer', 'interest', 'sale', 'plot']), 'FULL_BEFORE_IMAGES_AND_CATALOG_REQUIRED');
    for (const key of ['customer', 'interest', 'sale', 'plot']) {
      const names = columns[key];
      check(Array.isArray(names) && names.length > 1 && names.every(n => typeof n === 'string' && n.length > 0)
        && names.includes('id') && new Set(names).size === names.length && exactKeys(before[key], names), 'FULL_COLUMN_CAPTURE_REQUIRED');
    }
    const { customer: c, interest: i, sale: s, plot: p } = before;
    const b = r.binding;
    check(c.id === b.customerId && Object.hasOwn(c, 'merged_into_customer_id') && c.merged_into_customer_id === null
      && i.id === b.interestId && i.customer_id === c.id && i.project_name === r.projectName
      && p.id === b.plotId && p.project_name === r.projectName && s.id === b.saleId
      && s.project_interest_id === i.id && s.plot_id === p.id, 'BEFORE_IMAGE_BINDING_CHANGED');
    check(c.external_snapshot_batch_id === r.sourceBatchId && c.external_customer_key === r.customerSourceKey
      && i.external_interest_key === r.interestSourceKey && s.external_booking_id === s.id
      && c.lifecycle_revision === r.referenceRevisions.customer && i.lifecycle_revision === r.referenceRevisions.interest
      && s.booking_revision === r.referenceRevisions.sale, 'BEFORE_IMAGE_PROVENANCE_CHANGED');
    check(s.crm_stage === 'booked' && s.lead_id === null && s.contract_status === 'Reserved'
      && ['cancelled_at', 'contracted_at', 'transferred_at', 'crm_handover_at'].every(k => Object.hasOwn(s, k) && s[k] === null)
      && ['crm_transfer_date', 'crm_handover_date'].every(k => !Object.hasOwn(s, k) || s[k] === null),
      'UNADVANCED_RENTAL_BEFORE_IMAGE_REQUIRED');
    check(Array.isArray(before.inventory) && same(before.inventory.map(a => a.id), r.referenceInventory.map(a => a.id))
      && before.inventory.every(a => exactKeys(a, columns.sale) && a.plot_id === p.id)
      && before.inventory.some(a => a.id === s.id && same(canonical(a), canonical(s)))
      && before.inventory.every(a => a.id === s.id || a.crm_stage === 'cancelled'), 'COMPLETE_SORTED_PLOT_INVENTORY_REQUIRED');
    check(exactKeys(before.dependencies, ['constraints', 'unconstrained'])
      && ['constraints', 'unconstrained'].every(k => Array.isArray(before.dependencies[k])), 'DEPENDENCY_CAPTURE_REQUIRED');
    for (const entry of [...before.dependencies.constraints, ...before.dependencies.unconstrained])
      check(object(entry) && typeof entry.table === 'string' && entry.table.length > 0
        && Object.keys(entry).every(k => ['table', 'constraint', 'definition', 'columns', 'parentColumns', 'column', 'rows'].includes(k))
        && Array.isArray(entry.rows) && entry.rows.length === 0, 'DEPENDENCIES_REQUIRE_SEPARATE_REVIEW');
    check(exactKeys(before.source, ['preparedBooking', 'bookingHistory', 'sourceRecord', 'cutoverReceiptDigest', 'writerRelease'])
      && ['preparedBooking', 'bookingHistory', 'sourceRecord', 'writerRelease'].every(k => object(before.source[k]) && Object.keys(before.source[k]).length > 0)
      && /^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(before.source.cutoverReceiptDigest), 'COMPLETE_SOURCE_BEFORE_IMAGE_REQUIRED');
    return { sourceRow: r.sourceRow, sourceKey: r.sourceKey, rowSha256: r.rowSha256,
      operation: 'administrative_retirement', sourceRentalEvidence: structuredClone(r.sourceRentalEvidence),
      binding: structuredClone(b), history: structuredClone(r.history), before: structuredClone(before) };
  });
  return { version: 'reviewed-rental-source-retirement-v1', datasetKey: manifest.datasetKey,
    sourceSha256: manifest.sourceSha256, reviewSha256: manifest.reviewSha256,
    adapterPlanDigest: manifest.adapterPlanDigest, records };
}

export function loadRentalSourceRetirementInputs() {
  const { redacted } = loadRemainingSourceInputs(); // Rechecks all 979 source rows and approvals.
  const paths = { plan: 'reports/canonical-customer-adapter-plan-2026-10-10.json',
    snapshot: 'reports/customer-replacement-live-reference-2026-10-10.json',
    options: 'reports/customer-resolution-plan-options-2026-10-10.json' };
  const bytes = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, readFileSync(workspacePath(p))]));
  const plan = JSON.parse(bytes.plan), snapshot = JSON.parse(bytes.snapshot), options = JSON.parse(bytes.options);
  check(plan.sourceSha256 === redacted.sourceSha256 && plan.adapterPlanDigest === redacted.adapterPlanDigest, 'CURRENT_APPROVED_SOURCE_REQUIRED');
  const workbookBytes = readFileSync(workspacePath(options.source));
  check(hash(workbookBytes) === plan.sourceSha256, 'CURRENT_SOURCE_REQUIRED');
  const base = JSON.parse(readFileSync(workspacePath(options.base)));
  const extraction = extractWorkbook({ python: options.python, source: workspacePath(options.source),
    sourceSha256: plan.sourceSha256, inspectionDate: base.inspectionDate });
  const evidenceRows = extraction.rows.filter(r => approvedRetirementRows.includes(r.rowNumber))
    .map(r => ({ sourceRow: r.rowNumber, rowSha256: digest(r), value: r.values[8] }));
  const result = prepareRentalSourceRetirement({ plan, snapshot, evidenceRows });
  check(readFileSync(workspacePath(options.source)).equals(workbookBytes)
    && Object.entries(paths).every(([k, p]) => readFileSync(workspacePath(p)).equals(bytes[k])), 'INPUT_CHANGED_DURING_REVIEW');
  return result;
}

export function saveRentalSourceRetirementInputs(output) {
  check(/^reports\/rental-source-retirement-inputs-[\w-]+\.json$/.test(output), 'UNUSED_REDACTED_OUTPUT_REQUIRED');
  const manifest = loadRentalSourceRetirementInputs();
  writeFileSync(workspacePath(output), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { output, sourceVerified: true, sourceRowsVerified: 979, retirementRows: manifest.records.length,
    inputDigest: manifest.inputDigest, productionChanged: false, businessWritesAllowed: false };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  check(args.length === 2 && args[0] === '--output', 'Usage: --output reports/rental-source-retirement-inputs-DATE.json');
  console.log(JSON.stringify(saveRentalSourceRetirementInputs(args[1])));
}
