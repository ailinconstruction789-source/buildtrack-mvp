import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadFullCanonicalSource, prepareFullCanonicalPayload, finalizeFullCanonicalMembership,
  fullCanonicalCaptureQuery } from './prepare-full-canonical-payload.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const source = loadFullCanonicalSource();
const snapshot = JSON.parse(readFileSync('reports/customer-replacement-live-reference-2026-10-10.json'));
const catalog = JSON.parse(readFileSync('node_modules/.cache/buildtrack-sales-runtime/live-catalog-2026-10-11.json'));
const columns = name => catalog.tables.find(table => table.schema === 'public' && table.name === name).columns.map(column => column.name);
// Exact captured keys plus explicit additions from SQL21/27/28. Values below are binder fixtures, never an SQL seed.
const fullRow = (name, additions, values) => ({ ...Object.fromEntries([...columns(name), ...additions].map(key => [key, null])), ...values });
const correction = (sale, sale_price, bank_name = null) => ({ sale_id: sale.id, sale_price, bank_name,
  revision: 'ae000000-0000-4000-8000-000000000001', actor_user_id: snapshot.roles[0].id,
  reason: 'SYNTHETIC correction', recorded_at: '2026-10-11T00:00:00Z' });
const forecast = (sale_id, expected_transfer_date, index = 0) => ({ sale_id, expected_transfer_date,
  revision: `af00000${index}-0000-4000-8000-000000000001`, batch_id: 'aa000000-0000-4000-8000-000000000001',
  reviewer_id: 'aa000000-0000-4000-8000-000000000002', recorded_at: '2026-10-11T00:00:00Z' });
const fixture = () => {
  const customers = snapshot.customers.map(row => fullRow('sales_customers', ['supplemental_creation_id'], { id: row.id, customer_name: 'SYNTHETIC fixture name',
    record_origin: 'legacy_import', owner_user_id: row.ownerId, lifecycle_revision: row.revision,
    merged_into_customer_id: row.mergedIntoId, external_snapshot_batch_id: row.sourceBatchId,
    external_customer_key: row.sourceKey, supplemental_creation_id: null }));
  const customerIds = new Map(customers.map(row => [row.id, row]));
  const interests = snapshot.interests.map(row => fullRow('lead_project_interests', ['supplemental_creation_id'], { id: row.id, customer_id: row.customerId, project_name: row.projectName,
    owner_user_id: row.ownerId, lifecycle_revision: row.revision,
    external_interest_key: row.sourceKey, external_snapshot_batch_id: customerIds.get(row.customerId).external_snapshot_batch_id,
    supplemental_creation_id: null }));
  const sales = snapshot.sales.map(row => fullRow('sales', ['crm_transfer_date', 'crm_handover_date', 'historical_import_id', 'historical_revision_id'], { id: row.id, project_interest_id: row.interestId, plot_id: row.plotId,
    crm_stage: row.stage, booking_revision: row.revision, external_booking_id: row.sourceBookingId,
    sale_price: row.price, bank_name: row.bank, payment_method: row.paymentMethod,
    expected_transfer_date: row.expectedTransferDate, lead_id: row.leadId, historical_import_id: null, historical_revision_id: null }));
  const plots = snapshot.plots.map(row => fullRow('plots', [], { id: row.id, project_name: row.projectName,
    has_customer: row.occupied, sale_status: row.saleStatus, plot_name: 'SYNTHETIC fixture plot' }));
  return { version: 'full-canonical-before-capture-v1', projectId: snapshot.projectId, capturedAt: '2026-10-11T00:00:00.000Z',
    purpose: 'owned-fixture', customers, interests, sales, plots, details: [], forecast: [],
    relationColumns: { customers: Object.keys(customers[0]), interests: Object.keys(interests[0]), sales: Object.keys(sales[0]),
      plots: Object.keys(plots[0]), details: ['sale_id', 'sale_price', 'bank_name', 'revision', 'actor_user_id', 'reason', 'recorded_at'],
      forecast: ['sale_id', 'expected_transfer_date', 'revision', 'batch_id', 'reviewer_id', 'recorded_at'] },
    counts: { customers: customers.length, interests: interests.length, sales: sales.length, plots: plots.length, details: 0, forecast: 0 },
    roles: structuredClone(snapshot.roles), projects: structuredClone(snapshot.projects), sourceBatches: structuredClone(snapshot.sourceBatches) };
};
const prepare = capture => prepareFullCanonicalPayload({ source, capture });
const prepared = prepare(fixture());
const sourceRow = n => source.manifest.records.find(row => row.sourceRow === n);
const generated = (n, kind) => `fe${kind}${String(n).padStart(4, '0')}-0000-4000-8000-000000000001`;
const receipts = () => ({
  creationResult: { bindings: [438, 439, 440, 444, 680, 894].map(sourceRow => ({ sourceRow,
    customerId: generated(sourceRow, '01'), interestId: generated(sourceRow, '02') })) },
  lifecycleResult: { bindings: [926, 944, 964].map(sourceRow => ({ sourceRow,
    saleId: sourceRow === 964 ? generated(sourceRow, '03') : source.manifest.records.find(row => row.sourceRow === sourceRow).binding.saleId })) },
});

