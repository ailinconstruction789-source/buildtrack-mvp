// Database integration fixtures only. Receives an already verified local query.
// No network/URLs/env, live credentials, real Auth records or business rows.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertPlainSql} from './safety.mjs';
export const ident=v=>'"'+v.replaceAll('"','""')+'"';
export const lit=v=>"'"+String(v).replaceAll("'","''")+"'";
export const actorId=n=>`a0261008-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const sessionId=n=>`b0261008-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function asIntegrationActor(n,sql,{readOnly=false,role='authenticated',claims={}}={}) {
  const jwt={sub:actorId(n),session_id:sessionId(n),role,...claims};
  return `BEGIN${readOnly?' READ ONLY':''}; SET LOCAL ROLE ${ident(role)}; DO $$ BEGIN PERFORM set_config('request.jwt.claims',${lit(JSON.stringify(jwt))},true); END $$; ${sql} ROLLBACK;`;
}
export function exactDefinition(definition) {
  // Preserve catalog CRLF bytes through Windows psql stdin.
  return definition.replace(/\$function\$([\s\S]*?)\$function\$/,(_match,body)=>
    "E'"+body.replaceAll('\\','\\\\').replaceAll("'","''").replaceAll('\r','\\r').replaceAll('\n','\\n')+"'");
}
export async function seedIntegrationActor(query,n,role='Sales') {
  await query(`INSERT INTO auth.users(id,is_anonymous) VALUES('${actorId(n)}',false);
    INSERT INTO auth.sessions(id,user_id) VALUES('${sessionId(n)}','${actorId(n)}');
    INSERT INTO public.users(id,username,role) VALUES(${n},'Synthetic Actor ${n}',${lit(role)});
    INSERT INTO account_security_private.reviewed_roles(auth_user_id,legacy_user_id,role,enabled,review_revision,review_reference) VALUES('${actorId(n)}',${n},${lit(role)},true,1,'SYNTHETIC ONLY');
    ${role==='Admin'?`INSERT INTO account_security_private.reviewed_admins(auth_user_id,legacy_user_id,enabled,review_reference) VALUES('${actorId(n)}',${n},true,'SYNTHETIC ONLY');`:''}
    ${['Admin','Owner','Sales'].includes(role)?`INSERT INTO sales_private.crm_user_roles(user_id,role,is_active,trusted_review_revision) VALUES('${actorId(n)}',${lit(role.toLowerCase())},true,1);`:''}`);
}
export async function prepareIntegrationBase({query,root}) {
  const read=f=>JSON.parse(readFileSync(join(root,f),'utf8'));
  const fixture=read('reports/anonymous-readiness-view-fixture-2026-10-08.json');
  const extra=read('reports/anonymous-lockdown-expanded-fixture-2026-10-08.json');
  const auth=read('reports/anonymous-auth-integration-fixture-2026-10-08.json');
  const policies=[...read('sql/security/runtime/legacy_authorization_catalog_fixture.json').snapshot.policies,...read('reports/anonymous-readiness-base-policies-2026-10-08.json').audit.policies];
  await query(`DO $$ BEGIN IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on' OR to_regnamespace('auth') IS NOT NULL THEN RAISE EXCEPTION 'OWNED_FRESH_CLUSTER_REQUIRED'; END IF; END $$;`);
  const allGrants=[...auth.tables.flatMap(t=>t.grants??[]),...auth.functions.flatMap(f=>f.grants??[]),...auth.additions.schemas.flatMap(s=>s.grants??[])];
  const roles=new Set(['postgres','anon','authenticated','service_role',...allGrants.map(g=>g.grantee).filter(g=>g!=='PUBLIC'),...auth.functions.map(f=>f.owner),...auth.additions.schemas.map(s=>s.owner)]);
  for(const role of roles) {
    const flags=auth.additions.roleFlags.find(r=>r.name===role);
    await query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${lit(role)}) THEN CREATE ROLE ${ident(role)} NOLOGIN ${flags?.bypassRls?'BYPASSRLS':'NOBYPASSRLS'} ${flags?.inherit===false?'NOINHERIT':'INHERIT'}; END IF; END $$;`);
  }
  for(const schema of ['auth','account_security_private','sales_private','crm_external_private']) {
    const owner=auth.additions.schemas.find(s=>s.name===schema).owner;
    await query(`CREATE SCHEMA ${ident(schema)} AUTHORIZATION ${ident(owner)}; GRANT USAGE,CREATE ON SCHEMA ${ident(schema)} TO postgres;`);
    await query(auth.additions.schemas.find(s=>s.name===schema).grants.map(g=>`GRANT ${g.privilege} ON SCHEMA ${ident(schema)} TO ${g.grantee==='PUBLIC'?'PUBLIC':ident(g.grantee)}${g.grantable?' WITH GRANT OPTION':''};`).join('\n'));
  }
  await query('GRANT USAGE,CREATE ON SCHEMA public TO postgres; GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;');
  for(const e of auth.additions.enums??[])await query(`CREATE TYPE ${ident(e.schema)}.${ident(e.name)} AS ENUM(${e.values.map(lit).join(',')});`);
  // Original reviewed base tables stay empty; integration modules apply real
  // defaults/non-PK constraints/trigger bindings before seeding their scenarios.
  for(const r of fixture.metadata.relations.filter(r=>r.kind==='r')) {
    const cols=fixture.metadata.columns.filter(c=>c.table===r.name),pk=fixture.metadata.primaryKeys.find(p=>p.table===r.name);
    await query(`CREATE TABLE public.${ident(r.name)}(${cols.map(c=>ident(c.column)+' '+c.type).join(',')}${pk?', PRIMARY KEY ('+pk.columns.map(ident).join(',')+')':''}); ALTER TABLE public.${ident(r.name)} OWNER TO postgres; ALTER TABLE public.${ident(r.name)} ENABLE ROW LEVEL SECURITY;`);
  }
  const skipped=[];
  for(const t of auth.tables) {
    for(const c of t.columns) {
      const match=c.default?.match(/nextval\('([^']+)'::regclass\)/);
      if(match){const parts=match[1].split('.');const schema=parts.length===2?parts[0]:'public',name=parts.at(-1);await query(`CREATE SEQUENCE IF NOT EXISTS ${ident(schema)}.${ident(name)}; ALTER SEQUENCE ${ident(schema)}.${ident(name)} OWNER TO postgres;`);}
    }
    const col=t.columns.map(c=>{
      const attr=auth.additions.columns.find(a=>a.schema===t.schema&&a.table===t.name&&a.name===c.name);
      return ident(c.name)+' '+c.type+(attr?.generated?` GENERATED ALWAYS AS (${c.default}) STORED`:c.default?' DEFAULT '+c.default:'')+(c.notNull?' NOT NULL':'');
    });
    await query(`CREATE TABLE ${ident(t.schema)}.${ident(t.name)}(${col.join(',')}); ALTER TABLE ${ident(t.schema)}.${ident(t.name)} OWNER TO ${ident(t.owner)}; ${t.rls?`ALTER TABLE ${ident(t.schema)}.${ident(t.name)} ENABLE ROW LEVEL SECURITY;`:''} ${t.forceRls?`ALTER TABLE ${ident(t.schema)}.${ident(t.name)} FORCE ROW LEVEL SECURITY;`:''}`);
  }
  const constraints=auth.tables.flatMap(t=>(t.constraints??[]).map(c=>({t,c}))).sort((a,b)=>Number(a.c.kind==='f')-Number(b.c.kind==='f'));
  for(const {t,c} of constraints) {
    const target=c.definition.match(/REFERENCES\s+([\w.]+)\(/)?.[1];
    if(target&&!(await query(`SELECT to_regclass(${lit(target)}) IS NOT NULL;`)==='t')){skipped.push(t.schema+'.'+t.name+'.'+c.name);continue;}
    await query(`ALTER TABLE ${ident(t.schema)}.${ident(t.name)} ADD CONSTRAINT ${ident(c.name)} ${c.definition};`);
  }
  const pending=[...fixture.views],created=new Set();
  while(pending.length) {
    const index=pending.findIndex(v=>fixture.views.every(d=>d.relname===v.relname||!new RegExp('\\b'+d.relname+'\\b').test(v.definition)||created.has(d.relname)));
    if(index<0)throw Error('Unexpected view cycle');const [v]=pending.splice(index,1);
    await query(`CREATE VIEW public.${ident(v.relname)} AS ${v.definition} ALTER VIEW public.${ident(v.relname)} OWNER TO postgres;`);created.add(v.relname);
  }
  const statements=[];
  for(const g of [...fixture.acl.grants,...extra.additionalGrants])if(g.grantee!=='postgres')statements.push(`GRANT ${g.privilege_type}${g.column_name?' ('+ident(g.column_name)+')':''} ON TABLE public.${ident(g.relname)} TO ${g.grantee==='PUBLIC'?'PUBLIC':ident(g.grantee)}${g.is_grantable?' WITH GRANT OPTION':''};`);
  for(const t of auth.tables)for(const g of t.grants??[])if(g.grantee!==t.owner)statements.push(`GRANT ${g.privilege} ON TABLE ${ident(t.schema)}.${ident(t.name)} TO ${g.grantee==='PUBLIC'?'PUBLIC':ident(g.grantee)}${g.grantable?' WITH GRANT OPTION':''};`);
  for(const s of auth.additions.schemas)for(const g of s.grants??[])statements.push(`GRANT ${g.privilege} ON SCHEMA ${ident(s.name)} TO ${g.grantee==='PUBLIC'?'PUBLIC':ident(g.grantee)}${g.grantable?' WITH GRANT OPTION':''};`);
  for(const p of policies)statements.push(`CREATE POLICY ${ident(p.name)} ON public.${ident(p.table)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(r=>r==='public'?'PUBLIC':ident(r)).join(',')}${p.qual?' USING ('+p.qual+')':''}${p.check?' WITH CHECK ('+p.check+')':''};`);
  // Compile functions before policies using actual Auth helpers, not an Admin stub.
  const functions=[...auth.functions.sort((a,b)=>Number(a.schema!=='auth')-Number(b.schema!=='auth')), ...extra.functions.map(f=>({schema:'public',name:f.name,signature:'public.'+f.signature,owner:f.owner,definition:f.definition,hash:f.definition_hash,grants:f.acl.map(g=>({grantee:g.grantee,privilege:g.privilege,grantable:g.is_grantable}))}))];
  for(const f of functions) {
    const sig=f.signature.includes('.')?f.signature:f.schema+'.'+f.signature;
    const definition=exactDefinition(f.definition);assertPlainSql(definition);await query(definition+`; ALTER FUNCTION ${sig} OWNER TO ${ident(f.owner)}; REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`);
    await query((f.grants??[]).map(g=>`GRANT ${g.privilege} ON FUNCTION ${sig} TO ${g.grantee==='PUBLIC'?'PUBLIC':ident(g.grantee)}${g.grantable?' WITH GRANT OPTION':''};`).join('\n'));
    const hash=await query(`SELECT md5(pg_get_functiondef(${lit(sig)}::regprocedure));`);if(hash!==f.hash)throw Error('Exact function hash differs: '+sig);
  }
  await query(statements.join('\n'));
  return {baseRelations:23,exactAuthFunctions:auth.functions.length,authCatalogTables:auth.tables.length,skippedForeignKeys:skipped,
    limitations:['Actual auth.uid/jwt GUC helpers; synthetic Auth records and claims, no GoTrue server or JWT signature verification','No real login/password/refresh/API request is generated','Integration modules must replay relevant actual business constraints and triggers before seeding']};
}
