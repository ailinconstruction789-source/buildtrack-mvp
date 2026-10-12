// Whole approved source rehearsal over the caller's owned actual-catalog DB.
// No connection, credentials, Auth creation, schema installation or remote calls.
// All initial writes run in ONE query/transaction even when query uses psql.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadFullCanonicalSource,prepareFullCanonicalPayload,finalizeFullCanonicalMembership,fullCanonicalCaptureQuery} from '../sales-import/prepare-full-canonical-payload.mjs';
import {loadRentalSourceRetirementInputs,bindRentalSourceRetirementInputs} from '../sales-import/prepare-rental-source-retirement.mjs';
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const sha=v=>createHash('sha256').update(v).digest('hex');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const parse=v=>{if(typeof v==='object'&&v!==null)return v;const lines=String(v).trim().split('\n');for(let n=lines.length-1;n>=0;n--)try{return JSON.parse(lines[n]);}catch{}throw Error('FULL_REPLACEMENT_JSON_RESULT_REQUIRED');};
const flagsSql=`SELECT coalesce(jsonb_agg(to_jsonb(settings_row) ORDER BY settings_row.id),'[]') FROM public.crm_settings settings_row`;
const coreFlags=['central_intake_enabled','lead_work_enabled','lead_lifecycle_enabled','booking_enabled','booking_cutover_reviewed'];
const visitFlags=['visits_enabled','visit_sop_enabled','customer_voices_enabled'];
const claim=(adminId,sessionId)=>`SET LOCAL "request.jwt.claim.sub"=${q(adminId)}; SET LOCAL "request.jwt.claims"=${q(JSON.stringify({sub:adminId,role:'authenticated',session_id:sessionId}))};`;

function pauseAndRestoreSql(flags,batchId){
 assert.equal(flags.length,1,'One full singleton settings capture required');
 const original=flags[0],keys=Object.keys(original).filter(k=>k.endsWith('_enabled')||k==='booking_cutover_reviewed');
 for(const k of keys)assert.equal(typeof original[k],'boolean','Boolean flag required: '+k);
 assert.ok(keys.every(k=>!original[k]||[...coreFlags,...visitFlags].includes(k)),'Existing seal does not authorize restoring other enabled features');
 const visits=visitFlags.map(k=>original[k]);
 assert.ok(visits.every(x=>x===false)||visits.every(x=>x===true),'Mixed visit flags require a separate reviewed activation adapter');
 if(visits.every(Boolean))assert.ok(coreFlags.every(k=>original[k]),'Visit restoration requires an already ready core booking writer');
 if(keys.some(k=>original[k]))assert.ok(uuid(batchId),'Existing reviewed booking release required');
 const down=`UPDATE public.crm_settings SET ${keys.map(k=>`"${k}"=false`).join(',')} WHERE id;`;
 const coreSet=coreFlags.filter(k=>keys.includes(k)).map(k=>`"${k}"=${original[k]}`).join(',');
 const restoreCore=coreFlags.some(k=>original[k])?`INSERT INTO crm_external_private.booking_activation_permits VALUES(txid_current(),pg_backend_pid(),${q(batchId)}::uuid); UPDATE public.crm_settings SET ${coreSet} WHERE id; DELETE FROM crm_external_private.booking_activation_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();`:'';
 const restoreVisits=visits.every(Boolean)?`INSERT INTO crm_external_private.visit_workflow_activation_permits VALUES(txid_current(),pg_backend_pid(),${q(batchId)}::uuid); UPDATE public.crm_settings SET ${visitFlags.map(k=>`"${k}"=true`).join(',')} WHERE id; DELETE FROM crm_external_private.visit_workflow_activation_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();`:'';
 return {down,restore:restoreCore+restoreVisits};
}