test('interest mismatch reports only source row and failed proof fields without relaxing binding', () => {
  const capture = fixture(), record = source.manifest.records.find(row => row.binding.interestId);
  const interest = capture.interests.find(row => row.id === record.binding.interestId);
  interest.project_name = 'SYNTHETIC unexpected project';
  assert.throws(() => prepare(capture), error => {
    assert.equal(error.message, `CAPTURE_INTEREST_BINDING_CHANGED:sourceRow=${record.sourceRow}:fields=project`);
    assert(!error.message.includes(interest.project_name)); assert(!error.message.includes(interest.id)); return true;
  });
});

test('verified source re-extracts979rows and retains958names onlyinmemory', () => {
  assert.equal(source.sourceRowsReextracted, 979); assert.equal(source.personalData.length, 958);
  assert.equal(source.personalData.find(row => row.sourceRow === 680).customerName, 'ไม่ทราบ');
  assert.equal(source.manifest.rawPersonalDataIncluded, false);
});
test('whole payload bindsall958approvedrows without claiming executionor recovery', () => {
  assert.equal(prepared.membership.records.length, 958);
  assert.equal(prepared.summary.projectedCustomerIds, 957); assert.equal(prepared.summary.projectedInterestIds, 948);
  assert.equal(prepared.expectedSales.length, 298);
  assert.equal(prepared.summary.productionChanged, false); assert.equal(prepared.summary.canonicalActivationComplete, false);
  assert.equal(prepared.summary.recoveryRehearsalComplete, false); assert.equal(prepared.summary.purpose, 'owned-fixture');
});
test('before-image fixtures use actual catalog keys and only documented adapter additions', () => {
  const capture = fixture();
  assert.deepEqual(capture.relationColumns.interests, [...columns('lead_project_interests'), 'supplemental_creation_id']);
  assert(!capture.relationColumns.interests.includes('record_origin'));
  assert.deepEqual(capture.relationColumns.customers, [...columns('sales_customers'), 'supplemental_creation_id']);
  assert.deepEqual(capture.relationColumns.sales, [...columns('sales'), 'crm_transfer_date', 'crm_handover_date',
    'historical_import_id', 'historical_revision_id']);
  assert.deepEqual(capture.relationColumns.plots, columns('plots'));
  assert.equal(capture.relationColumns.details.length, 7); assert.equal(capture.relationColumns.forecast.length, 6);
});
test('nullable actual project closure remains NULL and follows SQL IS DISTINCT FROM true open rule', () => {
  const capture = fixture(); capture.projects.find(project => project.name === sourceRow(438).projectName).is_closed = null;
  assert.equal(prepare(capture).creation.records.length, 6);
  assert(fullCanonicalCaptureQuery().includes("'is_closed',is_closed"));
});
test('nullable available plot occupancy is preserved in exact before-image and treated as unoccupied by SQL28', () => {
  const capture = fixture(); capture.plots.find(plot => plot.id === sourceRow(964).binding.plotId).has_customer = null;
  const result = prepare(capture);
  assert.equal(result.lifecycle.records.find(record => record.sourceRow === 964).before.plot.has_customer, null);
});
test('forty-two P forecasts comprise41existing correctionsand964newbooking withoutactualtransfer fields', () => {
  assert.equal(prepared.details.records.length, 41); assert.equal(prepared.summary.knownSourceForecasts, 42);
  assert.equal(prepared.lifecycle.records.find(row => row.sourceRow === 964).patch.expectedTransferDate, '2026-10-30');
  assert(prepared.details.records.every(row => Object.keys(row.patch).sort().join(',') === 'expectedTransferDate,salePriceSatang,sourceStage'));
});
test('33 completedforecasts carrynullprice whilefiveapprovedpricedetails remain satang', () => {
  const completed = prepared.details.records.filter(row => row.patch.sourceStage === 'transferred');
  assert.equal(completed.length, 33); assert(completed.every(row => row.patch.salePriceSatang === null));
  assert.deepEqual(prepared.details.records.filter(row => row.patch.salePriceSatang !== null).map(row => row.sourceRow), [706, 881, 937, 939, 952]);
});
test('SQL28exactbefore images captureallplotSales sortedand fullconstruction columns', () => {
  const capture = fixture();
  for (const row of prepared.lifecycle.records) {
    assert.deepEqual(row.before.inventory, capture.sales.filter(sale => sale.plot_id === row.binding.plotId).sort((a,b) => a.id.localeCompare(b.id)));
    assert.equal(row.before.plot.plot_name, 'SYNTHETIC fixture plot');
    assert.deepEqual(Object.keys(row.before).sort(), ['customer', 'details', 'forecast', 'interest', 'inventory', 'plot', 'sale']);
    assert(row.history.every(event => Object.keys(event).sort().join(',') === 'date,kind,precision'));
  }
});
test('926944 cancellation civil days and964unknownpayment preserved', () => {
  assert.deepEqual(prepared.lifecycle.records.filter(row => row.operation === 'cancel').map(row => [row.sourceRow,row.patch.cancelledDate]),
    [[926, '2026-10-07'], [944, '2026-10-07']]);
  const expected = prepared.expectedSales.find(row => row.sourceRow === 964);
  assert.equal(expected.bank, null); assert.equal(expected.paymentMethod, null); assert.equal(expected.priceSatang, 264300000);
});
test('all11unknown histories preserve knownandunknownprecision withnoinvented Sale', () => {
  assert.equal(prepared.unknown.records.length, 11);
  assert(prepared.unknown.records.every(row => row.saleId === null));
  assert.equal(prepared.unknown.records.filter(row => row.reason === 'unknown_project' && row.interestId === null).length, 10);
  const row171 = prepared.unknown.records.find(row => row.rowNumber === 171);
  assert.equal(row171.reason, 'unknown_booking'); assert(row171.interestId);
  assert.deepEqual(row171.events.map(({kind,date,precision}) => ({kind,date,precision})),
    sourceRow(171).history.map(({kind,date,precision}) => ({kind,date,precision})));
});
test('oneN001Customer keepsdifferentcancelled/transferred dealsand sourcechronology remains unedited', () => {
  const rows = prepared.membership.records;
  assert.equal(rows.find(row => row.sourceRow === 3).customerId, rows.find(row => row.sourceRow === 193).customerId);
  assert.notEqual(rows.find(row => row.sourceRow === 3).saleId, rows.find(row => row.sourceRow === 193).saleId);
  assert.deepEqual(prepared.summary.chronologyReviewRows, [63, 175]);
  assert.deepEqual(rows.find(row => row.sourceRow === 63).history, sourceRow(63).history);
});
test('no excludedrental orheldidentity entersmembership; originalarchive batch stays explicitlyscoped', () => {
  const excluded = [...prepared.membership.exclusions.rentalSourceRows, ...prepared.membership.exclusions.heldIdentitySourceRows];
  assert.equal(excluded.length, 21); assert(prepared.membership.records.every(row => !excluded.includes(row.sourceRow)));
  assert.deepEqual(prepared.membership.originalSourceBatchIds, ['5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5']);
});
test('effective explicitNULLbank correctionandunknownforecast arepreserved withoutnotes inference', () => {
  const capture = fixture(), sale = capture.sales.find(row => row.id === sourceRow(662).binding.saleId);
  sale.bank_name = null;
  capture.details.push(correction(sale, sale.sale_price + 1)); capture.counts.details = 1;
  const result = prepare(capture), expected = result.expectedSales.find(row => row.sourceRow === 662);
  assert.equal(expected.bank, null); assert.equal(expected.priceSatang, Math.round((sale.sale_price + 1) * 100));
  assert.equal(result.details.records.find(row => row.sourceRow === 662).patch.salePriceSatang, null);
});
test('knownsourceP overrides existing forecastwhile unknownP preservescurrent correction', () => {
  const capture = fixture(), known = sourceRow(662), unknown = sourceRow(2);
  capture.forecast.push(...[known, unknown].map((row,index) => forecast(row.binding.saleId, '2026-12-31', index)));
  capture.counts.forecast = 2;
  const result = prepare(capture);
  assert.equal(result.expectedSales.find(row => row.sourceRow === 662).expectedTransferDate, known.financial.expectedTransferDate);
  assert.equal(result.expectedSales.find(row => row.sourceRow === 2).expectedTransferDate, '2026-12-31');
});
test('reviewed cancellation price overrides prior correction while its explicit NULL bank survives', () => {
  const capture = fixture(), sale = capture.sales.find(row => row.id === sourceRow(926).binding.saleId);
  capture.details.push(correction(sale, sale.sale_price + 1)); capture.counts.details = 1;
  const result = prepare(capture), expected = result.expectedSales.find(row => row.sourceRow === 926);
  assert.equal(expected.priceSatang, sourceRow(926).financial.salePriceSatang);
  assert.equal(expected.bank, null);
});
test('guardedreceipts resolve6newparentsand964newSale to957/948/298 withoutcandidatekeys', () => {
  const result = finalizeFullCanonicalMembership({ payload: prepared.membership, ...receipts() });
  assert.equal(new Set(result.records.map(row => row.customerId)).size, 957);
  assert.equal(new Set(result.records.filter(row => row.interestId).map(row => row.interestId)).size, 948);
  assert.equal(new Set(result.records.filter(row => row.saleId).map(row => row.saleId)).size, 298);
  assert(result.records.every(row => !Object.hasOwn(row, 'customerCandidateKey') && !Object.hasOwn(row, 'newBookingCandidateKey')));
});
test('native futureCustomers outsideoldbatch arekeptinthecaptureand neveraddedtohistoricmembership', () => {
  const capture = fixture(), row = structuredClone(capture.customers[0]);
  row.id = 'bb000000-0000-4000-8000-000000000001'; row.record_origin = 'native';
  row.external_snapshot_batch_id = null; row.external_customer_key = null;
  capture.customers.push(row); capture.counts.customers++;
  const result = prepare(capture);
  assert.equal(result.membership.records.length, 958); assert(!result.membership.records.some(record => record.customerId === row.id));
});
test('purepreparation andreceiptresolutiondo notmutate sourceorfullcapture', () => {
  const capture = fixture(), before = JSON.stringify({ source,capture });
  const a = prepare(capture), b = prepare(capture); assert.deepEqual(a,b);
  finalizeFullCanonicalMembership({ payload:a.membership,...receipts() });
  assert.equal(JSON.stringify({source,capture}),before);
  assert.equal(Object.hasOwn(a.summary, 'customerName'), false);
});

