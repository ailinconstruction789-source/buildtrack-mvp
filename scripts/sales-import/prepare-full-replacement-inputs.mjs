// Pure/offline cohort preparation. No connections, SQL, UUID allocation or persisted raw names.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { workspacePath } from './review-workbook.mjs';
import { loadRemainingSourceInputs } from './prepare-remaining-canonical-inputs.mjs';
import { prepareCustomerReplacementPreflight } from './prepare-customer-replacement-preflight.mjs';
import { validateCombinedPlan } from '../sales-runtime/customer-combined-trial.mjs';

const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const hash = v => createHash('sha256').update(v).digest('hex');
const check = (ok, code) => { if (!ok) throw new Error(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const sha = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const day = v => typeof v === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const excluded = new Set(['skip_rental', 'hold_identity']);
const routeRows = {
  source_bound_creation_review: [438, 439, 440, 444, 680, 894],
  historical_lifecycle_review: [926, 944], historical_booking_review: [964],
  reviewed_details_candidate: [706, 881, 937, 939, 952],
  unknown_history_evidence: [171, 237, 238, 239, 249, 250, 256, 257, 263, 274, 275],
  skip_rental: [859, 951, 954, 958, 959, 960, 961, 969],
  hold_identity: [967, 968, 970, 971, 972, 973, 974, 975, 976, 977, 978, 979, 980],
};
const expectedCounts = { existing_history_evidence: 933, historical_booking_review: 1, historical_lifecycle_review: 2,
  hold_identity: 13, reviewed_details_candidate: 5, skip_rental: 8, source_bound_creation_review: 6, unknown_history_evidence: 11 };
const satang = (value, allowZero = false) => {
  if (value === null) return null;
  const amount = Math.round(value * 100);
  check(typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(amount)
    && amount >= (allowZero ? 0 : 1) && amount <= 99999999999 && Math.abs(amount / 100 - value) < 1e-7, 'INVALID_FINANCIAL_UNIT');
  return amount;
};

export function prepareFullReplacementInputs({ base, plan, snapshot, preflight, remaining }) {
  validateCombinedPlan(base);
  const { adapterPlanDigest, ...planBody } = plan;
  check(digest(planBody) === adapterPlanDigest && plan.basePlanDigest === base.combinedPlanDigest
    && plan.businessWritesAllowed === false && plan.canonicalImportReady === false && plan.rows.length === 979
    && new Set(plan.rows.map(r => r.sourceRow)).size === 979, 'SEALED_COMPLETE_APPROVED_PLAN_REQUIRED');
  const { inputDigest, ...remainingBody } = remaining.redacted;
  check(digest(remainingBody) === inputDigest && remaining.redacted.adapterPlanDigest === adapterPlanDigest
    && remaining.redacted.sourceSha256 === plan.sourceSha256 && remaining.redacted.reviewSha256 === plan.reviewSha256,
    'VERIFIED_REMAINING_INPUTS_REQUIRED');
  check(same(prepareCustomerReplacementPreflight({ plan, snapshot }), preflight), 'DERIVED_PREFLIGHT_REQUIRED');
  check(preflight.issues.length === 0 && preflight.counts.eligibleSourceRows === 958, 'FRESH_BINDING_OR_OCCUPANCY_ISSUES');
  const actualCounts = Object.fromEntries(Object.keys(expectedCounts).map(k => [k, plan.rows.filter(r => r.route === k).length]));
  check(same(actualCounts, expectedCounts) && Object.keys(plan.counts).length === Object.keys(expectedCounts).length
    && Object.keys(expectedCounts).every(k => plan.counts[k] === expectedCounts[k]), 'EXACT_COHORT_ROUTE_COUNTS_REQUIRED');
  for (const [route, rows] of Object.entries(routeRows))
    check(same(plan.rows.filter(r => r.route === route).map(r => r.sourceRow), rows), 'EXACT_APPROVED_ROUTE_ROWS_REQUIRED');
  const originals = new Map(base.rows.map(r => [r.sourceRow, r]));
  const customers = new Map(snapshot.customers.map(c => [c.id, c]));
  const interests = new Map(snapshot.interests.map(i => [i.id, i]));
  const sales = new Map(snapshot.sales.map(s => [s.id, s]));
  const plots = new Map(snapshot.plots.map(p => [p.id, p]));
  const roles = new Map(snapshot.roles.map(r => [r.id, r]));
  const creation = new Map(remaining.creation.records.map(r => [r.sourceRow, r]));
  const records = plan.rows.filter(r => !excluded.has(r.route)).map(r => {
    const b = originals.get(r.sourceRow), c = customers.get(r.customerId), i = interests.get(r.interestId), s = sales.get(r.saleId);
    check(b && b.sourceKey === r.sourceKey && b.rowSha256 === r.rowSha256 && sha(r.sourceKey) && sha(r.rowSha256)
      && sha(b.customerPartitionKey), 'EXACT_SOURCE_ROW_BINDING_REQUIRED');
    check(['visited', 'booked', 'contracted', 'transferred', 'cancelled'].includes(r.sourceStage), 'SOURCE_STAGE_INVALID');
    check(uuid(r.ownerUserId) && roles.get(r.ownerUserId)?.active && roles.get(r.ownerUserId).role === 'sales', 'ACTIVE_SOURCE_SALES_OWNER_REQUIRED');
    for (const key of ['customerId', 'interestId', 'saleId']) check(r[key] === null || uuid(r[key]), 'CANONICAL_UUID_REQUIRED');
    check(Array.isArray(r.history) && r.history.length > 0 && r.history.every(h => ['visited', 'booked', 'contracted', 'transferred', 'cancelled'].includes(h.kind)
      && (h.precision === 'day' ? day(h.date) : h.precision === 'unknown' && h.date === null)), 'SOURCE_HISTORY_PRECISION_REQUIRED');
    check(same(r.history, b.sourceHistory) && b.actualTimestamps === null && b.leadReplayAllowed === false
      && b.bankPolicy === 'preserve_existing_no_inference_from_note' && b.structuredBank === null,
      'SOURCE_HISTORY_OR_BANK_POLICY_CHANGED');
    check(b.expectedTransferDate === null || day(b.expectedTransferDate), 'SOURCE_P_FORECAST_DAY_REQUIRED');
    check(b.pricePolicy === (b.salePrice === null ? 'unknown_preserve_existing' : 'propose_source_value')
      && b.forecastPolicy === (b.expectedTransferDate === null ? 'unknown_preserve_existing' : 'per_booking_forecast'), 'SOURCE_FINANCIAL_POLICY_CHANGED');
    const sourcePriceSatang = satang(b.salePrice);
    if (c) {
      check(uuid(c.ownerId) && roles.get(c.ownerId)?.active && roles.get(c.ownerId).role === 'sales', 'ACTIVE_PRESERVED_CUSTOMER_OWNER_REQUIRED');
      check(uuid(c.sourceBatchId) && sha(c.sourceKey) && snapshot.sourceBatches.some(batch => batch.id === c.sourceBatchId), 'PRESERVED_CUSTOMER_PROVENANCE_REQUIRED');
    }
    if (i) check(uuid(i.ownerId) && roles.get(i.ownerId)?.active && roles.get(i.ownerId).role === 'sales'
      && sha(i.sourceKey), 'ACTIVE_PRESERVED_INTEREST_OWNER_REQUIRED');
    if (s) {
      check(s.stage === b.priorStage && s.interestId === r.interestId && s.plotId === r.plotId && s.leadId === null,
        'EXISTING_SALE_STAGE_OR_BINDING_CHANGED');
      check(s.sourceBookingId === s.id && (s.expectedTransferDate === null || day(s.expectedTransferDate))
        && (s.bank === null || typeof s.bank === 'string'), 'EXISTING_SALE_SOURCE_METADATA_CHANGED');
      if (r.route === 'existing_history_evidence' && sourcePriceSatang !== null)
        check(sourcePriceSatang === satang(s.price, true), 'UNREVIEWED_PRICE_DIFFERENCE');
    }
    if (r.route === 'unknown_history_evidence') check(r.saleId === null && r.plotId === null
      && (r.unknownProjectDisplay ? r.projectName === null && r.interestId === null : r.sourceRow === 171 && !!r.interestId), 'UNKNOWN_HISTORY_MUST_NOT_CREATE_BINDING');
    if (r.route === 'source_bound_creation_review') {
      const raw = creation.get(r.sourceRow), saved = remaining.redacted.creation.records.find(v => v.sourceRow === r.sourceRow);
      check(raw && saved && raw.customerCandidateKey === r.customerCandidateKey && raw.interestCandidateKey === r.interestCandidateKey
        && sha(r.customerCandidateKey) && sha(r.interestCandidateKey) && hash(raw.customerName) === saved.customerNameHash
        && raw.ownerUserId === r.ownerUserId && raw.projectName === r.projectName && r.customerId === null && r.interestId === null
        && r.saleId === null && r.sourceStage === 'visited', 'SOURCE_CREATION_NAME_OR_BINDING_CHANGED');
    }
    const knownDays = r.history.filter(h => h.precision === 'day').map(h => h.date);
    return { sourceRow: r.sourceRow, sourceKey: r.sourceKey, rowSha256: r.rowSha256, customerKey: b.customerPartitionKey,
      route: r.route, binding: { customerId: r.customerId, interestId: r.interestId, saleId: r.saleId, plotId: r.plotId,
        customerCandidateKey: r.customerCandidateKey, interestCandidateKey: r.interestCandidateKey,
        newBookingCandidateKey: b.newBookingCandidateKey }, projectName: r.projectName,
      unknownProjectDisplay: r.unknownProjectDisplay, unknownBookingDisplay: r.unknownBookingDisplay,
      ownerUserId: r.ownerUserId, preservedCustomerOwnerId: c?.ownerId ?? null, preservedInterestOwnerId: i?.ownerId ?? null,
      sourceProvenance: { customerBatchId: c?.sourceBatchId ?? null, customerKey: c?.sourceKey ?? null,
        interestKey: i?.sourceKey ?? null, originalSaleId: s?.sourceBookingId ?? null },
      beforeSale: s ? { priceSatang: satang(s.price, true), bank: s.bank, paymentMethod: s.paymentMethod,
        stage: s.stage, expectedTransferDate: s.expectedTransferDate, revision: s.revision } : null,
      sourceStage: r.sourceStage, priorStage: b.priorStage, history: r.history.map((h, index) => ({ ...h,
        eventKey: `${r.sourceKey}-${index + 1}`, evidenceRef: `approved-source-row:${r.sourceRow}:${r.rowSha256}` })),
      chronologyReview: knownDays.some((value, index) => index > 0 && value < knownDays[index - 1]),
      sourceIssuesRetained: [...b.sourceIssuesRetained], financial: { salePriceSatang: sourcePriceSatang,
        pricePolicy: b.pricePolicy, expectedTransferDate: b.expectedTransferDate, forecastPolicy: b.forecastPolicy,
        expectedTransferSourceColumn: 'P', bankPolicy: b.bankPolicy, structuredBank: null },
      actualTimestamps: null, actualTimestampPolicy: 'source_day_precision_only_no_synthetic_timestamp',
      ...(creation.has(r.sourceRow) ? { creationNameHash: remaining.redacted.creation.records.find(v => v.sourceRow === r.sourceRow).customerNameHash,
        unknownNameDisplay: r.unknownNameDisplay } : {}) };
  });
  const first = records.find(r => r.sourceRow === 3), second = records.find(r => r.sourceRow === 193);
  check(first.binding.customerId === second.binding.customerId && first.customerKey === second.customerKey
    && first.binding.interestId !== second.binding.interestId && first.binding.saleId !== second.binding.saleId
    && first.sourceStage === 'transferred' && second.sourceStage === 'cancelled', 'CONFIRMED_N001_HISTORY_SPLIT_REQUIRED');
  const identities = new Map();
  for (const r of records) {
    const id = r.binding.customerId ?? r.binding.customerCandidateKey;
    check(!identities.has(id) || identities.get(id) === r.customerKey, 'IDENTITY_MERGE_BY_NAME_FORBIDDEN');
    identities.set(id, r.customerKey);
  }
  check(identities.size === 957 && new Set(records.filter(r => r.binding.customerId).map(r => r.binding.customerId)).size === 951
    && new Set(records.filter(r => r.binding.interestId).map(r => r.binding.interestId)).size === 942
    && new Set(records.filter(r => r.binding.saleId).map(r => r.binding.saleId)).size === 297, 'EXACT_CANONICAL_IDENTITY_COUNTS_REQUIRED');
  const projectedSales = records.filter(r => r.binding.saleId || r.route === 'historical_booking_review').map(r => ({
    sourceRow: r.sourceRow, saleId: r.binding.saleId, newBookingCandidateKey: r.binding.newBookingCandidateKey,
    customerId: r.binding.customerId, interestId: r.binding.interestId, plotId: r.binding.plotId,
    stage: r.sourceStage, priceSatang: r.route === 'existing_history_evidence' ? r.beforeSale.priceSatang
      : r.financial.salePriceSatang ?? r.beforeSale?.priceSatang ?? null,
    expectedTransferDate: r.financial.expectedTransferDate ?? r.beforeSale?.expectedTransferDate ?? null,
    bank: r.beforeSale?.bank ?? null, paymentMethod: r.beforeSale?.paymentMethod ?? null }));
  check(projectedSales.length === 298 && new Set(projectedSales.map(s => s.saleId ?? s.newBookingCandidateKey)).size === 298,
    'PROJECTED_SALE_COUNT_REQUIRED');
  const active = new Map();
  for (const s of projectedSales.filter(s => s.stage !== 'cancelled')) {
    check(plots.has(s.plotId) && !active.has(s.plotId), 'PROJECTED_STOCK_CONFLICT'); active.set(s.plotId, s);
  }
  const forecastUpdateRows = records.filter(r => r.binding.saleId && r.financial.expectedTransferDate !== null
    && r.beforeSale.expectedTransferDate !== r.financial.expectedTransferDate).map(r => r.sourceRow);
  const extraForecastRecords = records.filter(r => r.route === 'existing_history_evidence' && forecastUpdateRows.includes(r.sourceRow));
  const output = { version: 'reviewed-full-replacement-inputs-v1', datasetKey: `full-replacement-${adapterPlanDigest}`,
    sourceSha256: plan.sourceSha256, reviewSha256: plan.reviewSha256, adapterPlanDigest, basePlanDigest: base.combinedPlanDigest,
    snapshotDigest: preflight.snapshotDigest, capturedAt: snapshot.capturedAt, records, projectedSales,
    counts: { sourceRowsVerified: 979, eligibleSourceRows: 958, projectedCustomerIdentities: 957,
      existingCustomerIds: 951, existingInterestIds: 942, projectedInterestRecords: 948, existingSaleIds: 297, projectedSaleRecords: 298,
      sourceCreations: 6, priceUpdates: 5, lifecycleCancellations: 2, newBooking: 1, unknownHistoryRows: 11,
      knownSourceForecasts: records.filter(r => r.financial.expectedTransferDate !== null).length,
      existingForecastUpdates: forecastUpdateRows.length, activeProjectedPlots: active.size },
    excluded: { rentalSourceRows: [...routeRows.skip_rental], heldIdentitySourceRows: [...routeRows.hold_identity] },
    forecastUpdateRows, additionalForecastImport: { required: extraForecastRecords.length > 0,
      sourceRows: extraForecastRecords.map(r => r.sourceRow), stageCounts: Object.fromEntries(['booked', 'transferred', 'cancelled']
        .map(stage => [stage, extraForecastRecords.filter(r => r.sourceStage === stage).length])),
      status: 'requires_full_rehearsal_per_sale_forecast_import', expectedTransferIsActualTransfer: false },
    chronologyReviewRows: records.filter(r => r.chronologyReview).map(r => r.sourceRow),
    projectedPlotOccupancy: [...plots.values()].map(p => ({ plotId: p.id, projectName: p.projectName,
      canonicalOccupied: active.has(p.id), activeSaleId: active.get(p.id)?.saleId ?? null,
      newBookingCandidateKey: active.get(p.id)?.newBookingCandidateKey ?? null })),
    policy: { expectedTransferSourceColumn: 'P', inferBankFromNotes: false, inventUnknownDates: false,
      syntheticActualTimestamps: false, rentalImport: false, leadReplay: false, identityMergeByName: false,
      unknownProjectsCreateInterests: false, constructionAndStaffPreserved: true, oldSourceArchiveImmutable: true },
    rawPersonalDataIncluded: false, freshCaptureIncluded: false, phase3Completion: false, canonicalImportReady: false,
    businessWritesAllowed: false, schemaWritesAllowed: false, productionChanged: false };
  return { manifest: { ...output, fullReplacementInputDigest: digest(output) }, creationPayload: structuredClone(remaining.creation) };
}

export function loadFullReplacementInputs() {
  const remaining = loadRemainingSourceInputs();
  const optionsBytes = readFileSync(workspacePath('reports/customer-resolution-plan-options-2026-10-10.json'));
  const options = JSON.parse(optionsBytes);
  const paths = { base: options.base, plan: 'reports/canonical-customer-adapter-plan-2026-10-10.json',
    snapshot: 'reports/customer-replacement-live-reference-2026-10-10.json', preflight: 'reports/customer-replacement-preflight-2026-10-10.json' };
  const bytes = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, readFileSync(workspacePath(path))]));
  const inputs = Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, JSON.parse(value)]));
  const result = prepareFullReplacementInputs({ ...inputs, remaining });
  check(readFileSync(workspacePath(options.source)).length > 0
    && hash(readFileSync(workspacePath(options.source))) === result.manifest.sourceSha256
    && readFileSync(workspacePath('reports/customer-resolution-plan-options-2026-10-10.json')).equals(optionsBytes)
    && Object.entries(paths).every(([key, path]) => readFileSync(workspacePath(path)).equals(bytes[key])), 'INPUT_CHANGED_DURING_REVIEW');
  return result;
}
