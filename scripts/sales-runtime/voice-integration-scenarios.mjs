// Exact catalog customer token bodies, constraints, ACL/RLS and trigger replay.
// Only a manager-owned, identity-verified disposable TCP loopback DB is accepted.
// No database URL/env credentials, GoTrue server, real tokens or remote RPC calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';
import { actorId, seedIntegrationActor, exactDefinition, ident, lit } from './integration-base.mjs';

const qname = (schema, name) => `${ident(schema)}.${ident(name)}`;
const sig = f => f.signature.startsWith(`${f.schema}.`) ? f.signature : `${f.schema}.${f.signature}`;
const json = value => `${lit(JSON.stringify(value))}::jsonb`;
const parse = value => {
  if (typeof value !== 'string') throw Error('Voice integration expects the owned psql text query adapter');
  const line = value.split(/\r?\n/).find(s => s.startsWith('{') || s.startsWith('['));
  if (!line) throw Error('Missing integration JSON result');
  return JSON.parse(line);
};
const anon = sql => `BEGIN; SET LOCAL ROLE anon; DO $$ BEGIN PERFORM set_config('request.jwt.claims','{}',true); END $$; ${sql} COMMIT;`;
const tokenSql = token => token === null ? 'NULL' : lit(token);
const open = token => `SELECT public.crm_v2_customer_voice_open(${tokenSql(token)});`;
const submit = (token, request, answers, version = 'customer_voices_v1') =>
  `SELECT public.crm_v2_customer_voice_submit(${tokenSql(token)},${request === null ? 'NULL' : lit(request) + '::uuid'},${lit(version)},${json(answers)});`;
const scores = Object.freeze({ score_knowledge: 1, score_problem_solving: 2, score_service_mind: 3,
  score_appearance: 4, score_cleanliness: 5, score_house_design: 4, score_price: 3, score_location: 2 });

