// Synthetic only. Called after the runner verifies its freshly-created cluster.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlainSql } from './safety.mjs';

const roles = ['Admin','Owner','Sales','Foreman','Site Engineer','QC','Project Planner','Procurement','Store'];
const tables = ['leads','plot_task_assignments','plot_task_schedules','plots','sales','status_history'];
const literal = value => "'" + String(value).replaceAll("'","''") + "'";
const ident = value => '"' + value.replaceAll('"','""') + '"';
const uid = n => 'a0261008-0000-4000-8000-' + String(n).padStart(12,'0');
const sid = n => 'b0261008-0000-4000-8000-' + String(n).padStart(12,'0');

export async function runLegacyAuthorization({ query, root }) {
  const catalog = JSON.parse(readFileSync(join(root,'sql/security/runtime/legacy_authorization_catalog_fixture.json'),'utf8'));
  const source = readFileSync(join(root,'sql/security/legacy_authorization_cutover_draft.sql'),'utf8');
  assertPlainSql(source);
  const guard = /DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: legacy authorization requires complete identity and module review';\s*END;\s*\$draft_only\$;/g;
  if([...source.matchAll(guard)].length!==1 || !/ROLLBACK;\s*$/.test(source)) throw Error('Unexpected design-only wrapper');
  // Omit exactly this wrapper IN MEMORY only, after cluster identity verification.
  const body = source.replace(guard,'').replace(/ROLLBACK;\s*$/,'COMMIT;');
  let assertions = 0;
  const passed = () => { assertions++; };
  const equal = (actual,expected,label) => {
    if(actual!==expected) throw Error(label+': expected '+expected+', got '+actual);
    passed();
  };
  const expectFailure = async (sql, pattern, label) => {
    try { await query(sql); } catch(error) {
      if(!pattern.test(error.message)) throw Error(label+': wrong rejection '+error.message);
      passed(); return;
    }
    throw Error(label+': accepted');
  };
  await expectFailure(source,/DESIGN ONLY/,'source cannot install');
  let fixture = `
    DO $$ BEGIN
      IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
        OR host(inet_server_addr())<>'127.0.0.1'
        OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
        OR to_regnamespace('auth') IS NOT NULL THEN RAISE EXCEPTION 'FRESH_SYNTHETIC_CLUSTER_REQUIRED'; END IF;
    END $$;
    CREATE ROLE anon NOLOGIN NOINHERIT;
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
    CREATE SCHEMA auth;
    CREATE SCHEMA account_security_private;
    REVOKE ALL ON SCHEMA account_security_private FROM PUBLIC,anon,authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,is_anonymous boolean,banned_until timestamptz);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO anon,authenticated;
    CREATE TABLE public.users(id integer PRIMARY KEY,username text,role text,last_seen_at timestamptz);
    REVOKE ALL ON public.users FROM PUBLIC,anon,authenticated;
    CREATE TABLE account_security_private.reviewed_roles(auth_user_id uuid PRIMARY KEY,legacy_user_id integer UNIQUE,role text,enabled boolean);
    CREATE TABLE account_security_private.reviewed_admins(auth_user_id uuid PRIMARY KEY,legacy_user_id integer,enabled boolean);
  `;
  roles.forEach((role,index) => {
    const n=index+1;
    fixture+=`INSERT INTO public.users VALUES(${n},'synthetic_${n}',${literal(role)},NULL);
      INSERT INTO auth.users VALUES('${uid(n)}',NULL,false,NULL);
      INSERT INTO auth.sessions VALUES('${sid(n)}','${uid(n)}',NULL);
      INSERT INTO account_security_private.reviewed_roles VALUES('${uid(n)}',${n},${literal(role)},true);`;
  });
  fixture+=`INSERT INTO account_security_private.reviewed_admins VALUES('${uid(1)}',1,true);`;
  for(const table of tables) {
    const columns=catalog.snapshot.columns.filter(c=>c.table===table);
    fixture+=`CREATE TABLE public.${ident(table)}(${columns.map(c=>ident(c.column)+' '+c.type).join(',')}); ALTER TABLE public.${ident(table)} ENABLE ROW LEVEL SECURITY; GRANT ALL ON public.${ident(table)} TO anon,authenticated;`;
    const idType=columns.find(c=>c.column==='id').type;
    fixture+=`INSERT INTO public.${ident(table)}(id) VALUES(${idType==='uuid'?literal(uid(99)):idType==='bigint'?'1':"'synthetic-plot'"});`;
  }
  for(const p of catalog.snapshot.policies) {
    const policyRoles = Array.isArray(p.roles)?p.roles:String(p.roles).replace(/[{}]/g,'').split(',');
    fixture+=`CREATE POLICY ${ident(p.name)} ON public.${ident(p.table)} AS ${p.permissive} FOR ${p.cmd} TO ${policyRoles.map(ident).join(',')} ${p.qual?'USING ('+p.qual+')':''} ${p.check?'WITH CHECK ('+p.check+')':''};`;
  }
  for(const actor of [...catalog.actor].sort((a,b)=>Number(a.proname==='app_current_actor')-Number(b.proname==='app_current_actor'))) {
    fixture+=`CREATE FUNCTION ${actor.nspname}.${actor.proname}() RETURNS jsonb LANGUAGE ${actor.proname==='current_actor'?'plpgsql SECURITY DEFINER':'sql SECURITY INVOKER'} SET search_path='' AS $catalog_actor$${actor.prosrc}$catalog_actor$;
      REVOKE ALL ON FUNCTION ${actor.nspname}.${actor.proname}() FROM PUBLIC,anon,authenticated;`;
  }
  // Deliberately inherited independent ACLs must be removed by the draft.
  fixture+='GRANT SELECT(id),UPDATE(id) ON public.plots TO anon; GRANT UPDATE(id) ON public.plot_task_assignments TO anon;';
  for(const v of catalog.views) {
    // One nested view exercises recursive discovery; query shapes are synthetic.
    fixture+=`CREATE VIEW public.${ident(v)} AS SELECT id FROM public.${v==='vw_project_progress'?'vw_plot_progress':'plot_task_assignments'}; GRANT ALL ON public.${ident(v)} TO anon,authenticated; GRANT SELECT(id) ON public.${ident(v)} TO anon;`;
  }
  await query(fixture);
  const anonSource=readFileSync(join(root,'sql/security/anonymous_business_lockdown_draft.sql'),'utf8');
  assertPlainSql(anonSource);
  const anonGuard=/DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: anonymous lockdown requires reviewed execution approval';\s*END;\s*\$draft_only\$;/g;
  if([...anonSource.matchAll(anonGuard)].length!==1 || !/ROLLBACK;\s*$/.test(anonSource)) throw Error('Unexpected anonymous draft wrapper');
  const anonBody=anonSource.replace(anonGuard,'').replace(/ROLLBACK;\s*$/,'COMMIT;');
  await expectFailure(anonSource,/DESIGN ONLY/,'anonymous source cannot install');
  equal((await query('BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.vw_project_progress; ROLLBACK;')).split(/\r?\n/).at(-1),'1','synthetic legacy nested view is exposed before lockdown');
  // Simulate an authenticated permission inherited ONLY through PUBLIC.
  await query('REVOKE SELECT ON public.leads FROM authenticated; GRANT SELECT ON public.leads TO PUBLIC;');
  await expectFailure(anonBody,/AUTHENTICATED_PRIVILEGE_CHANGED/,'anonymous draft refuses authenticated permission regression');
  equal((await query("SELECT has_table_privilege('anon','public.vw_project_progress','SELECT');")).trim(),'t','failed anonymous cutover rolls back all revokes');
  await query('GRANT SELECT ON public.leads TO authenticated; REVOKE SELECT ON public.leads FROM PUBLIC;');
  await query(anonBody); passed();
  for(const relation of [...tables,...catalog.views]) {
    await expectFailure(`BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.${ident(relation)}; ROLLBACK;`,/permission denied/,'anonymous-only lockdown '+relation);
    equal((await query(`BEGIN; SET LOCAL ROLE authenticated; SELECT count(*) FROM public.${ident(relation)}; ROLLBACK;`)).split(/\r?\n/).at(-1),'1','anonymous-only keeps authenticated read '+relation);
  }
  // Reset only synthetic ACLs, so the full role draft is exercised independently.
  await query([...tables,...catalog.views].map(r=>`GRANT ALL ON public.${ident(r)} TO anon; GRANT SELECT(id),UPDATE(id) ON public.${ident(r)} TO anon;`).join('\n'));
  await query('UPDATE account_security_private.reviewed_roles SET enabled=false WHERE legacy_user_id=4;');
  await expectFailure(body,/ALL_LEGACY_IDENTITIES_REQUIRE_OPERATOR_REVIEW/,'unreviewed legacy account blocks cutover');
  await query('UPDATE account_security_private.reviewed_roles SET enabled=true WHERE legacy_user_id=4; GRANT UPDATE(role) ON public.users TO authenticated;');
  await expectFailure(body,/LEGACY_IDENTITY_MUST_BE_IMMUTABLE/,'column identity privilege blocks cutover');
  await query('REVOKE UPDATE(role) ON public.users FROM authenticated; CREATE POLICY unexpected_policy ON public.leads FOR SELECT TO authenticated USING(true);');
  await expectFailure(body,/AUDITED_POLICY_SNAPSHOT_CHANGED/,'unexpected policy blocks cutover');
  await query('DROP POLICY unexpected_policy ON public.leads;');
  await query('CREATE VIEW public.unreviewed_nested_view AS SELECT * FROM public.vw_project_progress;');
  await expectFailure(body,/AUDITED_VIEW_DEPENDENCIES_CHANGED/,'new nested view blocks cutover');
  await query('DROP VIEW public.unreviewed_nested_view;');
  await query('ALTER TABLE public.plots ADD COLUMN unreviewed_column text;');
  await expectFailure(body,/AUDITED_COLUMN_SNAPSHOT_CHANGED/,'changed table schema blocks cutover');
  await query('ALTER TABLE public.plots DROP COLUMN unreviewed_column; GRANT UPDATE(role) ON account_security_private.reviewed_roles TO authenticated;');
  await expectFailure(body,/REVIEWED_REGISTRY_MUST_BE_OPERATOR_ONLY/,'mutable reviewed registry blocks cutover');
  await query('REVOKE UPDATE(role) ON account_security_private.reviewed_roles FROM authenticated;');
  await query(body); passed();
  const claims = (n, extra={}) => JSON.stringify({sub:uid(n),session_id:sid(n),user_metadata:{role:'Admin',username:'forged_admin'},...extra});
  const asActor = (n,sql,extra) => `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',${literal(claims(n,extra))},true); ${sql} ROLLBACK;`;
  const scalar = async(sql) => (await query(sql)).split(/\r?\n/).at(-1);
  const canWrite = (role,table) => table==='plots'?['Admin','Owner','Project Planner'].includes(role)
    : table==='plot_task_assignments'?['Admin','Owner','Project Planner','Site Engineer','Foreman','QC','Procurement'].includes(role)
    : table==='plot_task_schedules'?['Admin','Owner','Project Planner','Site Engineer','Foreman','QC'].includes(role)
    : ['Admin','Owner','Sales'].includes(role);
  for(const table of tables) {
    for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) {
      equal(await scalar(`SELECT has_table_privilege('anon','public.${table}','${privilege}');`),'f','anon '+table+' '+privilege);
    }
    equal(await scalar(`SELECT has_any_column_privilege('anon','public.${table}','SELECT,INSERT,UPDATE,REFERENCES');`),'f','anon column grants '+table);
    await expectFailure(`BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.${table}; ROLLBACK;`,/permission denied/,'anon read '+table);
  }
  for(const v of catalog.views) {
    equal(await scalar(`SELECT has_table_privilege('anon','public.${v}','SELECT');`),'f','anon view privilege '+v);
    equal(await scalar(`SELECT has_any_column_privilege('anon','public.${v}','SELECT');`),'f','anon view column privilege '+v);
    await expectFailure(`BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.${v}; ROLLBACK;`,/permission denied/,'anon view read '+v);
    equal(await scalar(`SELECT reloptions::text FROM pg_class WHERE oid='public.${v}'::regclass;`),'{security_invoker=true}','invoker view '+v);
  }
  for(const [index,role] of roles.entries()) {
    const n=index+1;
    equal(await scalar(asActor(n,"SELECT public.app_current_actor()->>'role';")),role,'canonical '+role);
    for(const v of catalog.views) equal(await scalar(asActor(n,`SELECT count(*) FROM public.${v};`)),'1','reviewed view read '+role+' '+v);
    for(const table of tables) {
      equal(await scalar(asActor(n,`SELECT count(*) FROM public.${table};`)),'1','team read '+role+' '+table);
      const column=catalog.snapshot.columns.find(c=>c.table===table&&c.column==='id');
      const newId=column.type==='uuid'?literal(uid(98)):column.type==='bigint'?'2':"'synthetic-new-plot'";
      const insert=`INSERT INTO public.${table}(id) VALUES(${newId});`;
      if(canWrite(role,table)) { await query(asActor(n,insert)); passed(); }
      else await expectFailure(asActor(n,insert),/row-level security/,'insert denied '+role+' '+table);
      if(table==='status_history') {
        await expectFailure(asActor(n,'UPDATE public.status_history SET id=id;'),/permission denied/,'append only update '+role);
        await expectFailure(asActor(n,'DELETE FROM public.status_history;'),/permission denied/,'append only delete '+role);
      } else {
        const canUpdate=table==='plots'?['Admin','Owner','Sales','Project Planner','Site Engineer','Foreman','QC'].includes(role):canWrite(role,table);
        equal(await scalar(asActor(n,`WITH changed AS(UPDATE public.${table} SET id=id RETURNING 1) SELECT count(*) FROM changed;`)),canUpdate?'1':'0','update '+role+' '+table);
        equal(await scalar(asActor(n,`WITH changed AS(DELETE FROM public.${table} RETURNING 1) SELECT count(*) FROM changed;`)),canWrite(role,table)?'1':'0','delete '+role+' '+table);
      }
    }
  }
  const salesColumns=['has_customer','sale_status','selling_price','highlight_color','highlight_note','is_sample_house','current_tenant_name','current_tenant_phone','rental_program','monthly_rent','security_deposit','accumulated_downpayment','lease_start_date','lease_end_date'];
  for(const c of catalog.snapshot.columns.filter(c=>c.table==='plots')) {
    const value=c.type==='uuid'?literal(uid(97)):c.type==='boolean'?'true':/numeric|integer|bigint/.test(c.type)?'1'
      :c.type==='date'?"'2026-10-08'":/timestamp/.test(c.type)?"'2026-10-08 00:00:00+00'":"'synthetic-change'";
    const update=`UPDATE public.plots SET ${ident(c.column)}=${value};`;
    if(salesColumns.includes(c.column)) { await query(asActor(3,update)); passed(); }
    else await expectFailure(asActor(3,update),/SALES_PLOT_FIELDS_ONLY/,'Sales cannot change '+c.column);
  }
  await expectFailure(asActor(4,"UPDATE public.plots SET sale_status='Reserved';"),/CONSTRUCTION_PLOT_FIELDS_ONLY/,'Foreman cannot change sales field');
  await query("CREATE FUNCTION public.synthetic_before_plot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.is_completed=true; RETURN NEW; END $$; CREATE TRIGGER z_synthetic_before_plot BEFORE UPDATE ON public.plots FOR EACH ROW EXECUTE FUNCTION public.synthetic_before_plot();");
  await expectFailure(asActor(3,"UPDATE public.plots SET highlight_note='synthetic';"),/SALES_PLOT_FIELDS_ONLY/,'final row guard detects BEFORE trigger construction changes');
  await query('DROP TRIGGER z_synthetic_before_plot ON public.plots; DROP FUNCTION public.synthetic_before_plot();');
  await query(asActor(4,'UPDATE public.plots SET is_completed=true;')); passed();
  equal(await scalar(asActor(3,'SELECT public.app_touch_current_user(); RESET ROLE; SELECT string_agg(id::text,\',\') FROM public.users WHERE last_seen_at IS NOT NULL;')),'3','presence updates only canonical caller');
  equal(await scalar('SELECT count(*) FROM public.users WHERE last_seen_at IS NOT NULL;'),'0','presence test rolled back');
  await expectFailure(asActor(3,"SELECT public.update_user_last_seen('synthetic_1');"),/APP_ACTOR_REQUIRED/,'presence cannot target another user');
  await expectFailure(asActor(3,"SELECT public.app_current_actor();",{session_id:sid(99)}),/APP_ACTOR_REQUIRED/,'missing session denied');
  await query("UPDATE auth.sessions SET not_after=now()-interval '1 hour' WHERE id='"+sid(3)+"';");
  await expectFailure(asActor(3,'SELECT count(*) FROM public.leads;'),/APP_ACTOR_REQUIRED/,'expired session denied');
  await query("UPDATE auth.sessions SET not_after=NULL WHERE id='"+sid(3)+"'; UPDATE account_security_private.reviewed_roles SET enabled=false WHERE legacy_user_id=3;");
  await expectFailure(asActor(3,'SELECT count(*) FROM public.plot_task_assignments;'),/APP_ACTOR_REQUIRED/,'disabled canonical role denied');
  await expectFailure(asActor(3,'SELECT count(*) FROM public.vw_project_progress;'),/APP_ACTOR_REQUIRED/,'disabled actor denied through nested view');
  await query('UPDATE account_security_private.reviewed_roles SET enabled=true WHERE legacy_user_id=3;');
  const plan=await query(asActor(3,'EXPLAIN SELECT * FROM public.plot_task_assignments;'));
  if(!plan.includes('InitPlan')) throw Error('Actor lookup is not a per-statement InitPlan'); passed();
  equal(await scalar("SELECT count(*) FROM pg_policies WHERE schemaname='public' AND (qual LIKE '%user_metadata%' OR with_check LIKE '%user_metadata%');"),'0','no mutable metadata business policy');
  return {assertions,roles:roles.length,tables:tables.length,views:catalog.views.length,anonymousOnlyLockdown:'passed independently without trusted actor grants',
    plotColumns:catalog.snapshot.columns.filter(c=>c.table==='plots').length,
    metadataSpoofing:'synthetic Admin claims ignored for all roles',actorReadInitPlan:true,
    limitations:['synthetic rows only','no Supabase API/JWT signature validation','real triggers/constraints/view query definitions/RPC paths not reproduced','not applied to live database']};
}