export function buildFullReplacementTransaction({capture,payload,source,retirementManifest,retirement,flagRows,flags,reviewReference,actorSql=''}){
 assert.ok(['production-target','owned-fixture'].includes(capture.purpose),'Explicit actual capture purpose required');
 assert.equal(payload.purpose,capture.purpose);assert.equal(payload.membership.records.length,958);
 assert.equal(retirement.records.length,6);assert.ok(typeof actorSql==='string');
 const captureWithoutTime={...capture};delete captureWithoutTime.capturedAt;
 const mainSql=`BEGIN;${actorSql} SET LOCAL lock_timeout='2s'; SET LOCAL timezone='UTC';
 CREATE TEMP TABLE full_replacement_result(value jsonb) ON COMMIT PRESERVE ROWS;
 DO $full_replacement$
 DECLARE run_id uuid; initial jsonb; flags_before jsonb:=${j(flagRows)};
  creation jsonb;unknown_result jsonb;details_result jsonb;revision_result jsonb;retirement_result jsonb;membership_result jsonb;seal_result jsonb;
  membership jsonb:=${j(payload.membership)}; details_payload jsonb:=${j(payload.details)};revision_payload jsonb:=${j(payload.lifecycle)};
  v_record jsonb; binding jsonb; resolved jsonb:='[]'; before_json jsonb; ordinal integer; v_sale public.sales%ROWTYPE; expected jsonb;
 BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
  LOCK TABLE public.sales_customers,public.lead_project_interests,public.sales,public.plots,public.crm_settings IN SHARE ROW EXCLUSIVE MODE;
  ${fullCanonicalCaptureQuery(capture.purpose).replace(/^SELECT /,'SELECT ').replace(/;$/,' INTO initial;')}
  IF initial-'capturedAt' IS DISTINCT FROM ${j(captureWithoutTime)} THEN RAISE EXCEPTION 'FULL_REPLACEMENT_CAPTURE_DRIFT'; END IF;
  IF (${flagsSql}) IS DISTINCT FROM flags_before THEN RAISE EXCEPTION 'FULL_REPLACEMENT_FLAGS_DRIFT'; END IF;
  run_id:=sales_recovery_private.begin_run(${q(reviewReference)});
  ${flags.down}
  creation:=sales_source_creation_private.apply_reviewed(${j(payload.creation)});
  ${flags.restore}
  IF (${flagsSql}) IS DISTINCT FROM flags_before THEN RAISE EXCEPTION 'FULL_REPLACEMENT_FLAGS_NOT_RESTORED'; END IF;
  unknown_result:=sales_unknown_history_private.persist_evidence(${j(payload.unknown)});
  details_result:=sales_import_private.apply_reviewed_details(details_payload);
  -- Refresh only full before-images after the preceding price/P phase. Source
  -- identity, intent, money and date patches remain the approved offline values.
  FOR v_record,ordinal IN SELECT value,(ordinality-1)::integer FROM jsonb_array_elements(revision_payload->'records') WITH ORDINALITY LOOP
   binding:=v_record->'binding';
   SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.sales_customers c WHERE c.id=(binding->>'customerId')::uuid),
    'interest',(SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE i.id=(binding->>'interestId')::uuid),
    'sale',(SELECT to_jsonb(sale) FROM public.sales sale WHERE sale.id=(binding->>'saleId')::uuid),
    'plot',(SELECT to_jsonb(p) FROM public.plots p WHERE p.id=binding->>'plotId'),
    'inventory',(SELECT coalesce(jsonb_agg(to_jsonb(sale) ORDER BY sale.id),'[]') FROM public.sales sale WHERE sale.plot_id=binding->>'plotId'),
    'details',(SELECT to_jsonb(dc) FROM sales_private.deal_details_corrections dc WHERE dc.sale_id=(binding->>'saleId')::uuid),
    'forecast',(SELECT to_jsonb(fc) FROM sales_import_private.forecast_corrections fc WHERE fc.sale_id=(binding->>'saleId')::uuid)) INTO before_json;
   revision_payload:=jsonb_set(revision_payload,ARRAY['records',ordinal::text,'before'],before_json);
  END LOOP;
  revision_result:=sales_revision_private.apply(revision_payload);
  PERFORM rental_source_retirement_private.register_review(${j(retirementManifest)});
  retirement_result:=rental_source_retirement_private.apply(${j(retirement)},${q(reviewReference)});
  FOR v_record IN SELECT value FROM jsonb_array_elements(membership->'records') LOOP
   v_record:=v_record-ARRAY['customerCandidateKey','interestCandidateKey','newBookingCandidateKey'];
   SELECT value INTO binding FROM jsonb_array_elements(creation->'bindings') WHERE value->>'sourceRow'=v_record->>'sourceRow';
   IF binding IS NOT NULL THEN v_record:=v_record||jsonb_build_object('customerId',binding->'customerId','interestId',binding->'interestId'); END IF;
   SELECT value INTO binding FROM jsonb_array_elements(revision_result->'bindings') WHERE value->>'sourceRow'=v_record->>'sourceRow';
   IF binding IS NOT NULL THEN v_record:=v_record||jsonb_build_object('saleId',binding->'saleId'); END IF;
   resolved:=resolved||jsonb_build_array(v_record);
  END LOOP;
  membership:=jsonb_set(membership,'{records}',resolved);
  -- A confirmed shared Customer may have approved source-name aliases across
  -- its two houses. Its sealed canonical name must still be one of that
  -- Customer's approved workbook names; never guess a name-based identity.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(resolved) r JOIN public.sales_customers c ON c.id=(r->>'customerId')::uuid
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(resolved) same_customer JOIN jsonb_array_elements(${j(source.personalData)}) source_name
    ON source_name->>'sourceRow'=same_customer->>'sourceRow'
    WHERE same_customer->>'customerId'=r->>'customerId' AND sales_private.crm_customer_deal_details_trim(c.customer_name)=source_name->>'customerName'))
   THEN RAISE EXCEPTION 'FULL_REPLACEMENT_APPROVED_SOURCE_NAME_PARITY'; END IF;
  membership_result:=customer_source_membership_private.activate(membership,${q(payload.preparedPayloadDigest)},${q(reviewReference)});
  FOR expected IN SELECT value FROM jsonb_array_elements(${j(payload.expectedSales)}) LOOP
   SELECT * INTO STRICT v_sale FROM public.sales WHERE id=(SELECT (r->>'saleId')::uuid FROM jsonb_array_elements(resolved) r WHERE r->>'sourceRow'=expected->>'sourceRow');
   IF v_sale.crm_stage IS DISTINCT FROM expected->>'stage' OR v_sale.plot_id IS DISTINCT FROM expected->>'plotId'
    OR sales_private.crm_effective_sale_price(v_sale.id)*100 IS DISTINCT FROM (expected->>'priceSatang')::numeric
    OR (SELECT CASE WHEN dc.sale_id IS NULL THEN sale.bank_name ELSE dc.bank_name END FROM public.sales sale LEFT JOIN sales_private.deal_details_corrections dc ON dc.sale_id=sale.id WHERE sale.id=v_sale.id) IS DISTINCT FROM expected->>'bank'
    OR sales_import_private.expected_transfer_date(v_sale.id,v_sale.expected_transfer_date::text) IS DISTINCT FROM expected->>'expectedTransferDate'
   THEN RAISE EXCEPTION 'FULL_REPLACEMENT_EFFECTIVE_DEAL_PARITY'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM customer_source_membership_private.members WHERE revision_id=(membership_result->>'revisionId')::uuid)<>958
   OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN LATERAL jsonb_array_elements(resolved) r ON (r->>'sourceRow')::integer=m.source_row
    WHERE m.revision_id=(membership_result->>'revisionId')::uuid AND (m.history IS DISTINCT FROM r->'history' OR m.row_sha256 IS DISTINCT FROM r->>'rowSha256'))
   THEN RAISE EXCEPTION 'FULL_REPLACEMENT_SOURCE_HISTORY_PARITY'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(resolved) r JOIN public.sales sale ON sale.id=(r->>'saleId')::uuid
   WHERE r->>'expectedTransferDate' IS NOT NULL AND sales_import_private.expected_transfer_date(sale.id,sale.expected_transfer_date::text) IS DISTINCT FROM r->>'expectedTransferDate')
   THEN RAISE EXCEPTION 'FULL_REPLACEMENT_ALL42_FORECAST_PARITY'; END IF;
  seal_result:=sales_recovery_private.seal_run(run_id,${q(reviewReference)});
  INSERT INTO full_replacement_result VALUES(jsonb_build_object('runId',run_id,'creation',creation,'unknown',unknown_result,'details',details_result,'revision',revision_result,'retirement',retirement_result,'membership',membership_result,'seal',seal_result));
 END; $full_replacement$;
 COMMIT; SELECT value FROM full_replacement_result;`;
 return {mainSql,bodySql:mainSql.slice(('BEGIN;'+actorSql).length).replace('COMMIT; SELECT value FROM full_replacement_result;','SELECT value FROM full_replacement_result;')};
}