export async function runVoiceIntegration({ query, root, applyDraft }) {
  if (typeof query !== 'function' || typeof applyDraft !== 'function') throw Error('Owned query/applyDraft callbacks required');
  const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
  const fixture = read('reports/anonymous-voice-integration-fixture-2026-10-08.json').snapshot;
  const original = read('reports/anonymous-readiness-catalog-2026-10-08.json').functions;
  const privateSource = read('reports/anonymous-readiness-private-helpers-2026-10-08.json').functions;
  let assertions = 0;
  const groups = [], setup = { relations: 0, reusedRelations: [], constraints: 0, functions: 0, triggers: 0, indexes: 0 };
  const check = (condition, label) => { assert.ok(condition, label); assertions++; };
  const equal = (a, b, label) => { assert.deepEqual(a, b, label); assertions++; };
  const exec = async sql => { assertPlainSql(sql); return query(sql); };
  const reject = async (sql, pattern, label) => {
    try { await exec(sql); } catch (error) {
      check(pattern.test(error.message), `${label}: ${error.message}`); return;
    }
    throw Error(`${label}: unexpectedly accepted`);
  };

  // This supplemental module runs only AFTER prepareIntegrationBase has checked
  // an empty owned database and copied exact Auth GUC helpers. No auth stub here.
  await exec(`DO $$ BEGIN
    IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
      OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
      OR current_setting('listen_addresses') IS DISTINCT FROM '127.0.0.1'
      OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
      OR current_user !~ '^runtime_[a-f0-9]+$'
      OR to_regclass('auth.users') IS NULL OR to_regclass('auth.sessions') IS NULL
      OR to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.jwt()') IS NULL
      OR to_regprocedure('account_security_private.current_crm_role()') IS NULL
      OR to_regclass('sales_private.crm_user_roles') IS NULL THEN
      RAISE EXCEPTION 'OWNED_VERIFIED_INTEGRATION_BASE_REQUIRED'; END IF;
    END $$;`);
  check(fixture.customTypes.length === 0, 'catalog targets use builtin types only');
  for (const name of ['crm_v2_customer_voice_open', 'crm_v2_customer_voice_submit', 'crm_voice_answers', 'crm_work_text']) {
    const saved = [...original, ...privateSource].find(f => f.proname === name);
    const current = fixture.functions.find(f => f.name === name);
    check(Boolean(saved && current), `${name}: both exact catalog entries present`);
    equal(current?.sourceHash, saved?.source_hash, `${name}: supplemental source matches saved exact review`);
  }

  const installedFunctions = new Set();
  async function installFunction(f) {
    const signature = sig(f);
    const existing = await exec(`SELECT COALESCE((SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid=to_regprocedure(${lit(signature)})),'');`);
    if (existing) equal(existing, f.definitionHash, `existing exact function ${signature}`);
    const definition = exactDefinition(f.definition);
    await exec(`${definition}; ALTER FUNCTION ${signature} OWNER TO ${ident(f.owner)};
      REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated,service_role;`);
    const grants = f.acl.map(g => `GRANT ${g.privilege} ON FUNCTION ${signature} TO ${g.grantee === 'PUBLIC' ? 'PUBLIC' : ident(g.grantee)}${g.grantable ? ' WITH GRANT OPTION' : ''};`);
    if (grants.length) await exec(grants.join('\n'));
    equal(await exec(`SELECT md5(pg_get_functiondef(${lit(signature)}::regprocedure));`), f.definitionHash, `exact deployed definition ${signature}`);
    installedFunctions.add(f.schema + '.' + f.name); setup.functions++;
  }

  // The generated phone column needs this actual immutable helper at CREATE time.
  await installFunction(fixture.functions.find(f => f.name === 'crm_v2_normalize_phone'));
  for (const table of fixture.relations) {
    const name = qname(table.schema, table.name);
    const exists = await exec(`SELECT to_regclass(${lit(table.schema + '.' + table.name)}) IS NOT NULL;`);
    if (exists === 't') {
      // The only supplemental table intentionally supplied by the manager base.
      if (table.schema !== 'sales_private' || table.name !== 'crm_user_roles') throw Error(`Voice setup requires fresh supplemental relation: ${name}`);
      setup.reusedRelations.push(table.schema + '.' + table.name); continue;
    }
    const columns = fixture.columns.filter(c => c.schema === table.schema && c.table === table.name);
    if (columns.some(c => c.identity)) throw Error('Unreviewed identity sequence dependency');
    await exec(`CREATE TABLE ${name}(${columns.map(c => ident(c.name) + ' ' + c.type
      + (c.generated ? ` GENERATED ALWAYS AS (${c.default}) STORED` : c.default ? ' DEFAULT ' + c.default : '')
      + (c.notnull ? ' NOT NULL' : '')).join(',')});
      ALTER TABLE ${name} OWNER TO ${ident(table.owner)};
      ${table.rls ? `ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;` : ''}
      ${table.forceRls ? `ALTER TABLE ${name} FORCE ROW LEVEL SECURITY;` : ''}`);
    setup.relations++;
  }

  // All tables and referenced unique keys must exist before circular voice FKs.
  for (const foreign of [false, true]) {
    for (const constraint of fixture.constraints.filter(c => (c.type === 'f') === foreign)) {
      const name = qname(constraint.schema, constraint.table);
      const exists = await exec(`SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=${lit(constraint.schema + '.' + constraint.table)}::regclass AND conname=${lit(constraint.name)});`);
      if (exists === 't') continue;
      if (foreign && await exec(`SELECT to_regclass(${lit(constraint.referenceSchema + '.' + constraint.referenceTable)}) IS NOT NULL;`) !== 't') {
        throw Error(`Missing exact FK parent ${constraint.referenceSchema}.${constraint.referenceTable}`);
      }
      await exec(`ALTER TABLE ${name} ADD CONSTRAINT ${ident(constraint.name)} ${constraint.definition}${!constraint.validated && ['f', 'c'].includes(constraint.type) ? ' NOT VALID' : ''};`);
      setup.constraints++;
    }
  }
  for (const index of fixture.indexes.filter(i => !i.constraintBacked)) {
    await exec(index.definition + ';'); setup.indexes++;
  }
  // SQL functions are ordered by their actual dependencies. PL/pgSQL rowtypes
  // can now resolve because the entire supplemental table closure exists.
  const priority = name => ({ crm_v2_role: 0, booking_writer_ready: 1, booking_activation_allowed: 2,
    visit_workflow_activation_allowed: 3, crm_v2_voice_row_readable: 4 }[name] ?? 5);
  for (const f of [...fixture.functions].sort((a, b) => priority(a.name) - priority(b.name))) {
    if (!installedFunctions.has(f.schema + '.' + f.name)) await installFunction(f);
  }
  for (const table of fixture.relations) await exec(`REVOKE ALL ON TABLE ${qname(table.schema, table.name)} FROM PUBLIC,anon,authenticated,service_role;`);
  for (const g of fixture.grants) await exec(`GRANT ${g.privilege} ON TABLE ${qname(g.schema, g.table)} TO ${g.grantee === 'PUBLIC' ? 'PUBLIC' : ident(g.grantee)}${g.grantable ? ' WITH GRANT OPTION' : ''};`);
  for (const g of fixture.columnGrants) await exec(`GRANT ${g.privilege} (${ident(g.column)}) ON TABLE ${qname(g.schema, g.table)} TO ${g.grantee === 'PUBLIC' ? 'PUBLIC' : ident(g.grantee)}${g.grantable ? ' WITH GRANT OPTION' : ''};`);
  for (const p of fixture.policies) await exec(`CREATE POLICY ${ident(p.policyname)} ON ${qname(p.schemaname, p.tablename)} AS ${p.permissive} FOR ${p.cmd}
    TO ${p.roles.map(role => role === 'public' ? 'PUBLIC' : ident(role)).join(',')}
    ${p.qual ? ` USING (${p.qual})` : ''}${p.with_check ? ` WITH CHECK (${p.with_check})` : ''};`);

  // Existing enabled workflow state is synthetic, privileged fixture baseline.
  // It is established before seals are installed, not by stubbing activation.
  await exec(`INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,visits_enabled,customer_voices_enabled)
    VALUES(true,true,true,true,true,true);
    INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC TOKEN INTEGRATION',false);`);
  for (const trigger of fixture.triggers) {
    const table = qname(trigger.schema, trigger.table);
    const exists = await exec(`SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=${lit(trigger.schema + '.' + trigger.table)}::regclass AND tgname=${lit(trigger.name)} AND NOT tgisinternal);`);
    if (exists !== 't') await exec(trigger.definition + ';');
    const enabled = { O: 'ENABLE', A: 'ENABLE ALWAYS', R: 'ENABLE REPLICA', D: 'DISABLE' }[trigger.enabled];
    if (!enabled) throw Error('Unexpected catalog trigger mode');
    await exec(`ALTER TABLE ${table} ${enabled} TRIGGER ${ident(trigger.name)};`); setup.triggers++;
  }
  // Active projection guards query this actual append-only suspension ledger.
  // Its copied schema/constraints/ACL/RLS/history trigger are installed above;
  // the synthetic baseline is empty and no trusted check is bypassed.
  equal(await exec(`SELECT to_regclass('account_security_private.crm_auth_suspensions') IS NOT NULL;`),
    't', 'exact CRM suspension dependency is installed before guarded role seeding');
  await seedIntegrationActor(query, 3, 'Sales');
  const owner = actorId(3);
  equal(await exec(`SELECT role||':'||is_active::text FROM sales_private.crm_user_roles WHERE user_id='${owner}';`), 'sales:true', 'synthetic reviewed active owner is installed under exact guard');

  async function metadata() {
    return parse(await exec(`SELECT jsonb_build_object(
      'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'hash',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text) ORDER BY p.oid::regprocedure::text)
        FROM pg_proc p WHERE p.oid IN (${fixture.functions.map(f => `${lit(sig(f))}::regprocedure`).join(',')})),
      'triggers',(SELECT jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true)) ORDER BY n.nspname,c.relname,t.tgname)
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE NOT t.tgisinternal AND (n.nspname,c.relname) IN (${fixture.relations.map(t => `(${lit(t.schema)},${lit(t.name)})`).join(',')})));`));
  }

  async function fresh({ expired = false, revoked = false, future = false, cancelled = false, lost = false } = {}) {
    const ids = { customer: randomUUID(), interest: randomUUID(), visit: randomUUID(), tokenId: randomUUID(), token: randomBytes(32).toString('hex') };
    const hash = createHash('sha256').update(ids.token, 'utf8').digest('hex');
    await exec(`BEGIN;
      INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id)
        VALUES('${ids.customer}','SYNTHETIC VOICE CUSTOMER','0990000000','${owner}','${owner}');
      INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id,engagement_status)
        VALUES('${ids.interest}','${ids.customer}','SYNTHETIC TOKEN INTEGRATION','${owner}','${owner}',${lit(lost ? 'lost' : 'new')});
      INSERT INTO sales_private.visits_write_permits VALUES(txid_current(),pg_backend_pid());
      INSERT INTO public.lead_visits(id,project_interest_id,checked_in_by_user_id,checked_in_at)
        VALUES('${ids.visit}','${ids.interest}','${owner}',clock_timestamp() ${future ? "+ interval '1 day'" : "- interval '1 hour'"});
      ${cancelled ? `UPDATE public.lead_visits SET status='cancelled',revision=gen_random_uuid() WHERE id='${ids.visit}';` : ''}
      DELETE FROM sales_private.visits_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
      INSERT INTO sales_private.voice_write_permits VALUES(txid_current(),pg_backend_pid(),'${ids.visit}',NULL);
      INSERT INTO sales_private.visit_submission_tokens(id,visit_id,token_hash,created_at,expires_at)
        VALUES('${ids.tokenId}','${ids.visit}','${hash}',clock_timestamp()-interval '2 days',clock_timestamp() ${expired ? "- interval '1 day'" : "+ interval '1 day'"});
      ${revoked ? `UPDATE sales_private.visit_submission_tokens SET revoked_at=clock_timestamp() WHERE id='${ids.tokenId}';` : ''}
      DELETE FROM sales_private.voice_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid(); COMMIT;`);
    return ids;
  }
  async function state(scope) {
    return parse(await exec(`SELECT jsonb_build_object('status',v.status,'voiceId',v.completed_voice_id,
      'voices',(SELECT count(*) FROM public.customer_voices WHERE visit_id=v.id),
      'receipts',(SELECT count(*) FROM sales_private.voice_submissions WHERE token_id='${scope.tokenId}'),
      'events',(SELECT count(*) FROM sales_private.voice_events WHERE token_id='${scope.tokenId}' AND command='submit'),
      'audits',(SELECT count(*) FROM public.crm_audit_events WHERE entity_id=v.id AND event_type='customer_voice_submitted'),
      'consumed',(SELECT consumed_at IS NOT NULL FROM sales_private.visit_submission_tokens WHERE id='${scope.tokenId}'),
      'permits',(SELECT count(*) FROM sales_private.voice_write_permits)) FROM public.lead_visits v WHERE v.id='${scope.visit}';`));
  }
  const unavailable = /CRM_VOICE_TOKEN_UNAVAILABLE/;
  async function phase(label) {
    const initialCount = assertions;
    const valid = await fresh(), request = randomUUID();
    const opened = parse(await exec(anon(open(valid.token))));
    equal(Object.keys(opened).sort(), ['expiresAt', 'formVersion'], `${label}: open has only public form metadata`);
    equal(opened.formVersion, 'customer_voices_v1', `${label}: valid token opens actual form`);
    for (const bad of [null, '', 'bad', 'A'.repeat(64), 'f'.repeat(64)]) {
      await reject(anon(open(bad)), unavailable, `${label}: invalid/unknown token open`);
      await reject(anon(submit(bad, randomUUID(), scores)), unavailable, `${label}: invalid/unknown token submit`);
    }
    for (const [name, options] of [['expired', { expired: true }], ['revoked', { revoked: true }],
      ['future visit', { future: true }], ['cancelled visit', { cancelled: true }], ['lost interest', { lost: true }]]) {
      const scope = await fresh(options), before = await state(scope);
      await reject(anon(open(scope.token)), unavailable, `${label}: ${name} token open`);
      await reject(anon(submit(scope.token, randomUUID(), scores)), unavailable, `${label}: ${name} token submit`);
      equal(await state(scope), before, `${label}: ${name} rejection leaves rows/receipt unchanged`);
    }
    const malformed = [null, [], {}, { ...scores, unexpected: true }, { ...scores, score_price: 0 },
      { ...scores, score_price: 6 }, { ...scores, score_price: 1.5 }, { ...scores, score_price: '3' },
      { ...scores, nickname: 'x\n' }, { ...scores, nickname: 'x'.repeat(501) },
      { ...scores, reason_price: 'true' }, { ...scores, monthly_rent: -1 },
      { ...scores, monthly_rent: 1.001 }, { ...scores, nickname: 'x'.repeat(17000) }];
    const untouched = await state(valid);
    for (const answers of malformed) await reject(anon(submit(valid.token, randomUUID(), answers)), /CRM_VOICE_INVALID_INPUT/, `${label}: malformed answers rejected`);
    await reject(anon(submit(valid.token, null, scores)), /CRM_VOICE_INVALID_INPUT/, `${label}: request UUID required`);
    await reject(anon(submit(valid.token, randomUUID(), scores, 'wrong_form')), /CRM_VOICE_INVALID_INPUT/, `${label}: exact form version required`);
    equal(await state(valid), untouched, `${label}: invalid answers never consume or complete token`);
    // Active owner checks remain in the actual public token implementation.
    await exec(`UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${owner}';`);
    await reject(anon(open(valid.token)), unavailable, `${label}: inactive owner open denied`);
    await reject(anon(submit(valid.token, request, scores)), unavailable, `${label}: inactive owner submit denied`);
    await exec(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${owner}';`);
    equal(parse(await exec(anon(submit(valid.token, request, scores)))), { submitted: true, replayed: false }, `${label}: actual public submit succeeds`);
    const completed = await state(valid);
    equal([completed.status, completed.voices, completed.receipts, completed.events, completed.audits, completed.consumed, completed.permits],
      ['completed', 1, 1, 1, 1, true, 0], `${label}: one durable voice/receipt/event/audit and token consumed, no permit leak`);
    await reject(anon(open(valid.token)), unavailable, `${label}: consumed token never reopens`);
    equal(parse(await exec(anon(submit(valid.token, request, scores)))), { submitted: true, replayed: true }, `${label}: identical duplicate gets generic retry acknowledgement`);
    equal(await state(valid), completed, `${label}: identical duplicate has no side effects`);
    await reject(anon(submit(valid.token, randomUUID(), scores)), /CRM_VOICE_IDEMPOTENCY_CONFLICT/, `${label}: different request cannot reuse consumed token`);
    await reject(anon(submit(valid.token, request, { ...scores, score_price: 5 })), /CRM_VOICE_IDEMPOTENCY_CONFLICT/, `${label}: changed answers cannot overwrite consumed response`);
    equal(await state(valid), completed, `${label}: conflicting duplicates have no side effects`);
    const answerRow = parse(await exec(`SELECT jsonb_build_object('answers',crm_answers,'optionalOmitted',reason_price IS NULL AND source_facebook IS NULL,
      'legacyPhone',phone,'legacyAgent',agent_name) FROM public.customer_voices WHERE visit_id='${valid.visit}';`));
    equal(answerRow.answers, scores, `${label}: exact normalized answers persisted`);
    equal([answerRow.optionalOmitted, answerRow.legacyPhone, answerRow.legacyAgent], [true, null, null], `${label}: optional omitted booleans and private legacy fields are not invented`);
    equal(await exec(anon(`SELECT count(*) FROM public.customer_voices WHERE visit_id='${valid.visit}';`)), '0', `${label}: anon cannot directly read linked submitted answers through actual RLS`);
    await reject(anon(`INSERT INTO public.customer_voices(customer_name,visit_id) VALUES('SYNTHETIC DIRECT BYPASS','${valid.visit}');`), /CRM_VOICE_FORBIDDEN|CRM_FOUNDATION_COLUMNS_SEALED|row-level security/, `${label}: direct linked write bypass denied`);
    groups.push({ label, assertions: assertions - initialCount, actualTokenBodies: true, actualVoiceTriggers: true });
  }

  const before = await metadata();
  await phase('before expanded 23-relation lockdown');
  await applyDraft();
  equal(await metadata(), before, 'expanded draft leaves voice function sources/ACL and exact trigger bindings unchanged');
  await phase('after expanded 23-relation lockdown');
  for (const name of ['crm_v2_customer_voice_open(text)', 'crm_v2_customer_voice_submit(text,uuid,text,jsonb)']) {
    equal(await exec(`SELECT has_function_privilege('anon',${lit('public.' + name)},'EXECUTE');`), 't', `intentional public ${name} retained`);
  }
  return { assertions, groups, setup, status: 'passed', exactCatalogFixture: 'reports/anonymous-voice-integration-fixture-2026-10-08.json',
    sources: 'Original deployed pg_get_functiondef bodies and ACLs, exact supplemental columns/defaults/constraints/indexes/RLS/trigger bindings',
    limitations: ['Disposable native PostgreSQL integration only; no Supabase GoTrue/PostgREST HTTP/JWT signature validation or mobile/browser E2E',
      'Synthetic existing feature-enabled state seeded before activation seal installation; actual token RPC execution runs all copied guards enabled',
      'Sequential duplicate tests cover persistence/idempotency; no claim of independent-backend concurrency or rate-limit behavior',
      'Referenced original23/Auth parent tables supplied by separately verified manager base; unrelated complete Supabase modules are outside this fixture'] };
}
