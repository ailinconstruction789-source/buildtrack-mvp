// Read-only checks against the caller's owned database. Never opens a connection
// or creates Auth, business rows, claims, grants or schema.
import assert from 'node:assert/strict';
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${q(JSON.stringify(value))}::jsonb`;
const parse = value => {
  if (value && typeof value === 'object') return value;
  const lines = String(value).trim().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) try { return JSON.parse(lines[index]); } catch {}
  throw Error('WORKSPACE_NATIVE_JSON_REQUIRED');
};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export const workspaceGuardSql = "SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;";
export const workspaceAuthorityHashesSql = `SELECT coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'hash',md5(replace(p.prosrc,E'\\r\\n',E'\\n'))) ORDER BY p.oid::regprocedure::text),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('customer_source_membership_private','sales_operator_private');`;

/** Fully page one reader, rejecting truncation, repeated IDs and actor drift. */
export async function readWorkspacePages({read, key, idKey, maxPages = 100, actor}) {
  const rows = [], ids = new Set(); let pages = 0;
  for (let page = 0; page < maxPages; page++) {
    const pair = await read(page), snapshot = pair.wrapper;
    assert.ok(snapshot.page === page && typeof snapshot.hasMore === 'boolean', 'WORKSPACE_PAGE_CONTRACT');
    assert.ok(same(snapshot.actor, actor), 'WORKSPACE_ACTOR_CHANGED');
    assert.ok(Array.isArray(snapshot[key]) && snapshot[key].length <= 50, 'WORKSPACE_PAGE_SIZE');
    assert.ok(!snapshot.hasMore || snapshot[key].length === 50, 'WORKSPACE_SHORT_CONTINUING_PAGE');
    assert.ok(snapshot.sourceMembership?.active === true, 'WORKSPACE_MEMBERSHIP_REQUIRED');
    assert.ok(same(snapshot[key].map(row => row[idKey]), pair.original[key].map(row => row[idKey])), 'WORKSPACE_ORIGINAL_ID_ORDER_CHANGED');
    for (const row of snapshot[key]) {
      assert.ok(typeof row[idKey] === 'string' && !ids.has(row[idKey]), 'WORKSPACE_DUPLICATE_ID');
      ids.add(row[idKey]); rows.push(row);
    }
    pages++;
    if (!snapshot.hasMore) return { rows, pages };
  }
  throw Error('WORKSPACE_PAGINATION_LIMIT');
}

export async function runCanonicalWorkspaceReadChecks({query, claims, report}) {
  assert.equal(await query(workspaceGuardSql), 't', 'Owned loopback fixture required');
  assert.ok(typeof claims === 'string' && claims.includes('request.jwt.claim'), 'Caller-owned synthetic claims required');
  const cases = [], check = (value, label) => { assert.ok(value, label); cases.push(label); };
  const hashesBefore = await query(workspaceAuthorityHashesSql);
  const asActor = sql => query(`BEGIN;${claims}SET LOCAL ROLE authenticated;${sql}ROLLBACK;`);
  const caps = parse(await asActor('SELECT public.crm_v2_workspace_capabilities();'));
  check(caps.contract_version === 'source_membership_workspace_v1' && caps.enabled && caps.sourceMembership?.active, 'Authorized workspace capability uses active reviewed membership');
  const actor = parse(await asActor("SELECT jsonb_build_object('userId',auth.uid(),'role',public.crm_v2_role());"));
  check(['sales','admin','owner'].includes(actor.role), 'Caller synthetic session validates actual CRM role');
  const filters = {search:'',project:'',channel:'',owner:'',status:'',unassignedOnly:false};
  const central = await readWorkspacePages({key:'customers',idKey:'id',actor,
    read: async page => parse(await asActor(`SELECT jsonb_build_object('wrapper',public.crm_v2_workspace_central_search(${json(filters)},${page}),'original',public.crm_v2_central_search(${json(filters)},${page}));`))});
  const expected = parse(await query(`SELECT jsonb_build_object(
    'members',(SELECT jsonb_agg(jsonb_build_object('customerId',m.customer_id,'interestId',m.interest_id,'saleId',m.sale_id,'history',m.history)) FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id),
    'customerIds',(SELECT jsonb_agg(id::text ORDER BY id) FROM customer_source_membership_private.customers),
    'saleRows',(SELECT jsonb_agg(jsonb_build_object('saleId',s.id,'customerId',i.customer_id,'interestId',i.id,'projectName',i.project_name,'stage',s.crm_stage,'plotId',s.plot_id,'salePrice',sales_private.crm_effective_sale_price(s.id),'bankName',CASE WHEN dc.sale_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),'') ELSE dc.bank_name END,'expectedTransferDate',sales_import_private.expected_transfer_date(s.id,s.expected_transfer_date::text),'leadId',s.lead_id)) FROM customer_source_membership_private.sales s JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id LEFT JOIN sales_private.deal_details_corrections dc ON dc.sale_id=s.id));`));
  check(expected.members.length === 958 && new Set(expected.members.map(m => m.customerId)).size === 957, 'Exactly958 approved rows retain957 reviewed customer identities');
  check(same(central.rows.map(c => c.id).sort(), expected.customerIds), 'Fully paged central reader returns exact active customer identity set');
  const nativeCustomer = 'ce66264b-a4ed-4067-9f19-9be35319203c', nativeInterest = '686313f5-01f0-48dc-b9b1-5a0f95a4487a';
  check(central.rows.length === 958 && central.rows.some(c => c.id === nativeCustomer && c.interests.some(i => i.id === nativeInterest)), 'One unrelated legitimate native Customer and Interest retained');
  const sources = new Map(); for (const member of expected.members) { const existing = sources.get(member.customerId) ?? []; existing.push(member); sources.set(member.customerId, existing); }
  const visitDay = records => records.flatMap(record => record.history).filter(event => event.kind === 'visited' && event.precision === 'day' && event.date !== null).map(event => event.date).sort()[0] ?? null;
  let knownVisitDays = 0, unknownVisitDays = 0;
  for (const customer of central.rows) {
    const records = sources.get(customer.id);
    if (!records) { check(customer.sourceKind === 'native', 'Unrelated native customer is not labelled imported'); continue; }
    assert.ok(customer.sourceKind === 'reviewed_import' && customer.visitHistoryDate === visitDay(records), 'WORKSPACE_CUSTOMER_VISIT_EVIDENCE_PARITY');
    for (const interest of customer.interests) {
      const exact = records.filter(record => record.interestId === interest.id);
      assert.ok(exact.length > 0 && interest.sourceKind === 'reviewed_import' && interest.visitHistoryDate === visitDay(exact), 'WORKSPACE_INTEREST_VISIT_EVIDENCE_PARITY');
      if (interest.visitHistoryDate === null) unknownVisitDays++; else knownVisitDays++;
    }
  }
  cases.push('All reviewed known and unknown visit days preserve exact Customer and Interest scope');
  const initial = parse(await asActor("SELECT public.crm_v2_workspace_project_sales(NULL,'all','',0);"));
  check(initial.rows.length === 0 && initial.hasMore === false && same(initial.actor, actor), 'Project picker does not pretend to contain unscoped sales');
  const sales = []; let projectPages = 0;
  for (const project of initial.projects) {
    const paged = await readWorkspacePages({key:'rows',idKey:'saleId',actor,
      read: async page => parse(await asActor(`SELECT jsonb_build_object('wrapper',public.crm_v2_workspace_project_sales(${q(project.name)},'all','',${page}),'original',public.crm_v2_project_sales(${q(project.name)},'all','',${page}));`))});
    sales.push(...paged.rows); projectPages += paged.pages;
  }
  check(sales.length === 298 && new Set(sales.map(row => row.saleId)).size === 298, 'Fully paged project reader returns all298 exact Sale identities');
  const expectedSales = new Map(expected.saleRows.map(row => [row.saleId,row]));
  for (const sale of sales) {
    const wanted = expectedSales.get(sale.saleId);
    assert.ok(wanted && Object.keys(wanted).every(key => sale[key] === wanted[key]), 'WORKSPACE_EFFECTIVE_DEAL_PARITY');
    const exact = expected.members.filter(member => member.saleId === sale.saleId);
    assert.ok(exact.length === 1 && sale.sourceKind === 'reviewed_import' && sale.visitHistoryDate === visitDay(exact), 'WORKSPACE_SALE_VISIT_EVIDENCE_PARITY');
  }
  cases.push('Every Sale has identical effective price, bank, forecast, stage and real identity binding');
  check(sales.filter(s => s.expectedTransferDate !== null).length === 42, 'All42 approved forecasts remain day-only columnP evidence');
  for (const signature of ['crm_v2_workspace_capabilities()','crm_v2_workspace_project_sales(text,text,text,integer)','crm_v2_workspace_central_search(jsonb,integer)']) {
    check(await query(`SELECT has_function_privilege('authenticated','public.${signature}','EXECUTE') AND NOT has_function_privilege('anon','public.${signature}','EXECUTE');`) === 't', 'Workspace public reader execute grants exclude anonymous');
  }
  check(await query("SELECT NOT has_schema_privilege('authenticated','sales_workspace_read_private','USAGE') AND NOT has_schema_privilege('anon','sales_workspace_read_private','USAGE') AND NOT has_function_privilege('authenticated','sales_workspace_read_private.membership_metadata(boolean)','EXECUTE') AND NOT has_function_privilege('anon','sales_workspace_read_private.history_metadata(uuid,uuid)','EXECUTE');") === 't', 'Private metadata helpers remain unavailable to browser roles');
  await assert.rejects(query('BEGIN;SET LOCAL ROLE anon;SELECT public.crm_v2_workspace_capabilities();ROLLBACK;'), /permission denied|42501/); cases.push('Anonymous actual execution denied');
  await query('SELECT customer_source_membership_private.assert_catalog();SELECT sales_operator_private.assert_catalog();'); cases.push('Original membership and operator catalog guards still pass');
  check(await query(workspaceAuthorityHashesSql) === hashesBefore, 'Read checks leave all31 and33 function bodies unchanged');
  const result = {passed:cases.length,cases,sourceRows:958,reviewedCustomers:957,customersIncludingNative:central.rows.length,sales:sales.length,forecastDays:42,knownVisitDays,unknownVisitDays,centralPages:central.pages,projectPages,productionChanged:false};
  report.results.canonicalWorkspaceRead = result; return result;
}
