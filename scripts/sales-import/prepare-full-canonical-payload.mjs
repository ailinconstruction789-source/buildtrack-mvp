// Offline binding for this explicitly reviewed workbook. No DB access, UUID allocation or file writes.
// Full before-images and six new names are sensitive; keep the returned payload in memory or an ignored backup.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extractWorkbook, prepareWorkbookDraft, workspacePath } from './review-workbook.mjs';
import { loadFullReplacementInputs } from './prepare-full-replacement-inputs.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const check = (ok, code) => { if (!ok) throw new Error(code); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = value => Object.keys(value).sort();
const clone = value => structuredClone(value);
const APPROVED_MANIFEST_DIGEST = 'c24b45f03a5a8cf2854f893136b8c6e54656839e0db1a867fd27a177ba73f581';
const relations = ['customers', 'interests', 'sales', 'plots', 'details', 'forecast'];
const active = sale => sale.crm_stage !== 'cancelled';
const satang = value => {
  if (value === null) return null;
  const amount = Math.round(value * 100);
  check(typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(amount) && amount >= 0
    && amount <= 99999999999 && Math.abs(amount / 100 - value) < 1e-7, 'CANONICAL_PRICE_INVALID');
  return amount;
};

export function loadFullCanonicalSource() {
  const full = loadFullReplacementInputs();
  check(full.manifest.fullReplacementInputDigest === APPROVED_MANIFEST_DIGEST, 'APPROVED_FULL_MANIFEST_CHANGED');
  const optionsBytes = readFileSync(workspacePath('reports/customer-resolution-plan-options-2026-10-10.json'));
  const options = JSON.parse(optionsBytes);
  const baseBytes = readFileSync(workspacePath(options.base));
  const base = JSON.parse(baseBytes);
  const sourceBytes = readFileSync(workspacePath(options.source));
  const extraction = extractWorkbook({ python: options.python, source: workspacePath(options.source),
    sourceSha256: hash(sourceBytes), inspectionDate: base.inspectionDate });
  const raw = new Map(extraction.rows.map(row => [row.rowNumber, row]));
  const { draft } = prepareWorkbookDraft(extraction, base.inspectionDate);
  const entries = new Map(draft.entries.map(entry => [entry.sourceRow, entry]));
  check(extraction.sha256 === full.manifest.sourceSha256 && draft.entries.length === 979
    && base.rows.every(row => digest(raw.get(row.sourceRow)) === row.rowSha256), 'FULL_WORKBOOK_ROW_PARITY_REQUIRED');
  const personalData = full.manifest.records.map(row => {
    const creation = full.creationPayload.records.find(record => record.sourceRow === row.sourceRow);
    const customerName = creation?.customerName ?? entries.get(row.sourceRow)?.proposal.customerName;
    check(typeof customerName === 'string' && customerName.length > 0, 'SOURCE_CUSTOMER_NAME_REQUIRED');
    return { sourceRow: row.sourceRow, customerName, customerNameHash: hash(customerName) };
  });
  check(readFileSync(workspacePath(options.source)).equals(sourceBytes)
    && readFileSync(workspacePath(options.base)).equals(baseBytes)
    && readFileSync(workspacePath('reports/customer-resolution-plan-options-2026-10-10.json')).equals(optionsBytes),
  'SOURCE_CHANGED_DURING_EXTRACTION');
  const source = { version: 'verified-full-canonical-source-v1', ...full, personalData,
    sourceRowsReextracted: draft.entries.length, physicalRowsInspected: extraction.rows.length,
    workbookEdited: false, productionChanged: false };
  return { ...source, sourceVerificationDigest: digest(source) };
}

