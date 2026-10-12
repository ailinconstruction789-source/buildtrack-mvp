// Exact live catalog SQL/column types/ACLs with synthetic rows in an owned cluster.
// This is not full Supabase staging, a business workflow E2E, or live performance.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlainSql } from './safety.mjs';
const ident=v=>'"'+v.replaceAll('"','""')+'"';
const lit=v=>"'"+v.replaceAll("'","''")+"'";
const tables=['leads','plot_task_assignments','plot_task_schedules','plots','sales','status_history'];

export async function runAnonymousReadiness({query,root}) {
  const fixture=JSON.parse(readFileSync(join(root,'reports/anonymous-readiness-view-fixture-2026-10-08.json'),'utf8'));
  const views=fixture.views;
  const source=readFileSync(join(root,'sql/security/anonymous_business_lockdown_draft.sql'),'utf8');
  assertPlainSql(source);
  const guard=/DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: anonymous lockdown requires reviewed execution approval';\s*END;\s*\$draft_only\$;/g;
  if([...source.matchAll(guard)].length!==1||!/ROLLBACK;\s*$/.test(source))throw Error('Unexpected guarded draft');
  const body=source.replace(guard,'').replace(/ROLLBACK;\s*$/,'COMMIT;');
  let assertions=0;
  const equal=(a,b,label)=>{if(a!==b)throw Error(label+': '+a+' != '+b);assertions++;};
  const reject=async(sql,pattern,label)=>{try{await query(sql);}catch(e){if(!pattern.test(e.message))throw Error(label+': '+e.message);assertions++;return;}throw Error(label+': accepted');};
  await reject(source,/DESIGN ONLY/,'source remains non-executable');
  await query(`DO $$ BEGIN
    IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
      OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
      OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
      OR to_regnamespace('auth') IS NOT NULL THEN RAISE EXCEPTION 'OWNED_FRESH_CLUSTER_REQUIRED'; END IF;
    END $$; CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT;
    CREATE ROLE service_role NOLOGIN NOINHERIT; GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
  for(const relation of fixture.metadata.relations.filter(r=>r.kind==='r')) {
    if(relation.schema!=='public')throw Error('Unreviewed external schema dependency');
    const columns=fixture.metadata.columns.filter(c=>c.table===relation.name);
    const pk=(fixture.metadata.primaryKeys??[]).find(p=>p.table===relation.name);
    await query(`CREATE TABLE public.${ident(relation.name)}(${columns.map(c=>ident(c.column)+' '+c.type).join(',')}${pk?', PRIMARY KEY ('+pk.columns.map(ident).join(',')+')':''});`);
  }
  // Create actual SQL definitions in dependency order, never guessed view shapes.
  const pending=[...views]; const created=new Set();
  while(pending.length) {
    const index=pending.findIndex(v=>views.every(dependency=>dependency.relname===v.relname
      || !new RegExp('\\b'+dependency.relname+'\\b').test(v.definition) || created.has(dependency.relname)));
    if(index<0)throw Error('Unexpected view dependency cycle');
    const [v]=pending.splice(index,1);
    assertPlainSql(v.definition);
    await query(`CREATE VIEW public.${ident(v.relname)} AS ${v.definition}`);
    created.add(v.relname);
  }
  // Catalog owner postgres maps to the isolated owning superuser, not a live role.
  // Non-owner anon/auth/service/PUBLIC grants are replayed without broadening auth.
  const grantStatements=[];
  for(const g of fixture.acl.grants) {
    if(g.grantee==='postgres')continue;
    if(!['anon','authenticated','service_role','PUBLIC'].includes(g.grantee))throw Error('Unreviewed ACL grantee');
    if(!['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].includes(g.privilege_type))throw Error('Unreviewed ACL privilege');
    grantStatements.push(`GRANT ${g.privilege_type}${g.column_name?' ('+ident(g.column_name)+')':''} ON TABLE public.${ident(g.relname)} TO ${g.grantee==='PUBLIC'?'PUBLIC':ident(g.grantee)}${g.is_grantable?' WITH GRANT OPTION':''};`);
  }
  await query(grantStatements.join('\n'));
  await query(`
    INSERT INTO public.projects(name,is_closed) VALUES('synthetic-project',false);
    INSERT INTO public.plots(id,project_name,house_type_id,foreman_name,sale_status) VALUES('synthetic-plot','synthetic-project','c0261008-0000-4000-8000-000000000001','synthetic-foreman','Available');
    INSERT INTO public.task_templates(id,house_type_id,task_name,task_order,cost,is_progress_counted) VALUES('d0261008-0000-4000-8000-000000000001','c0261008-0000-4000-8000-000000000001','synthetic-task',1,1000,true);
    INSERT INTO public.plot_task_assignments(id,plot_id,task_template_id,current_progress,latest_action,latest_role,is_excluded,actual_end_date,latest_update_created_at,contractor_name)
      VALUES(1,'synthetic-plot','d0261008-0000-4000-8000-000000000001',100,'ส่งงาน 100%','Foreman',false,statement_timestamp(),statement_timestamp(),'synthetic-contractor');
    INSERT INTO public.plot_task_schedules(id,plot_id,task_template_id,planned_start,planned_end)
      VALUES(1,'synthetic-plot','d0261008-0000-4000-8000-000000000001',current_date-30,current_date);
    INSERT INTO public.leads(id,project_name,status,booking_date,transferred_date) VALUES('e0261008-0000-4000-8000-000000000001','synthetic-project','Transferred',current_date-7,current_date);
    INSERT INTO public.sales(id,plot_id) VALUES('f0261008-0000-4000-8000-000000000001','synthetic-plot');
    INSERT INTO public.status_history(id) VALUES('a0261008-0000-4000-8000-000000000001');
    INSERT INTO public.task_updates(id,plot_id,task_template_id,action,user_name,role,progress,created_at) VALUES('a0261008-0000-4000-8000-000000000002','synthetic-plot','d0261008-0000-4000-8000-000000000001','ส่งงาน 100%','synthetic-foreman','Foreman',100,statement_timestamp());
    INSERT INTO public.defects(id,plot_id,task_id,status,created_at) VALUES('a0261008-0000-4000-8000-000000000003','synthetic-plot','d0261008-0000-4000-8000-000000000001','resolved',statement_timestamp());
    INSERT INTO public.task_material_requests(id,plot_id,task_template_id,status,requested_by,requested_at) VALUES('a0261008-0000-4000-8000-000000000004','synthetic-plot','d0261008-0000-4000-8000-000000000001','pending','synthetic-foreman',statement_timestamp());
  `);
  const asAuth=sql=>`BEGIN; SET LOCAL ROLE authenticated; ${sql} ROLLBACK;`;
  const values=async(name)=>await query(asAuth(`SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text),'[]'::jsonb) FROM public.${ident(name)} v;`));
  const outputs={};
  for(const v of views) {
    outputs[v.relname]=await values(v.relname);
    equal(JSON.parse(outputs[v.relname]).length>0,true,'nonempty exact view fixture '+v.relname);
    equal(await query(`SELECT md5(pg_get_viewdef('public.${v.relname}'::regclass,true));`),v.definition_hash,'exact view definition '+v.relname);
  }
  const privSnapshot=async()=>await query(`SELECT jsonb_agg(jsonb_build_array(c.relname,a.attname,p.privilege,has_column_privilege('authenticated',c.oid,a.attnum,p.privilege)) ORDER BY c.relname,a.attnum,p.privilege)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(privilege)
    WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped;`);
  const before=await privSnapshot();
  await query(body);assertions++;
  equal(await privSnapshot(),before,'all authenticated column permissions remain identical');
  for(const v of views) {
    equal(await values(v.relname),outputs[v.relname],'exact view output parity '+v.relname);
    equal(await query(`SELECT md5(pg_get_viewdef('public.${v.relname}'::regclass,true));`),v.definition_hash,'view definition remains unchanged '+v.relname);
    await reject(`BEGIN; SET LOCAL ROLE anon; SELECT * FROM public.${ident(v.relname)} LIMIT 1; ROLLBACK;`,/permission denied/,'anon denied actual view '+v.relname);
  }
  for(const t of tables)await reject(`BEGIN; SET LOCAL ROLE anon; SELECT * FROM public.${ident(t)} LIMIT 1; ROLLBACK;`,/permission denied/,'anon denied table '+t);
  // This is ONLY the anonymous ACL draft; RLS policies, constraints, Auth and
  // business triggers are not copied. Real query definitions+types+ACLs are.
  return {assertions,exactViews:views.length,baseTables:fixture.metadata.relations.filter(r=>r.kind==='r').length,baseColumns:fixture.metadata.columns.length,
    authenticatedOutputParity:true,viewDefinitionHashesUnchanged:true,authenticatedColumnPrivilegesUnchanged:true,
    sqlScope:'Anonymous-only draft, no trusted role activation',
    limitations:['synthetic business rows','owner postgres represented by disposable owning superuser','does not reproduce production RLS/constraints/triggers/Supabase API','not a live write E2E or performance benchmark']};
}
