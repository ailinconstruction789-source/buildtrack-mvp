// Exact catalog schema/views/bulk RPCs/ACLs and RLS policies with synthetic rows.
// Trigger constraints and public customer token workflow implementation are not replayed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlainSql } from './safety.mjs';
const ident=v=>'"'+v.replaceAll('"','""')+'"';
const lit=v=>"'"+v.replaceAll("'","''")+"'";
export async function runAnonymousExpanded({query,root}) {
  const read=file=>JSON.parse(readFileSync(join(root,file),'utf8'));
  const fixture=read('reports/anonymous-readiness-view-fixture-2026-10-08.json');
  const extra=read('reports/anonymous-lockdown-expanded-fixture-2026-10-08.json');
  const policies=[...read('sql/security/runtime/legacy_authorization_catalog_fixture.json').snapshot.policies,...read('reports/anonymous-readiness-base-policies-2026-10-08.json').audit.policies];
  const views=fixture.views;
  const tables=fixture.metadata.relations.filter(r=>r.kind==='r').map(r=>r.name);
  const source=readFileSync(join(root,'sql/security/anonymous_business_lockdown_expanded_draft.sql'),'utf8');
  assertPlainSql(source);
  const guard=/DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: expanded anonymous lockdown requires reviewed execution approval';\s*END;\s*\$draft_only\$;/g;
  if([...source.matchAll(guard)].length!==1||!/ROLLBACK;\s*$/.test(source))throw Error('Unexpected guarded draft');
  const body=source.replace(guard,'').replace(/ROLLBACK;\s*$/,'COMMIT;');
  let assertions=0;
  const equal=(a,b,label)=>{if(a!==b)throw Error(label+': '+a+' != '+b);assertions++;};
  const reject=async(sql,pattern,label)=>{try{await query(sql);}catch(e){if(!pattern.test(e.message))throw Error(label+': '+e.message);assertions++;return;}throw Error(label+': accepted');};
  await reject(source,/DESIGN ONLY/,'saved source remains non-executable');
  await query(`DO $$ BEGIN
    IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
      OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on' OR to_regnamespace('auth') IS NOT NULL THEN RAISE EXCEPTION 'OWNED_FRESH_CLUSTER_REQUIRED'; END IF;
    END $$;
    CREATE ROLE postgres NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    GRANT USAGE,CREATE ON SCHEMA public TO postgres;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('user_metadata',jsonb_build_object('role',coalesce(current_setting('buildtrack.synthetic_role',true),'Admin'))); $$;`);
  for(const relation of fixture.metadata.relations.filter(r=>r.kind==='r')) {
    if(relation.schema!=='public')throw Error('Unreviewed external schema dependency');
    const columns=fixture.metadata.columns.filter(c=>c.table===relation.name);
    const pk=fixture.metadata.primaryKeys.find(p=>p.table===relation.name);
    await query(`CREATE TABLE public.${ident(relation.name)}(${columns.map(c=>ident(c.column)+' '+c.type).join(',')}${pk?', PRIMARY KEY ('+pk.columns.map(ident).join(',')+')':''}); ALTER TABLE public.${ident(relation.name)} OWNER TO postgres; ALTER TABLE public.${ident(relation.name)} ENABLE ROW LEVEL SECURITY;`);
  }
  // Test-only ID default to allow exact bulk bodies to insert into synthetic rows.
  await query('ALTER TABLE public.task_updates ALTER COLUMN id SET DEFAULT gen_random_uuid();');
  const pending=[...views],created=new Set();
  while(pending.length) {
    const index=pending.findIndex(v=>views.every(d=>d.relname===v.relname||!new RegExp('\\b'+d.relname+'\\b').test(v.definition)||created.has(d.relname)));
    if(index<0)throw Error('Unexpected view dependency cycle');
    const [v]=pending.splice(index,1);assertPlainSql(v.definition);
    await query(`CREATE VIEW public.${ident(v.relname)} AS ${v.definition} ALTER VIEW public.${ident(v.relname)} OWNER TO postgres;`);created.add(v.relname);
  }
  const grants=[];
  for(const g of [...fixture.acl.grants,...extra.additionalGrants]) {
    if(g.grantee==='postgres')continue;
    if(!['anon','authenticated','service_role','PUBLIC'].includes(g.grantee)||!['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].includes(g.privilege_type))throw Error('Unreviewed ACL');
    grants.push(`GRANT ${g.privilege_type}${g.column_name?' ('+ident(g.column_name)+')':''} ON TABLE public.${ident(g.relname)} TO ${g.grantee==='PUBLIC'?'PUBLIC':ident(g.grantee)}${g.is_grantable?' WITH GRANT OPTION':''};`);
  }
  for(const p of policies) {
    if(!tables.includes(p.table)||p.permissive!=='PERMISSIVE')throw Error('Unreviewed policy');
    grants.push(`CREATE POLICY ${ident(p.name)} ON public.${ident(p.table)} AS PERMISSIVE FOR ${p.cmd} TO ${p.roles.map(r=>r==='public'?'PUBLIC':ident(r)).join(',')}${p.qual?' USING ('+p.qual+')':''}${p.check?' WITH CHECK ('+p.check+')':''};`);
  }
  await query(grants.join('\n'));
  for(const f of extra.functions) {
    // psql on Windows strips literal CR characters from input lines. Encode only
    // the function body as an E string so its catalog CRLF bytes/hash stay exact.
    const definition=f.definition.replace(/\$function\$([\s\S]*?)\$function\$/,(_match,body)=>
      "E'"+body.replaceAll('\\','\\\\').replaceAll("'","''").replaceAll('\r','\\r').replaceAll('\n','\\n')+"'");
    assertPlainSql(definition);await query(definition+`; ALTER FUNCTION public.${f.signature} OWNER TO postgres;`);
    await query(f.acl.filter(g=>g.grantee!=='postgres').map(g=>`GRANT EXECUTE ON FUNCTION public.${f.signature} TO ${g.grantee==='PUBLIC'?'PUBLIC':ident(g.grantee)}${g.is_grantable?' WITH GRANT OPTION':''};`).join('\n'));
    equal(await query(`SELECT md5(pg_get_functiondef('public.${f.signature}'::regprocedure));`),f.definition_hash,'exact bulk function '+f.name);
  }
  // Clearly synthetic token sentinels prove unrelated PUBLIC EXECUTE stays intact;
  // they do not claim to test real token validation/submission behavior.
  await query(`CREATE FUNCTION public.crm_v2_customer_voice_open(p_token text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT jsonb_build_object('synthetic',true); $$;
    CREATE FUNCTION public.crm_v2_customer_voice_submit(p_token text,p_request_id uuid,p_form_version text,p_answers jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT jsonb_build_object('synthetic',true); $$;
    INSERT INTO public.projects(name,is_closed) VALUES('synthetic-project',false);
    INSERT INTO public.plots(id,project_name,house_type_id,foreman_name,sale_status) VALUES('synthetic-plot','synthetic-project','c0261008-0000-4000-8000-000000000001','synthetic-foreman','Available');
    INSERT INTO public.task_templates(id,house_type_id,task_name,task_order,cost,is_progress_counted) VALUES('d0261008-0000-4000-8000-000000000001','c0261008-0000-4000-8000-000000000001','synthetic-task',1,1000,true);
    INSERT INTO public.plot_task_assignments(id,plot_id,task_template_id,current_progress,latest_action,latest_role,is_excluded,actual_end_date,latest_update_created_at,contractor_name)
      VALUES(1,'synthetic-plot','d0261008-0000-4000-8000-000000000001',100,'ส่งงาน 100%','Foreman',false,statement_timestamp(),statement_timestamp(),'synthetic-contractor');
    INSERT INTO public.plot_task_schedules(id,plot_id,task_template_id,planned_start,planned_end) VALUES(1,'synthetic-plot','d0261008-0000-4000-8000-000000000001',current_date-30,current_date);
    INSERT INTO public.leads(id,project_name,status,booking_date,transferred_date) VALUES('e0261008-0000-4000-8000-000000000001','synthetic-project','Transferred',current_date-7,current_date);
    INSERT INTO public.sales(id,plot_id) VALUES('f0261008-0000-4000-8000-000000000001','synthetic-plot');
    INSERT INTO public.status_history(id) VALUES('a0261008-0000-4000-8000-000000000001');
    INSERT INTO public.task_updates(id,plot_id,task_template_id,action,user_name,role,progress,created_at) VALUES('a0261008-0000-4000-8000-000000000002','synthetic-plot','d0261008-0000-4000-8000-000000000001','ส่งงาน 100%','synthetic-foreman','Foreman',100,statement_timestamp());
    INSERT INTO public.defects(id,plot_id,task_id,status,created_at) VALUES('a0261008-0000-4000-8000-000000000003','synthetic-plot','d0261008-0000-4000-8000-000000000001','resolved',statement_timestamp());
    INSERT INTO public.task_material_requests(id,plot_id,task_template_id,status,requested_by,requested_at) VALUES('a0261008-0000-4000-8000-000000000004','synthetic-plot','d0261008-0000-4000-8000-000000000001','pending','synthetic-foreman',statement_timestamp());`);
  const asRole=(role,sql)=>`BEGIN; SET LOCAL ROLE ${ident(role)}; ${sql} ROLLBACK;`;
  const values=(role,name)=>query(asRole(role,`SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text),'[]'::jsonb) FROM public.${ident(name)} v;`));
  const outputs={};
  for(const role of ['authenticated','service_role'])for(const v of views) {
    outputs[role+v.relname]=await values(role,v.relname);equal(JSON.parse(outputs[role+v.relname]).length>0,true,'nonempty view '+role+v.relname);
  }
  const privileges=()=>query(`SELECT jsonb_agg(jsonb_build_array(role_name,c.relname,a.attname,p.privilege,has_column_privilege(role_name,c.oid,a.attnum,p.privilege)) ORDER BY role_name,c.relname,a.attnum,p.privilege)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped CROSS JOIN unnest(ARRAY['authenticated','service_role']) role_name
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(privilege) WHERE n.nspname='public' AND c.relkind IN('r','v');`);
  const before=await privileges();
  const rpcWrites=async(role,f)=>{
    const target=f.name==='bulk_mark_plot_completed'?'synthetic-plot':'synthetic-project';
    return query(`BEGIN; UPDATE public.plot_task_assignments SET current_progress=0; SET LOCAL ROLE ${ident(role)};
      SELECT public.${ident(f.name)}(${lit(target)},'synthetic-actor','Admin'); RESET ROLE;
      SELECT count(*) FROM public.task_updates WHERE user_name='synthetic-actor'; ROLLBACK;`);
  };
  const baselineRpc={};
  for(const role of ['authenticated','service_role'])for(const f of extra.functions) {
    baselineRpc[role+f.name]=await rpcWrites(role,f);equal(baselineRpc[role+f.name],'1','bulk insert baseline '+role+f.name);
  }
  // Fail-closed preflight must reject drift before granting or revoking anything.
  await query('ALTER VIEW public.vw_project_progress SET (security_invoker=true);');
  await reject(body,/AUDITED_VIEW_DRIFT/,'view options drift denied');
  await query('ALTER VIEW public.vw_project_progress RESET (security_invoker);');
  equal(await privileges(),before,'drift failure rolls ACLs back');
  const f=extra.functions[0];
  await query(`ALTER FUNCTION public.${f.signature} SECURITY DEFINER;`);
  await reject(body,/AUDITED_RPC_DRIFT/,'RPC security drift denied');
  await query(`ALTER FUNCTION public.${f.signature} SECURITY INVOKER;`);
  await query(`CREATE FUNCTION public.${ident(f.name)}(synthetic_only integer) RETURNS void LANGUAGE sql AS $$ SELECT; $$;`);
  await reject(body,/AUDITED_RPC_OVERLOAD_DRIFT/,'unexpected bulk overload denied');
  await query(`DROP FUNCTION public.${ident(f.name)}(integer);`);
  await query('CREATE ROLE synthetic_anon_parent NOLOGIN; GRANT synthetic_anon_parent TO anon; GRANT MAINTAIN ON public.projects TO synthetic_anon_parent;');
  await reject(body,/ANONYMOUS_INHERITED_PRIVILEGE_REMAINS/,'inherited anonymous MAINTAIN denied');
  await query('REVOKE synthetic_anon_parent FROM anon; REVOKE MAINTAIN ON public.projects FROM synthetic_anon_parent; DROP ROLE synthetic_anon_parent;');
  equal(await privileges(),before,'inherited-right rejection rolls ACLs back');
  // If a future catalog exposes a table solely through PUBLIC, fail without
  // silently removing protected access or broadening authenticated table grants.
  await query('GRANT SELECT ON public.projects TO PUBLIC; REVOKE SELECT ON public.projects FROM authenticated;');
  await reject(body,/PROTECTED_PRIVILEGE_CHANGED/,'PUBLIC-only table access cannot be lost');
  await query('GRANT SELECT ON public.projects TO authenticated; REVOKE SELECT ON public.projects FROM PUBLIC;');
  equal(await privileges(),before,'protected-right rejection rolls ACLs back');
  await query('GRANT SELECT ON public.projects TO anon WITH GRANT OPTION; GRANT anon TO authenticated;');
  await reject(body,/PROTECTED_PRIVILEGE_CHANGED/,'protected inherited grant option cannot be lost');
  await query('REVOKE anon FROM authenticated; REVOKE GRANT OPTION FOR SELECT ON public.projects FROM anon;');
  // Simulate historical PUBLIC-only authenticated EXECUTE: draft must preserve it.
  await query(`REVOKE EXECUTE ON FUNCTION public.${f.signature} FROM authenticated;`);
  equal(await query(`SELECT has_function_privilege('authenticated','public.${f.signature}','EXECUTE');`),'t','PUBLIC-derived execution exists');
  await query(body);assertions++;
  equal(await privileges(),before,'authenticated and service column privileges unchanged');
  for(const role of ['authenticated','service_role'])for(const v of views)equal(await values(role,v.relname),outputs[role+v.relname],'exact output parity '+role+v.relname);
  for(const v of views){equal(await query(`SELECT md5(pg_get_viewdef('public.${v.relname}'::regclass,true));`),v.definition_hash,'view unchanged '+v.relname);await reject(asRole('anon',`SELECT * FROM public.${ident(v.relname)} LIMIT 1;`),/permission denied/,'anon view denied '+v.relname);}
  for(const t of tables)for(const action of ['SELECT * FROM','INSERT INTO','UPDATE','DELETE FROM']) {
    const statement=action==='INSERT INTO'?`INSERT INTO public.${ident(t)} DEFAULT VALUES;`:action==='UPDATE'?`UPDATE public.${ident(t)} SET ${ident(fixture.metadata.columns.find(c=>c.table===t).column)}=${ident(fixture.metadata.columns.find(c=>c.table===t).column)};`:`${action} public.${ident(t)};`;
    await reject(asRole('anon',statement),/permission denied/,'anon CRUD denied '+t+action);
  }
  for(const role of ['authenticated','service_role'])for(const fun of extra.functions)equal(await rpcWrites(role,fun),baselineRpc[role+fun.name],'bulk insert unchanged '+role+fun.name);
  for(const fun of extra.functions) {
    await reject(asRole('anon',`SELECT public.${ident(fun.name)}('synthetic-plot','spoofed-actor','Admin');`),/permission denied for function/,'anon RPC denied '+fun.name);
    equal(await query(`SELECT md5(pg_get_functiondef('public.${fun.signature}'::regprocedure));`),fun.definition_hash,'bulk body unchanged '+fun.name);
  }
  equal(await query(asRole('anon',`SELECT public.crm_v2_customer_voice_open('synthetic-only')->>'synthetic';`)),'true','public voice open sentinel ACL preserved');
  equal(await query(asRole('anon',`SELECT public.crm_v2_customer_voice_submit('synthetic-only','a0261008-0000-4000-8000-000000000009','synthetic-only','{}')->>'synthetic';`)),'true','public voice submit sentinel ACL preserved');
  // Repeat must be harmless and preserve grants/bodies (preflight ignores ACL drift).
  await query(body);assertions++;equal(await privileges(),before,'repeat remains idempotent');
  // A role that was denied EXECUTE must never be granted merely by preservation.
  await query(`REVOKE EXECUTE ON FUNCTION public.${f.signature} FROM authenticated;`);
  await query(body);assertions++;
  equal(await query(`SELECT has_function_privilege('authenticated','public.${f.signature}','EXECUTE');`),'f','denied role is not broadened');
  return {assertions,relations:23,exactViews:12,baseTables:11,baseColumns:219,replayedPolicies:policies.length,exactBulkRpcBodies:2,
    authenticatedAndServiceViewParity:true,anonymousCrudAndBulkRpcDenied:true,publicDerivedExecutePreserved:true,deniedExecuteNotBroadened:true,preflightViewAndRpcDriftDenied:true,
    limitations:['Synthetic business rows and test-only UUID default','Auth JWT is a synthetic Admin claim, not real Supabase Auth/session/RLS authorization proof','Business triggers/constraints/Supabase API not reproduced','Token flows are ACL-only synthetic sentinels; real token workflow not executed','Authenticated caller-supplied identity remains until separately reviewed trusted-role cutover','Not live write E2E or performance benchmark']};
}
