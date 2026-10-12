// Private, owned-loopback RELATIONAL MODEL; no Supabase connection or real writer.
// Captured relationships are real evidence. All seeded financial state is SYNTHETIC.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { workspacePath } from '../sales-import/review-workbook.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const hex = value => typeof value === 'string' && /^[a-f\d]{64}$/.test(value);
const day = value => typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const exact = (object, keys) => object && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object,key));
const rowKeys = ['sourceRow','sourceKey','rowSha256','customerPartitionKey','customerId','interestId','saleId','newBookingCandidateKey',
  'sourceStage','priorStage','projectName','plotId','sourceSalesOwnerUserId','sourceHistory','salePrice','pricePolicy','expectedTransferDate',
  'forecastPolicy','mortgageNoteHash','structuredBank','bankPolicy','actualTimestamps','actualTimestampPolicy','customerOwnerPolicy',
  'interestOwnerPolicy','action','holds','sourceIssuesRetained','disposition','leadReplayAllowed','canonicalWritesAllowed'];
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
function rejectIf(condition) { if (condition) throw new Error('COMBINED_TRIAL_PLAN_INVALID'); }

export function validateCombinedPlan(plan) {
  const { combinedPlanDigest, ...body } = plan ?? {};
  rejectIf(plan?.version !== 'customer-combined-plan-v1' || !hex(combinedPlanDigest) || digest(body) !== combinedPlanDigest
    || !day(plan.inspectionDate) || !hex(plan.sourceSha256) || plan.trialOnly !== true || plan.canonicalImportReady !== false
    || plan.businessWritesAllowed !== false || plan.lostChangesAllowed !== false || plan.productionChanged !== false
    || plan.customerNamesIncluded !== false || plan.phoneValuesIncluded !== false
    || plan.baseline?.financialAndDateStateCaptured !== false || !Array.isArray(plan.rows) || !plan.rows.length || plan.rows.length > 49999);
  const b = plan.baseline;
  const specifications = [ ['roles',['userId','role','isActive']], ['plots',['id','projectName']],
    ['customers',['id','nameHash','ownerUserId']], ['interests',['id','customerId','projectName','ownerUserId']],
    ['sales',['id','customerId','interestId','plotId','stage','projectName','sourceBookingKey']] ];
  for (const [key, keys] of specifications) rejectIf(!Array.isArray(b[key]) || b[key].length > 50000
    || b[key].some(row => !exact(row,keys)) || new Set(b[key].map(row => row.id ?? row.userId)).size !== b[key].length);
  const roles = new Map(b.roles.map(row => [row.userId,row]));
  const customers = new Map(b.customers.map(row => [row.id,row]));
  const interests = new Map(b.interests.map(row => [row.id,row]));
  const plots = new Map(b.plots.map(row => [row.id,row]));
  const sales = new Map(b.sales.map(row => [row.id,row]));
  rejectIf(b.roles.some(row => !uuid(row.userId) || !text(row.role) || typeof row.isActive !== 'boolean')
    || b.plots.some(row => !text(row.id) || !text(row.projectName))
    || b.customers.some(row => !uuid(row.id) || !hex(row.nameHash) || !roles.has(row.ownerUserId))
    || b.interests.some(row => !uuid(row.id) || !customers.has(row.customerId) || !roles.has(row.ownerUserId) || !text(row.projectName))
    || new Set(b.interests.map(row => JSON.stringify([row.customerId,row.projectName]))).size !== b.interests.length
    || b.sales.some(row => !uuid(row.id) || !hex(row.sourceBookingKey) || !['booked','transferred','cancelled'].includes(row.stage)
      || interests.get(row.interestId)?.customerId !== row.customerId || interests.get(row.interestId)?.projectName !== row.projectName
      || plots.get(row.plotId)?.projectName !== row.projectName));
  const claims = new Set();
  for (const row of plan.rows) {
    rejectIf(!exact(row,rowKeys) || !Number.isSafeInteger(row.sourceRow) || row.sourceRow < 2 || row.sourceRow > 50000
      || !hex(row.sourceKey) || !hex(row.rowSha256) || !hex(row.customerPartitionKey) || !hex(row.mortgageNoteHash)
      || !['visited','booked','transferred','cancelled','unclassified'].includes(row.sourceStage)
      || !Array.isArray(row.holds) || !Array.isArray(row.sourceIssuesRetained)
      || [...row.holds,...row.sourceIssuesRetained].some(code => !/^[A-Z_]+$/.test(code))
      || !['held','relational_rehearsal_candidate'].includes(row.disposition)
      || (row.holds.length > 0) !== (row.disposition === 'held') || row.canonicalWritesAllowed !== false || row.leadReplayAllowed !== false
      || row.structuredBank !== null || row.bankPolicy !== 'preserve_existing_no_inference_from_note'
      || row.actualTimestamps !== null || row.actualTimestampPolicy !== 'source_day_precision_only_no_synthetic_timestamp'
      || row.customerOwnerPolicy !== 'preserve_existing' || row.interestOwnerPolicy !== 'preserve_existing'
      || (row.salePrice !== null && (!Number.isFinite(row.salePrice) || row.salePrice < 0))
      || row.pricePolicy !== (row.salePrice === null ? 'unknown_preserve_existing' : 'propose_source_value')
      || (row.expectedTransferDate !== null && !day(row.expectedTransferDate))
      || row.forecastPolicy !== (row.expectedTransferDate === null ? 'unknown_preserve_existing' : 'per_booking_forecast')
      || !Array.isArray(row.sourceHistory) || row.sourceHistory.some(event => !exact(event,['kind','date','precision'])
        || !['visited','booked','transferred','cancelled'].includes(event.kind)
        || (event.date === null ? event.precision !== 'unknown' : !day(event.date) || event.date > plan.inspectionDate || event.precision !== 'day')));
    if (row.disposition === 'held') continue;
    rejectIf(!uuid(row.customerId) || !uuid(row.interestId) || interests.get(row.interestId)?.customerId !== row.customerId
      || interests.get(row.interestId)?.projectName !== row.projectName || roles.get(row.sourceSalesOwnerUserId)?.role !== 'sales'
      || roles.get(row.sourceSalesOwnerUserId)?.isActive !== true);
    if (row.sourceStage === 'visited') {
      rejectIf(row.saleId !== null || row.newBookingCandidateKey !== null || row.action !== 'retain_customer_and_visit_history');
    } else {
      rejectIf(plots.get(row.plotId)?.projectName !== row.projectName);
      if (row.saleId) {
        const sale = sales.get(row.saleId);
        rejectIf(!sale || sale.customerId !== row.customerId || sale.interestId !== row.interestId || sale.plotId !== row.plotId
          || sale.stage !== row.priorStage || row.newBookingCandidateKey !== null
          || !['retain_existing_booking_history','propose_existing_booking_revision'].includes(row.action)
          || (row.action === 'retain_existing_booking_history' && row.sourceStage !== row.priorStage));
      } else rejectIf(row.action !== 'propose_new_booking_for_existing_customer' || row.sourceStage !== 'booked'
        || row.priorStage !== null || row.newBookingCandidateKey !== digest([plan.sourceSha256,'booking',row.sourceRow]));
      const claim = row.saleId ?? row.newBookingCandidateKey;
      rejectIf(claims.has(claim)); claims.add(claim);
    }
  }
  rejectIf(new Set(plan.rows.map(row => row.sourceRow)).size !== plan.rows.length
    || new Set(plan.rows.map(row => row.sourceKey)).size !== plan.rows.length
    || plan.counts.sourceRows !== plan.rows.length
    || plan.counts.candidates !== plan.rows.filter(row => row.disposition !== 'held').length
    || plan.counts.heldRows !== plan.rows.filter(row => row.disposition === 'held').length
    || plan.counts.existingBookingRevisions !== plan.rows.filter(row => row.disposition !== 'held' && row.action === 'propose_existing_booking_revision').length
    || plan.counts.newBookingCandidates !== plan.rows.filter(row => row.disposition !== 'held' && row.newBookingCandidateKey).length
    || plan.counts.bankUpdates !== 0 || plan.counts.syntheticLeads !== 0);
  const partRows = [], partKeys = new Set(), personClaims = new Map();
  for (const part of plan.identityPartitions) {
    rejectIf(!exact(part,['sourceRows','candidateKey']) || !hex(part.candidateKey) || partKeys.has(part.candidateKey));
    partKeys.add(part.candidateKey);
    for (const sourceRow of part.sourceRows) {
      const row = plan.rows.find(row => row.sourceRow === sourceRow);
      rejectIf(!row || row.customerPartitionKey !== part.candidateKey);
      partRows.push(sourceRow);
      if (row.customerId) {
        rejectIf(personClaims.has(row.customerId) && personClaims.get(row.customerId) !== part.candidateKey);
        personClaims.set(row.customerId,part.candidateKey);
      }
    }
  }
  rejectIf(partRows.length !== plan.rows.length || new Set(partRows).size !== plan.rows.length);
  return plan;
}