export async function prepareFullReplacementExecution({query,root,report={sources:{}},source,reviewReference,actorSql='',purpose='production-target'}){
 assert.equal(typeof query,'function');assert.ok(typeof reviewReference==='string'&&reviewReference.trim().length>0);
 assert.ok(['production-target','owned-fixture'].includes(purpose));assert.ok(typeof actorSql==='string');
 const verified=loadFullCanonicalSource();
 if(source)assert.equal(source.sourceVerificationDigest,verified.sourceVerificationDigest,'Fresh approved source recheck required');
 source=verified;
 const preparationCases=[],check=(v,label)=>{assert.ok(v,label);preparationCases.push(label);};
 report.sources??={};const self='scripts/sales-runtime/full-customer-replacement.mjs';report.sources[self]=sha(readFileSync(join(root,self)));
 const actor=sql=>`BEGIN;${actorSql}${sql}COMMIT;`;
 const capture=parse(await query(fullCanonicalCaptureQuery(purpose)));
 const payload=prepareFullCanonicalPayload({source,capture});
 check(payload.membership.records.length===958&&payload.summary.knownSourceForecasts===42,'All958 approved source rows bound to full actual catalog capture');
 const flagRows=parse(await query(flagsSql+';'));
 const releaseId=String(await query("SELECT batch_id FROM crm_external_private.booking_writer_releases WHERE NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=booking_writer_releases.batch_id) ORDER BY batch_id LIMIT 1;")).trim();
 const flags=pauseAndRestoreSql(flagRows,releaseId);
 const retirementManifest=loadRentalSourceRetirementInputs();
 const captures=[];
 for(const record of retirementManifest.records){
  captures.push(parse(await query(actor(`SELECT jsonb_build_object('sourceRow',${record.sourceRow},'before',rental_source_retirement_private.capture(${j(record.binding)},${record.sourceRow}),
   'columns',jsonb_build_object(${[['customer','public.sales_customers'],['interest','public.lead_project_interests'],['sale','public.sales'],['plot','public.plots']].map(([k,t])=>`${q(k)},(SELECT jsonb_agg(attname ORDER BY attname) FROM pg_attribute WHERE attrelid=${q(t)}::regclass AND attnum>0 AND NOT attisdropped)`).join(',')}));`))));
 }
 const retirement=bindRentalSourceRetirementInputs({manifest:retirementManifest,captures});
 check(retirement.records.length===6,'Six reviewed rental Sales have actual full dependency/source before-images');
 // Reextract and compare immediately before the single atomic business query.
 assert.equal(loadFullCanonicalSource().sourceVerificationDigest,source.sourceVerificationDigest,'Source changed before native write');
 const transaction=buildFullReplacementTransaction({capture,payload,source,retirementManifest,retirement,flagRows,flags,reviewReference,actorSql});
 return {source,capture,payload,retirementManifest,retirement,flagRows,flags,preparationCases,...transaction,rawPersonalDataIncluded:true,saveOnlyToIgnoredPrivatePacket:true,executed:false};
}