function validateSource(source) {
  const { sourceVerificationDigest, ...body } = source;
  const { fullReplacementInputDigest, ...manifestBody } = source.manifest;
  check(source.version === 'verified-full-canonical-source-v1' && digest(body) === sourceVerificationDigest
    && fullReplacementInputDigest === APPROVED_MANIFEST_DIGEST && digest(manifestBody) === fullReplacementInputDigest
    && source.sourceRowsReextracted === 979 && source.workbookEdited === false && source.productionChanged === false,
  'VERIFIED_FULL_SOURCE_REQUIRED');
  check(source.personalData.length === 958 && new Set(source.personalData.map(row => row.sourceRow)).size === 958,
    'COMPLETE_SOURCE_NAMES_REQUIRED');
  const names = new Map(source.personalData.map(row => [row.sourceRow, row]));
  check(source.manifest.records.every(row => typeof names.get(row.sourceRow)?.customerName === 'string'
    && hash(names.get(row.sourceRow).customerName) === names.get(row.sourceRow).customerNameHash), 'SOURCE_NAME_HASH_CHANGED');
  check(source.creationPayload.version === 'source-bound-customer-creation-v1'
    && source.creationPayload.sourceSha256 === source.manifest.sourceSha256
    && source.creationPayload.reviewSha256 === source.manifest.reviewSha256
    && same(source.creationPayload.records.map(row => row.sourceRow), [438, 439, 440, 444, 680, 894])
    && source.creationPayload.records.every(row => hash(row.customerName) === source.manifest.records
      .find(record => record.sourceRow === row.sourceRow)?.creationNameHash), 'VERIFIED_CREATION_NAMES_REQUIRED');
}

function validateCapture(capture) {
  check(capture.version === 'full-canonical-before-capture-v1' && capture.projectId === 'kbthmdedilswdmmczfay'
    && ['production-target', 'owned-fixture'].includes(capture.purpose) && Number.isFinite(Date.parse(capture.capturedAt)),
  'DATED_FULL_TARGET_CAPTURE_REQUIRED');
  const indexes = {};
  for (const relation of relations) {
    const columns = capture.relationColumns?.[relation], rows = capture[relation];
    const idColumn = ['details', 'forecast'].includes(relation) ? 'sale_id' : 'id';
    check(Array.isArray(columns) && columns.length > 0 && new Set(columns).size === columns.length
      && columns.every(column => typeof column === 'string') && columns.includes(idColumn)
      && Array.isArray(rows) && capture.counts?.[relation] === rows.length
      && rows.every(row => row && typeof row === 'object' && !Array.isArray(row)
        && same(keys(row), [...columns].sort()) && typeof row[idColumn] === 'string')
      && new Set(rows.map(row => row[idColumn])).size === rows.length, 'FULL_RELATION_CAPTURE_REQUIRED:' + relation);
    indexes[relation] = new Map(rows.map(row => [row[idColumn], row]));
  }
  check(Array.isArray(capture.roles) && capture.roles.every(role => uuid(role.id) && typeof role.active === 'boolean')
    && new Set(capture.roles.map(role => role.id)).size === capture.roles.length
    && Array.isArray(capture.projects) && capture.projects.every(project => typeof project.name === 'string'
      && (project.is_closed === null || typeof project.is_closed === 'boolean'))
    && new Set(capture.projects.map(project => project.name)).size === capture.projects.length
    && Array.isArray(capture.sourceBatches) && capture.sourceBatches.every(batch => uuid(batch.id))
    && new Set(capture.sourceBatches.map(batch => batch.id)).size === capture.sourceBatches.length,
  'FULL_CATALOG_CAPTURE_REQUIRED');
  const required = { customers: ['customer_name', 'record_origin', 'owner_user_id', 'lifecycle_revision', 'merged_into_customer_id',
    'external_snapshot_batch_id', 'external_customer_key'], interests: ['customer_id', 'project_name',
    'owner_user_id', 'lifecycle_revision', 'external_interest_key', 'external_snapshot_batch_id'],
  sales: ['project_interest_id', 'plot_id', 'crm_stage', 'booking_revision', 'external_booking_id', 'sale_price',
    'bank_name', 'payment_method', 'expected_transfer_date', 'lead_id'], plots: ['project_name', 'has_customer', 'sale_status'],
  details: ['sale_price', 'bank_name', 'revision', 'actor_user_id', 'reason', 'recorded_at'],
  forecast: ['expected_transfer_date', 'revision', 'batch_id', 'reviewer_id', 'recorded_at'] };
  for (const relation of relations) check(required[relation].every(key => capture.relationColumns[relation].includes(key)),
    'CANONICAL_COLUMNS_MISSING:' + relation);
  for (const relation of ['customers', 'interests', 'sales'])
    check(capture[relation].every(row => uuid(row.id)), 'CAPTURE_UUID_REQUIRED:' + relation);
  check(capture.details.every(row => indexes.sales.has(row.sale_id)) && capture.forecast.every(row => indexes.sales.has(row.sale_id)),
    'CORRECTION_SALE_BINDING_REQUIRED');
  return indexes;
}