export async function runCustomerCombinedTrial({ query, root, report, planPath }) {
  const path = workspacePath(planPath);
  if (statSync(path).size > 12 * 1024 * 1024) throw new Error('COMBINED_PLAN_TOO_LARGE');
  const bytes = readFileSync(path), plan = validateCombinedPlan(JSON.parse(bytes));
  const files = [planPath,'scripts/sales-runtime/customer-combined-trial.mjs','sql/sales/runtime/fixtures/customer-combined-trial.sql'];
  for (const file of files) report.sources[file] = hash(readFileSync(`${root}/${file}`));
  const checks = [], check = (ok,label) => { if (!ok) throw new Error(`COMBINED_TRIAL_CHECK_FAILED: ${label}`); checks.push(label); };
  const deny = async (sql,label,reason) => { let denied = false; try { await query(sql); } catch (error) { denied = reason.test(error.message); } check(denied,label); };
  const business = () => query(`SELECT jsonb_build_object('customers',to_regclass('public.sales_customers'),'interests',to_regclass('public.lead_project_interests'),
    'leads',(SELECT count(*) FROM public.leads),'sales',(SELECT count(*) FROM public.sales),'plots',(SELECT count(*) FROM public.plots));`);
  const publicBefore = await business();
  await query(readFileSync(`${root}/sql/sales/runtime/fixtures/customer-combined-trial.sql`,'utf8'));
  const b = plan.baseline, json = value => `${q(JSON.stringify(value))}::jsonb`;
  await query(`BEGIN;
    INSERT INTO customer_combined_trial.roles SELECT (r->>'userId')::uuid,r->>'role',(r->>'isActive')::boolean FROM jsonb_array_elements(${json(b.roles)}) r;
    INSERT INTO customer_combined_trial.customers SELECT (r->>'id')::uuid,r->>'nameHash',(r->>'ownerUserId')::uuid FROM jsonb_array_elements(${json(b.customers)}) r;
    INSERT INTO customer_combined_trial.interests SELECT (r->>'id')::uuid,(r->>'customerId')::uuid,r->>'projectName',(r->>'ownerUserId')::uuid FROM jsonb_array_elements(${json(b.interests)}) r;
    INSERT INTO customer_combined_trial.plots SELECT r->>'id',r->>'projectName' FROM jsonb_array_elements(${json(b.plots)}) r;
    INSERT INTO customer_combined_trial.sales SELECT (r->>'id')::uuid,(r->>'customerId')::uuid,(r->>'interestId')::uuid,r->>'projectName',r->>'plotId',r->>'stage',
      777777,'2001-01-01'::date,'SYNTHETIC_BANK_SENTINEL',NULL FROM jsonb_array_elements(${json(b.sales)}) r;
    COMMIT;`);
  const snapshot = () => query(`SELECT md5(jsonb_build_object('customers',(SELECT jsonb_agg(t ORDER BY id) FROM customer_combined_trial.customers t),
    'interests',(SELECT jsonb_agg(t ORDER BY id) FROM customer_combined_trial.interests t),
    'sales',(SELECT jsonb_agg(t ORDER BY id) FROM customer_combined_trial.sales t),
    'receipts',(SELECT jsonb_agg(t ORDER BY source_hash) FROM customer_combined_trial.receipts t),
    'rows',(SELECT jsonb_agg(t ORDER BY source_row) FROM customer_combined_trial.source_rows t),
    'history',(SELECT jsonb_agg(t ORDER BY source_row,sequence) FROM customer_combined_trial.history t))::text);`);
  const apply = p => `SELECT customer_combined_trial.apply_plan(${json(p)});`;
  const before = await snapshot();
  const invalid = structuredClone(plan), last = invalid.rows.findLast(row => row.disposition !== 'held' && row.sourceHistory.length);
  last.sourceHistory.at(-1).precision = 'invalid_final_event';
  await deny(apply(invalid),'last candidate event failure rejects whole transaction',/violates check constraint "history_check/);
  check(await snapshot() === before,'late failure leaves no partial sale, cancellation, forecast, row or receipt');
  // Simulate newly changed full occupancy AFTER captured evidence, including transferred plots.
  const newRow = plan.rows.find(row => row.disposition !== 'held' && row.newBookingCandidateKey);
  if (newRow) {
    await query(`BEGIN; INSERT INTO customer_combined_trial.sales(id,customer_id,interest_id,project_name,plot_id,stage)
      VALUES('11111111-1111-4111-8111-111111111111',${q(newRow.customerId)}::uuid,${q(newRow.interestId)}::uuid,${q(newRow.projectName)},${q(newRow.plotId)},'transferred'); COMMIT;`);
    const occupiedBefore = await snapshot();
    await deny(apply(plan),'newly occupied transferred plot blocks proposed booking',/violates unique constraint "combined_active_plot"/);
    check(await snapshot() === occupiedBefore,'occupancy race rolls back every preceding change');
    await query("DELETE FROM customer_combined_trial.sales WHERE id='11111111-1111-4111-8111-111111111111';");
  }
  const roleRow = plan.rows.find(row => row.disposition !== 'held');
  await query(`UPDATE customer_combined_trial.roles SET active=false WHERE id=${q(roleRow.sourceSalesOwnerUserId)}::uuid;`);
  await deny(apply(plan),'deactivated Sales owner blocks candidates',/CANDIDATE BINDING OR ROLE CHANGED/);
  check(await snapshot() === before,'role failure does not write modeled business state');
  await query(`UPDATE customer_combined_trial.roles SET active=true WHERE id=${q(roleRow.sourceSalesOwnerUserId)}::uuid;`);
  check(await query(apply(plan)) === 'applied_private_trial','full combined private rehearsal applied');
  const actual = JSON.parse(await query(`SELECT jsonb_build_object(
    'customers',(SELECT jsonb_agg(t ORDER BY id) FROM customer_combined_trial.customers t),
    'interests',(SELECT jsonb_agg(t ORDER BY id) FROM customer_combined_trial.interests t),
    'sales',(SELECT jsonb_agg(t ORDER BY id) FROM customer_combined_trial.sales t),
    'rows',(SELECT jsonb_agg(t ORDER BY source_row) FROM customer_combined_trial.source_rows t),
    'history',(SELECT jsonb_agg(t ORDER BY source_row,sequence) FROM customer_combined_trial.history t));`));
  const candidates = plan.rows.filter(row => row.disposition !== 'held'), appliedSales = new Map(actual.sales.map(row => [row.id,row]));
  check(actual.customers.length === b.customers.length,'no new or duplicate customers created');
  check(actual.interests.length === b.interests.length,'no new or duplicate project interests created');
  check(actual.sales.length === b.sales.length + plan.counts.newBookingCandidates,'only reviewed new booking candidate adds one private sale');
  check(actual.rows.length === plan.rows.length && actual.rows.every((r,i) => isDeepStrictEqual(r.payload,plan.rows[i])
    && r.source_row === plan.rows[i].sourceRow && r.source_hash === plan.sourceSha256), 'all source rows accounted for exactly once with exact payload parity');
  check(actual.rows.every(r => (r.sale_id === null) === (r.payload.disposition === 'held' || r.payload.sourceStage === 'visited')),'held or visit-only rows make no sale binding');
  check(candidates.every(row => row.sourceStage === 'visited' || (() => {
    const sale = appliedSales.get(row.saleId ?? row.newBookingCandidateKey.slice(0,32).replace(/^(........)(....)(....)(....)(............)$/,'$1-$2-$3-$4-$5'));
    return sale && sale.customer_id === row.customerId && sale.interest_id === row.interestId && sale.plot_id === row.plotId && sale.stage === row.sourceStage;
  })()),'every candidate preserves exact Customer Interest Sale plot and proposed stage');
  check(b.customers.every(row => actual.customers.some(c => c.id === row.id && c.owner_id === row.ownerUserId && c.name_hash === row.nameHash)),'global customer owner and name fingerprints preserved');
  check(b.interests.every(row => actual.interests.some(i => i.id === row.id && i.owner_id === row.ownerUserId && i.customer_id === row.customerId && i.project_name === row.projectName)),'project owner and interest identity preserved');
  for (const [field,key,sentinel] of [['price','salePrice',777777],['forecast','expectedTransferDate','2001-01-01']]) {
    check(candidates.filter(row => row.saleId && row[key] !== null).every(row => appliedSales.get(row.saleId)[field] === row[key]),`known source ${field} matches per sale`);
    check(candidates.filter(row => row.saleId && row[key] === null).every(row => appliedSales.get(row.saleId)[field] === sentinel),`unknown ${field} preserves synthetic existing state`);
  }
  check(b.sales.every(row => appliedSales.get(row.id).bank === 'SYNTHETIC_BANK_SENTINEL'),'bank state preserved; notes never interpreted as bank selection');
  check(actual.sales.every(row => row.actual_timestamp === null),'no operational timestamps manufactured from forecast or historical day');
  const expectedHistory = candidates.flatMap(row => row.sourceHistory.map((e,i) => ({source_row:row.sourceRow,sequence:i+1,kind:e.kind,occurred_day:e.date,precision:e.precision})));
  check(actual.history.length === expectedHistory.length && actual.history.every((h,i) => Object.entries(expectedHistory[i]).every(([k,v]) => h[k] === v)),'every candidate historical day and unknown precision preserved');
  const candidateSaleIds = new Set(candidates.filter(row => row.saleId).map(row => row.saleId));
  check(b.sales.filter(row => !candidateSaleIds.has(row.id)).every(row => {
    const sale = appliedSales.get(row.id); return sale.stage === row.stage && sale.price === 777777 && sale.forecast === '2001-01-01';
  }),'held and otherwise untouched existing deals remain unchanged');
  const n001 = plan.identityPartitions.find(part => part.sourceRows.includes(3) && part.sourceRows.includes(193));
  if (n001) {
    const related = n001.sourceRows.map(n => plan.rows.find(r => r.sourceRow === n));
    check(new Set(related.map(r => r.customerId)).size === 1 && new Set(related.map(r => r.saleId)).size === 2
      && related.every(r => appliedSales.get(r.saleId).stage === r.sourceStage),'N001 remains one customer two separate transferred/cancelled sales');
  }
  const after = await snapshot();
  check(await query(apply(plan)) === 'already_applied' && await snapshot() === after,'exact replay is idempotent across every modeled table');
  const altered = structuredClone(plan); altered.rows[0].expectedTransferDate = '2030-01-01';
  await deny(apply(altered),'same source and receipt with altered payload denied',/REPLAY PAYLOAD CHANGED/);
  check(await snapshot() === after,'altered replay cannot change data');
  for (const role of ['anon','authenticated']) {
    await deny(`SET ROLE ${role}; SELECT * FROM customer_combined_trial.sales;`,`${role} cannot read private fixture data`,/permission denied for schema customer_combined_trial/);
    await deny(`SET ROLE ${role}; ${apply(plan)}`,`${role} cannot invoke private fixture importer`,/permission denied for schema customer_combined_trial/);
  }
  check(await query("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='customer_combined_trial' AND c.relkind='r' AND NOT c.relrowsecurity;") === '0','all private fixture tables have RLS enabled');
  check(await business() === publicBefore,'public business facade unchanged; no Lead replay or public canonical writer');
  check(readFileSync(path).equals(bytes),'pinned plan bytes unchanged during trial');
  return { model:'private relational rehearsal; not production import guards or authenticated writer', assertions:checks.length,checks,
    sourceRows:plan.rows.length,candidates:candidates.length,held:plan.counts.heldRows,historyEvents:expectedHistory.length,
    customers:b.customers.length,interests:b.interests.length,existingSales:b.sales.length,newPrivateSales:plan.counts.newBookingCandidates,
    financialBaseline:'SYNTHETIC price 777777, forecast 2001-01-01 and bank sentinel; NOT captured live financial state',
    sourceSha256:plan.sourceSha256,combinedPlanDigest:plan.combinedPlanDigest,
    productionChanged:false,canonicalImportReady:false,freshLiveOccupancyAndRoleRecheckRequired:true };
}