export async function runFullCustomerReplacement({query,root,report,source,adminId,reviewReference,sessionId}){
 assert.equal(typeof query,'function');assert.ok(uuid(adminId)&&uuid(sessionId),'Root-supplied synthetic identity and session UUIDs required');
 assert.ok(typeof reviewReference==='string'&&reviewReference.trim().length>0);
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"),'t','Owned actual-catalog loopback runtime only');
 const actorSql=claim(adminId,sessionId);
 const plan=await prepareFullReplacementExecution({query,root,report,source,reviewReference,actorSql,purpose:'owned-fixture'});
 const {payload,retirement,flagRows,flags,mainSql}=plan;source=plan.source;
 const cases=[...plan.preparationCases],check=(v,label)=>{assert.ok(v,label);cases.push(label);};
 const actor=sql=>`BEGIN;${actorSql}${sql}COMMIT;`;
 const committed=parse(await query(mainSql));
 const finalized=finalizeFullCanonicalMembership({payload:payload.membership,creationResult:committed.creation,lifecycleResult:committed.revision});
 check(committed.membership.sourceRows===958&&committed.retirement.retired===6,'One atomic native transaction commits whole958 membership and exact six administrative retirements');
 check(finalized.records.length===958,'Guarded receipts independently finalize the same complete identity counts');
 const replay=parse(await query(actor(`CREATE TEMP TABLE full_creation_replay(value jsonb) ON COMMIT DROP;
 ${flags.down}
 INSERT INTO full_creation_replay VALUES(sales_source_creation_private.apply_reviewed(${j(payload.creation)}));
 ${flags.restore}
 SELECT jsonb_build_object('creation',(SELECT value FROM full_creation_replay),
 'unknown',sales_unknown_history_private.persist_evidence(${j(payload.unknown)}),
 'details',sales_import_private.apply_reviewed_details(${j(payload.details)}),
 'revision',sales_revision_private.apply((SELECT saved.payload FROM sales_revision_private.batches saved WHERE saved.dataset_key=${q(payload.lifecycle.datasetKey)})),
 'retirement',rental_source_retirement_private.apply(${j(retirement)},${q(reviewReference)}),
 'membership',customer_source_membership_private.activate(${j(finalized)},${q(payload.preparedPayloadDigest)},${q(reviewReference)}),
 'seal',sales_recovery_private.seal_run(${q(committed.runId)}::uuid,${q(reviewReference)}));`)));
 check(replay.creation.replayed===true&&replay.details.replayed===true&&replay.revision.replayed===true&&replay.retirement.replayed===true
  &&replay.membership.replayed===true&&replay.membership.revisionId===committed.membership.revisionId&&replay.seal.replayed===true,
 'Post-commit guarded writer, membership and whole-after seal replay are idempotent');
 const history=parse(await query(actor(`SELECT customer_source_membership_private.history('[]',NULL,NULL,NULL,NULL);`)));
 check(history.length===958,'Private canonical history projection returns958 rows after commit');
 const byRow=new Map(history.map(r=>[r.sourceRow,r]));
 for(const r of finalized.records)assert.deepEqual(byRow.get(r.sourceRow)?.events,r.history.map(({kind,date,precision})=>({kind,date,precision})));
 cases.push('All known and unknown source days preserved in canonical projection');
 const restored=parse(await query(actor(`SELECT sales_recovery_private.restore_run(${q(committed.runId)}::uuid,${q(reviewReference+' restoration')});`)));
 check(restored.restored===true&&restored.physicalParentsRetained===true,'Post-commit guarded logical restoration commits with immutable audit parents retained');
 const recoveryParity=parse(await query(actor(`SELECT jsonb_build_object('headAbsent',NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head),
  'oldSource',(SELECT before_state->'sourceHashes'=(sales_recovery_private.snapshot()->'sourceHashes') FROM sales_recovery_private.runs WHERE id=${q(committed.runId)}::uuid),
  'oldFlags',(${flagsSql})=${j(flagRows)},
  'parentsHidden',NOT EXISTS(SELECT 1 FROM sales_source_creation_private.records r WHERE (sales_recovery_private.excluded_evidence('creation',r.id)) AND
    (customer_source_membership_private.customer_member(r.customer_id) OR customer_source_membership_private.interest_member(r.interest_id))));`)));
 check(Object.values(recoveryParity).every(v=>v===true),'After committed restore: original archive hashes and flags, old reader authority, and hidden retained parents match');
 const restoreReplay=parse(await query(actor(`SELECT sales_recovery_private.restore_run(${q(committed.runId)}::uuid,${q(reviewReference+' restoration replay')});`)));
 check(restoreReplay.replayed===true,'Committed compensation replay makes no duplicate recovery');
 report.results??={};
 report.results.fullCustomerReplacement={passed:cases.length,cases,sourceRows:958,customers:957,interests:948,sales:298,
  knownSourceForecasts:42,detailsRecords:41,creationRecords:6,unknownHistoryRecords:11,historicalOperations:3,retiredRentalSales:6,
  actualCatalogNativeRun:true,fixtureBusinessValues:false,operationalIdentitySynthetic:true,productionChanged:false,
  logicalBusinessRecoveryVerified:true,physicalParentsRetained:6,allFrontendApiPathsVerified:false,
  preparedPayloadDigest:payload.preparedPayloadDigest,runId:committed.runId,membershipRevisionId:committed.membership.revisionId};
 return {committed,restored,finalizedMembership:finalized,cases};
}