export function prepareFullCanonicalPayload({ source, capture }) {
  validateSource(source);
  const indexes = validateCapture(capture), manifest = source.manifest;
  const roles = new Map(capture.roles.map(role => [role.id, role]));
  const ownerActive = id => roles.get(id)?.role === 'sales' && roles.get(id)?.active === true;
  const inventories = new Map();
  for (const sale of capture.sales) {
    check(indexes.interests.has(sale.project_interest_id), 'CAPTURE_SALE_INTEREST_MISSING');
    check(sale.plot_id === null || indexes.plots.has(sale.plot_id), 'CAPTURE_SALE_PLOT_MISSING');
    if (sale.plot_id !== null) {
      if (!inventories.has(sale.plot_id)) inventories.set(sale.plot_id, []);
      inventories.get(sale.plot_id).push(sale);
    }
  }
  for (const list of inventories.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  const captures = [], detailsRecords = [], sourceBatchIds = new Set();
  const expectedSales = [];
  for (const record of manifest.records) {
    const binding = record.binding, customer = indexes.customers.get(binding.customerId), interest = indexes.interests.get(binding.interestId);
    const sale = indexes.sales.get(binding.saleId), plot = indexes.plots.get(binding.plotId);
    check(ownerActive(record.ownerUserId), 'SOURCE_SALES_OWNER_CHANGED');
    if (binding.customerId) {
      check(customer?.id === binding.customerId && customer.record_origin === 'legacy_import'
        && customer.merged_into_customer_id === null && customer.owner_user_id === record.preservedCustomerOwnerId
        && ownerActive(customer.owner_user_id) && uuid(customer.lifecycle_revision)
        && customer.external_snapshot_batch_id === record.sourceProvenance.customerBatchId
        && customer.external_customer_key === record.sourceProvenance.customerKey
        && capture.sourceBatches.some(batch => batch.id === customer.external_snapshot_batch_id), 'CAPTURE_CUSTOMER_BINDING_CHANGED');
      sourceBatchIds.add(customer.external_snapshot_batch_id);
    } else check(record.route === 'source_bound_creation_review' && customer === undefined && interest === undefined,
      'CREATION_MUST_NOT_USE_EXISTING_ID');
    if (binding.interestId) {
      const proof = { identity: interest?.id === binding.interestId, customer: interest?.customer_id === customer.id,
        project: interest?.project_name === record.projectName, owner: interest?.owner_user_id === record.preservedInterestOwnerId,
        activeSalesOwner: ownerActive(interest?.owner_user_id), revision: uuid(interest?.lifecycle_revision),
        sourceKey: interest?.external_interest_key === record.sourceProvenance.interestKey,
        sourceBatch: interest?.external_snapshot_batch_id === customer.external_snapshot_batch_id };
      check(Object.values(proof).every(Boolean), `CAPTURE_INTEREST_BINDING_CHANGED:sourceRow=${record.sourceRow}:fields=${Object.keys(proof).filter(key => !proof[key]).join(',')}`);
    }
    if (binding.plotId) check(plot?.id === binding.plotId && plot.project_name === record.projectName, 'CAPTURE_PLOT_BINDING_CHANGED');
    if (binding.saleId) check(sale?.id === binding.saleId && sale.project_interest_id === binding.interestId
      && sale.plot_id === binding.plotId && sale.lead_id === null && sale.crm_stage === record.priorStage
      && sale.booking_revision === record.beforeSale.revision && sale.external_booking_id === record.sourceProvenance.originalSaleId
      && satang(sale.sale_price) === record.beforeSale.priceSatang && sale.bank_name === record.beforeSale.bank
      && sale.payment_method === record.beforeSale.paymentMethod && sale.expected_transfer_date === record.beforeSale.expectedTransferDate,
    'CAPTURE_SALE_BASELINE_CHANGED');
    const details = sale ? indexes.details.get(sale.id) ?? null : null;
    const forecast = sale ? indexes.forecast.get(sale.id) ?? null : null;
    if (['historical_lifecycle_review', 'historical_booking_review', 'source_bound_creation_review'].includes(record.route))
      check(capture.projects.some(project => project.name === record.projectName && !project.is_closed), 'OPEN_SOURCE_PROJECT_REQUIRED');
    if (record.route === 'historical_booking_review') check(sale === undefined && plot.has_customer !== true
      && !(inventories.get(plot.id) ?? []).some(active), 'NEW_BOOKING_STOCK_CHANGED');
    if (['historical_lifecycle_review', 'historical_booking_review'].includes(record.route)) {
      captures.push({ sourceRow: record.sourceRow, sourceKey: record.sourceKey, rowSha256: record.rowSha256,
        operation: record.route === 'historical_booking_review' ? 'create_booking' : 'cancel',
        binding: { saleId: binding.saleId, customerId: binding.customerId, interestId: binding.interestId, plotId: binding.plotId },
        before: { customer: clone(customer), interest: clone(interest), sale: clone(sale ?? null), plot: clone(plot),
          inventory: clone(inventories.get(binding.plotId) ?? []), details: clone(details), forecast: clone(forecast) },
        patch: { bookedDate: record.history.find(event => event.kind === 'booked')?.date ?? null,
          cancelledDate: record.history.find(event => event.kind === 'cancelled')?.date ?? null,
          expectedTransferDate: record.financial.expectedTransferDate, salePriceSatang: record.financial.salePriceSatang,
          closingSalesId: record.ownerUserId },
        history: record.history.map(({ kind, date, precision }) => ({ kind, date, precision })) });
    }
    const knownForecast = record.financial.expectedTransferDate !== null;
    if (sale && (record.route === 'reviewed_details_candidate'
      || (record.route === 'existing_history_evidence' && knownForecast))) {
      check(record.sourceStage !== 'transferred' || knownForecast, 'COMPLETED_FORECAST_EVIDENCE_REQUIRED');
      detailsRecords.push({ sourceRow: record.sourceRow, sourceKey: record.sourceKey, rowSha256: record.rowSha256,
        binding: { customerId: customer.id, interestId: interest.id, saleId: sale.id,
          customerOwnerId: customer.owner_user_id, interestOwnerId: interest.owner_user_id,
          customerRevision: customer.lifecycle_revision, interestRevision: interest.lifecycle_revision },
        before: { sale: clone(sale), details: clone(details), forecast: clone(forecast) },
        patch: { salePriceSatang: record.route === 'reviewed_details_candidate' ? record.financial.salePriceSatang : null,
          expectedTransferDate: record.financial.expectedTransferDate, sourceStage: record.sourceStage } });
    }
    if (sale || record.route === 'historical_booking_review') expectedSales.push({ sourceRow: record.sourceRow,
      saleId: binding.saleId, newBookingCandidateKey: binding.newBookingCandidateKey, customerId: binding.customerId,
      interestId: binding.interestId, plotId: binding.plotId, stage: record.sourceStage,
      priceSatang: ['reviewed_details_candidate', 'historical_lifecycle_review'].includes(record.route) && record.financial.salePriceSatang !== null
        ? record.financial.salePriceSatang : sale ? satang(details ? details.sale_price : sale.sale_price) : record.financial.salePriceSatang,
      // An explicit correction NULL is meaningful. Never fall back to the old public bank in this case.
      bank: details ? details.bank_name : sale?.bank_name ?? null,
      paymentMethod: sale?.payment_method ?? null,
      expectedTransferDate: record.financial.expectedTransferDate ?? forecast?.expected_transfer_date ?? sale?.expected_transfer_date ?? null });
  }
  check(detailsRecords.length === 41 && detailsRecords.filter(record => record.patch.sourceStage === 'transferred').length === 33
    && captures.length === 3 && expectedSales.length === 298, 'EXACT_REVIEWED_OPERATION_COUNTS_REQUIRED');
  const rows = manifest.records.map(record => ({ sourceRow: record.sourceRow, sourceKey: record.sourceKey,
    rowSha256: record.rowSha256, customerKey: record.customerKey, ...record.binding, projectName: record.projectName,
    sourceStage: record.sourceStage, history: clone(record.history), expectedTransferDate: record.financial.expectedTransferDate,
    unknownProjectDisplay: record.unknownProjectDisplay, unknownBookingDisplay: record.unknownBookingDisplay, route: record.route }));
  const metadata = { sourceSha256: manifest.sourceSha256, reviewSha256: manifest.reviewSha256 };
  const membership = { version: 'reviewed-full-canonical-cohort-v1', datasetKey: `full-cohort-${manifest.adapterPlanDigest}`,
    ...metadata, adapterPlanDigest: manifest.adapterPlanDigest, originalSourceBatchIds: [...sourceBatchIds].sort(),
    records: rows, exclusions: clone(manifest.excluded) };
  const unknown = { version: 'unknown-historical-evidence-v1', sourceSystem: 'BuildTrack-approved-customer-workbook',
    datasetKey: `unknown-history-${manifest.adapterPlanDigest}`, snapshotSha256: manifest.sourceSha256,
    mappingReviewRef: `confirmation:${manifest.reviewSha256}`,
    records: manifest.records.filter(record => record.route === 'unknown_history_evidence').map(record => ({
      sourceKey: record.sourceKey, rowNumber: record.sourceRow, rowSha256: record.rowSha256,
      customerKey: record.customerKey, customerId: record.binding.customerId, interestId: record.binding.interestId,
      saleId: null, reason: record.unknownProjectDisplay ? 'unknown_project' : 'unknown_booking', sourceStage: record.sourceStage,
      events: record.history.map((event, index) => ({ ...clone(event), sequence: index + 1 })) })),
    businessWritesAllowed: false, leadRequired: false };
  const result = { version: 'prepared-full-canonical-payload-v1', sourceVerificationDigest: source.sourceVerificationDigest,
    captureDigest: digest(capture), capturedAt: capture.capturedAt, purpose: capture.purpose,
    creation: clone(source.creationPayload), unknown,
    lifecycle: { version: 'reviewed-historical-sale-revision-v1', datasetKey: `source-lifecycle-${manifest.adapterPlanDigest}`,
      ...metadata, leadReplayAllowed: false, records: captures },
    details: { version: 'reviewed-import-details-v1', datasetKey: `full-details-${manifest.adapterPlanDigest}`,
      ...metadata, businessStageWritesAllowed: false, leadReplayAllowed: false, records: detailsRecords },
    membership, expectedSales,
    summary: { sourceRows: 979, eligibleRows: 958, existingCustomerIds: 951, newCustomers: 6,
      projectedCustomerIds: 957, projectedInterestIds: 948, projectedSaleIds: 298, detailsRecords: 41,
      knownSourceForecasts: 42, completedForecastOnlyRecords: 33, creationRecords: 6, unknownHistoryRecords: 11,
      lifecycleRecords: 3, chronologyReviewRows: clone(manifest.chronologyReviewRows), captureDigest: digest(capture),
      purpose: capture.purpose, rawPersonalDataIncluded: false, productionChanged: false,
      canonicalActivationComplete: false, recoveryRehearsalComplete: false } };
  return { ...result, preparedPayloadDigest: digest(result) };
}

// Resolve only UUIDs returned by the guarded writers; no UUIDs or historical Leads are made here.
export function finalizeFullCanonicalMembership({ payload, creationResult, lifecycleResult }) {
  check(payload.version === 'reviewed-full-canonical-cohort-v1' && payload.records.length === 958, 'FULL_MEMBERSHIP_REQUIRED');
  const creations = creationResult?.bindings, lifecycle = lifecycleResult?.bindings;
  check(Array.isArray(creations) && creations.length === 6
    && same(creations.map(record => record.sourceRow).sort((a, b) => a - b), [438, 439, 440, 444, 680, 894])
    && creations.every(record => uuid(record.customerId) && uuid(record.interestId))
    && new Set(creations.map(record => record.customerId)).size === 6 && new Set(creations.map(record => record.interestId)).size === 6,
  'GUARDED_CREATION_RECEIPTS_REQUIRED');
  check(Array.isArray(lifecycle) && lifecycle.length === 3
    && same(lifecycle.map(record => record.sourceRow).sort((a, b) => a - b), [926, 944, 964])
    && lifecycle.every(record => uuid(record.saleId)) && new Set(lifecycle.map(record => record.saleId)).size === 3,
  'GUARDED_LIFECYCLE_RECEIPTS_REQUIRED');
  const created = new Map(creations.map(record => [record.sourceRow, record]));
  const revised = new Map(lifecycle.map(record => [record.sourceRow, record]));
  const records = payload.records.map(record => {
    const { customerCandidateKey, interestCandidateKey, newBookingCandidateKey, ...resolved } = clone(record);
    if (created.has(record.sourceRow)) {
      check(record.customerId === null && record.interestId === null && record.route === 'source_bound_creation_review',
        'CREATION_RECEIPT_SOURCE_CONFLICT');
      Object.assign(resolved, { customerId: created.get(record.sourceRow).customerId, interestId: created.get(record.sourceRow).interestId });
    }
    if (revised.has(record.sourceRow)) {
      check(record.saleId === null ? record.sourceRow === 964 && record.route === 'historical_booking_review'
        : record.saleId === revised.get(record.sourceRow).saleId, 'LIFECYCLE_RECEIPT_SOURCE_CONFLICT');
      resolved.saleId = revised.get(record.sourceRow).saleId;
    }
    check(uuid(resolved.customerId) && (resolved.interestId === null || uuid(resolved.interestId))
      && (resolved.saleId === null || uuid(resolved.saleId)), 'RESOLVED_CANONICAL_IDS_REQUIRED');
    return resolved;
  });
  check(new Set(records.map(record => record.customerId)).size === 957
    && new Set(records.filter(record => record.interestId).map(record => record.interestId)).size === 948
    && new Set(records.filter(record => record.saleId).map(record => record.saleId)).size === 298, 'RESOLVED_MEMBERSHIP_COUNTS_REQUIRED');
  return { ...clone(payload), records };
}

// Run only after the reviewed adapter relations are installed. The caller owns connection/auth and backup handling.
export function fullCanonicalCaptureQuery(purpose = 'production-target') {
  check(['production-target', 'owned-fixture'].includes(purpose), 'CAPTURE_PURPOSE_REQUIRED');
  const relationNames = { customers: 'public.sales_customers', interests: 'public.lead_project_interests', sales: 'public.sales',
    plots: 'public.plots', details: 'sales_private.deal_details_corrections', forecast: 'sales_import_private.forecast_corrections' };
  return `SELECT jsonb_build_object('version','full-canonical-before-capture-v1','projectId','kbthmdedilswdmmczfay',
 'purpose','${purpose}','capturedAt',clock_timestamp(),
 'relationColumns',jsonb_build_object(${Object.entries(relationNames).map(([key, table]) =>
    `'${key}',(SELECT jsonb_agg(attname ORDER BY attnum) FROM pg_attribute WHERE attrelid='${table}'::regclass AND attnum>0 AND NOT attisdropped)`).join(',')}),
 'counts',jsonb_build_object(${Object.entries(relationNames).map(([key, table]) => `'${key}',(SELECT count(*) FROM ${table})`).join(',')}),
 ${Object.entries(relationNames).map(([key, table]) => `'${key}',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY ${['details', 'forecast'].includes(key) ? 'sale_id' : 'id'}),'[]'::jsonb) FROM ${table} x)`).join(',')},
 'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',user_id,'role',role,'active',is_active) ORDER BY user_id),'[]'::jsonb) FROM sales_private.crm_user_roles),
 'projects',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',name,'is_closed',is_closed) ORDER BY name),'[]'::jsonb) FROM public.projects),
 'sourceBatches',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id) ORDER BY id),'[]'::jsonb) FROM crm_external_private.snapshot_batches));`;
}