for (const [name, mutate, pattern] of [
  ['old/staleSale revision', capture => { capture.sales.find(row => row.id === sourceRow(2).binding.saleId).booking_revision='bb000000-0000-4000-8000-000000000001'; }, /SALE_BASELINE/],
  ['changedcustomer owner', capture => { capture.customers.find(row => row.id === sourceRow(2).binding.customerId).owner_user_id=capture.roles.find(role=>role.id!==sourceRow(2).preservedCustomerOwnerId&&role.role==='sales').id; }, /CUSTOMER_BINDING/],
  ['mergedcustomer', capture=>{capture.customers.find(row=>row.id===sourceRow(2).binding.customerId).merged_into_customer_id='bb000000-0000-4000-8000-000000000001';}, /CUSTOMER_BINDING/],
  ['changedInterest parent', capture=>{capture.interests.find(row=>row.id===sourceRow(2).binding.interestId).customer_id=capture.customers[0].id;}, /INTEREST_BINDING/],
  ['advancedcancellation baseline', capture=>{capture.sales.find(row=>row.id===sourceRow(926).binding.saleId).crm_stage='contracted';}, /SALE_BASELINE/],
  ['occupiednewbooking', capture=>{capture.plots.find(row=>row.id===sourceRow(964).binding.plotId).has_customer=true;}, /STOCK_CHANGED/],
  ['closedcreation project', capture=>{capture.projects.find(row=>row.name===sourceRow(438).projectName).is_closed=true;}, /OPEN_SOURCE_PROJECT/],
  ['deactivatedmappedSales', capture=>{capture.roles.find(row=>row.id===sourceRow(438).ownerUserId).active=false;}, /SALES_OWNER/],
  ['partialcustomer row', capture=>{delete capture.customers[0].customer_name;}, /FULL_RELATION/],
  ['truncatedSales page', capture=>{capture.sales.pop();}, /FULL_RELATION/],
  ['duplicateplot row', capture=>{capture.plots.push(structuredClone(capture.plots[0]));capture.counts.plots++;}, /FULL_RELATION/],
  ['correctionforunknownSale', capture=>{capture.details.push(correction({id:'bb000000-0000-4000-8000-000000000001'},1));capture.counts.details++;}, /CORRECTION_SALE/],
]) test(name+' isrejectedbeforepayload generation', () => {
  const capture=fixture();mutate(capture);assert.throws(()=>prepare(capture),pattern);
});
test('tampered approvedmanifest cannotbe legitimizedby resealing source wrapper',()=>{
  const changed=structuredClone(source);changed.manifest.records[0].financial.salePriceSatang=1;
  const {fullReplacementInputDigest,...body}=changed.manifest;changed.manifest.fullReplacementInputDigest=hash(body);
  const {sourceVerificationDigest,...sourceBody}=changed;changed.sourceVerificationDigest=hash(sourceBody);
  assert.throws(()=>prepareFullCanonicalPayload({source:changed,capture:fixture()}),/VERIFIED_FULL_SOURCE/);
});
test('tampered rawnamehash cannotbe legitimizedby source wrapperreseal',()=>{
  const changed=structuredClone(source);changed.personalData[0].customerName='changed';
  const {sourceVerificationDigest,...body}=changed;changed.sourceVerificationDigest=hash(body);
  assert.throws(()=>prepareFullCanonicalPayload({source:changed,capture:fixture()}),/SOURCE_NAME_HASH/);
});
for(const [name,mutate,pattern] of [
  ['missingcreation binding',r=>{r.creationResult.bindings.pop();},/CREATION_RECEIPTS/],
  ['collidingnewCustomer',r=>{r.creationResult.bindings[0].customerId=sourceRow(2).binding.customerId;},/MEMBERSHIP_COUNTS/],
  ['changedexistingcancelledSale',r=>{r.lifecycleResult.bindings[0].saleId=generated(926,'03');},/RECEIPT_SOURCE/],
  ['unknown sourceRow',r=>{r.lifecycleResult.bindings[2].sourceRow=965;},/LIFECYCLE_RECEIPTS/],
])test(name+' cannotfinalize authoritativecohort',()=>{
  const r=receipts();mutate(r);assert.throws(()=>finalizeFullCanonicalMembership({payload:prepared.membership,...r}),pattern);
});
test('capturequery isread-only businessscope andpurpose injectionis rejected',()=>{
  const sql=fullCanonicalCaptureQuery();
  assert(sql.startsWith('SELECT'));assert(!/\b(UPDATE|INSERT|DELETE|CREATE|DROP|auth\.users|token|credential)\b/i.test(sql));
  assert(sql.includes('pg_attribute'));assert(sql.includes('deal_details_corrections'));assert(sql.includes('forecast_corrections'));
  assert.throws(()=>fullCanonicalCaptureQuery("';DELETE"),/PURPOSE/);
});
