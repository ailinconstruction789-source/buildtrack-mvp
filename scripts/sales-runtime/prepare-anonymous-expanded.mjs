// Generates a DESIGN ONLY SQL proposal from reviewed catalog fixtures; no DB calls.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const fixture=JSON.parse(readFileSync(join(root,'reports/anonymous-readiness-view-fixture-2026-10-08.json'),'utf8'));
const extra=JSON.parse(readFileSync(join(root,'reports/anonymous-lockdown-expanded-fixture-2026-10-08.json'),'utf8'));
const lit=v=>"'"+v.replaceAll("'","''")+"'";
const scope=fixture.metadata.relations.map(r=>{
  const view=fixture.views.find(v=>v.relname===r.name);
  const columns=r.kind==='r'?fixture.metadata.columns.filter(c=>c.table===r.name).map(c=>[c.column,c.type]):null;
  return `(${lit('public.'+r.name)},${lit(r.kind)},${lit(r.owner)},${r.rls?'true':'false'},${lit(JSON.stringify(columns))}::jsonb,${view?lit(view.definition_hash):'NULL'},${lit(JSON.stringify(view?.reloptions??null))}::jsonb)`;
});
if(scope.length!==23||extra.functions.length!==2)throw Error('Unexpected reviewed scope');
const rpc=extra.functions.map(f=>`(${lit('public.'+f.signature)},${lit(f.owner)},${lit(f.definition_hash)})`);
const sql=`-- DESIGN ONLY: expanded anonymous ACL closure, not a trusted-role cutover.
-- 11 base tables + 12 exact views; two exact bulk completion RPC signatures.
-- Preserves effective authenticated/service_role privileges, policies, function
-- bodies and public token flows. Reviewed construction identity binding and
-- caller-supplied audit identity fixes remain separate, default-off work.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: expanded anonymous lockdown requires reviewed execution approval';
END;
$draft_only$;

CREATE TEMP TABLE anon_expanded_scope(name text PRIMARY KEY,kind text,owner_name text,rls boolean,columns_json jsonb,view_hash text,view_options jsonb) ON COMMIT DROP;
INSERT INTO anon_expanded_scope VALUES
${scope.join(',\n')};
CREATE TEMP TABLE anon_expanded_rpc(signature text PRIMARY KEY,owner_name text,definition_hash text) ON COMMIT DROP;
INSERT INTO anon_expanded_rpc VALUES
${rpc.join(',\n')};

DO $preflight$
DECLARE r record; c record; p record; actual_columns jsonb;
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL OR to_regrole('service_role') IS NULL THEN RAISE EXCEPTION 'AUDITED_ROLES_MISSING'; END IF;
  FOR r IN SELECT * FROM pg_temp.anon_expanded_scope LOOP
    SELECT * INTO c FROM pg_class WHERE oid=to_regclass(r.name);
    IF NOT FOUND THEN RAISE EXCEPTION 'AUDITED_RELATION_MISSING: %',r.name; END IF;
    IF c.relkind::text IS DISTINCT FROM r.kind OR pg_get_userbyid(c.relowner)::text IS DISTINCT FROM r.owner_name
      OR c.relrowsecurity IS DISTINCT FROM r.rls THEN RAISE EXCEPTION 'AUDITED_RELATION_DRIFT: %',r.name; END IF;
    IF r.kind='v' THEN
      IF md5(pg_get_viewdef(c.oid,true)) IS DISTINCT FROM r.view_hash OR coalesce(to_jsonb(c.reloptions),'null'::jsonb) IS DISTINCT FROM r.view_options
        THEN RAISE EXCEPTION 'AUDITED_VIEW_DRIFT: %',r.name; END IF;
    ELSE
      SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod)) ORDER BY attnum) INTO actual_columns FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped;
      IF actual_columns IS DISTINCT FROM r.columns_json THEN RAISE EXCEPTION 'AUDITED_COLUMNS_DRIFT: %',r.name; END IF;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM pg_temp.anon_expanded_rpc LOOP
    SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
    IF NOT FOUND THEN RAISE EXCEPTION 'AUDITED_RPC_MISSING: %',r.signature; END IF;
    IF p.prokind<>'f' OR p.prosecdef OR pg_get_userbyid(p.proowner)::text IS DISTINCT FROM r.owner_name OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM r.definition_hash
      THEN RAISE EXCEPTION 'AUDITED_RPC_DRIFT: %',r.signature; END IF;
    IF (SELECT count(*) FROM pg_proc sibling WHERE sibling.pronamespace=p.pronamespace AND sibling.proname=p.proname)<>1
      THEN RAISE EXCEPTION 'AUDITED_RPC_OVERLOAD_DRIFT: %',r.signature; END IF;
  END LOOP;
END;
$preflight$;

CREATE TEMP TABLE anon_expanded_priv_before ON COMMIT DROP AS
SELECT role_name,c.oid object_id,0::smallint column_id,p.privilege,has_table_privilege(role_name,c.oid,p.privilege) allowed
FROM pg_temp.anon_expanded_scope s JOIN pg_class c ON c.oid=to_regclass(s.name)
CROSS JOIN unnest(ARRAY['authenticated','service_role']) role_name
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) base(privilege)
CROSS JOIN LATERAL unnest(ARRAY[base.privilege,base.privilege||' WITH GRANT OPTION']) p(privilege)
UNION ALL
SELECT role_name,c.oid,a.attnum,p.privilege,has_column_privilege(role_name,c.oid,a.attnum,p.privilege)
FROM pg_temp.anon_expanded_scope s JOIN pg_class c ON c.oid=to_regclass(s.name) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
CROSS JOIN unnest(ARRAY['authenticated','service_role']) role_name
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) base(privilege)
CROSS JOIN LATERAL unnest(ARRAY[base.privilege,base.privilege||' WITH GRANT OPTION']) p(privilege);
CREATE TEMP TABLE anon_expanded_rpc_before ON COMMIT DROP AS
SELECT role_name,to_regprocedure(signature)::oid object_id,has_function_privilege(role_name,to_regprocedure(signature),'EXECUTE') allowed,
has_function_privilege(role_name,to_regprocedure(signature),'EXECUTE WITH GRANT OPTION') grant_allowed
FROM pg_temp.anon_expanded_rpc CROSS JOIN unnest(ARRAY['authenticated','service_role']) role_name;
CREATE TEMP TABLE anon_expanded_functions_before ON COMMIT DROP AS
SELECT p.oid,md5(pg_get_functiondef(p.oid)) definition_hash,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prokind='f' AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema';
CREATE TEMP TABLE anon_expanded_policies_before ON COMMIT DROP AS
SELECT p.* FROM pg_policies p JOIN pg_temp.anon_expanded_scope s ON s.name=p.schemaname||'.'||p.tablename;

DO $lockdown$
DECLARE r record; a record;
BEGIN
  FOR r IN SELECT name FROM pg_temp.anon_expanded_scope LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC,anon RESTRICT',r.name);
    FOR a IN SELECT attname FROM pg_attribute WHERE attrelid=to_regclass(r.name) AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON TABLE %s FROM PUBLIC,anon RESTRICT',a.attname,a.attname,a.attname,a.attname,r.name);
    END LOOP;
    IF has_table_privilege('anon',r.name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege('anon',r.name,'SELECT,INSERT,UPDATE,REFERENCES')
      THEN RAISE EXCEPTION 'ANONYMOUS_INHERITED_PRIVILEGE_REMAINS: %',r.name; END IF;
  END LOOP;
  -- Preserve PUBLIC-derived effective EXECUTE without broadening a denied role.
  FOR r IN SELECT * FROM pg_temp.anon_expanded_rpc_before WHERE allowed LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I%s',r.object_id::regprocedure,r.role_name,CASE WHEN r.grant_allowed THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  FOR r IN SELECT signature FROM pg_temp.anon_expanded_rpc LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon RESTRICT',r.signature);
    IF has_function_privilege('anon',to_regprocedure(r.signature),'EXECUTE') THEN RAISE EXCEPTION 'ANONYMOUS_RPC_EXECUTE_REMAINS: %',r.signature; END IF;
  END LOOP;
END;
$lockdown$;

DO $preserve$
DECLARE r record; after_allowed boolean;
BEGIN
  FOR r IN SELECT * FROM pg_temp.anon_expanded_priv_before LOOP
    IF r.column_id=0 THEN after_allowed:=has_table_privilege(r.role_name,r.object_id,r.privilege);
    ELSE after_allowed:=has_column_privilege(r.role_name,r.object_id,r.column_id,r.privilege); END IF;
    IF after_allowed IS DISTINCT FROM r.allowed THEN RAISE EXCEPTION 'PROTECTED_PRIVILEGE_CHANGED: % %',r.role_name,r.object_id::regclass; END IF;
  END LOOP;
  FOR r IN SELECT * FROM pg_temp.anon_expanded_rpc_before LOOP
    IF has_function_privilege(r.role_name,r.object_id,'EXECUTE') IS DISTINCT FROM r.allowed OR has_function_privilege(r.role_name,r.object_id,'EXECUTE WITH GRANT OPTION') IS DISTINCT FROM r.grant_allowed
      THEN RAISE EXCEPTION 'PROTECTED_RPC_EXECUTE_CHANGED: % %',r.role_name,r.object_id::regprocedure; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_temp.anon_expanded_functions_before b LEFT JOIN pg_proc p ON p.oid=b.oid WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM b.definition_hash
    OR (NOT EXISTS(SELECT 1 FROM pg_temp.anon_expanded_rpc audited_rpc WHERE to_regprocedure(audited_rpc.signature)=b.oid) AND p.proacl IS DISTINCT FROM b.proacl)) THEN RAISE EXCEPTION 'UNRELATED_FUNCTION_CHANGED'; END IF;
  IF EXISTS((SELECT * FROM pg_temp.anon_expanded_policies_before EXCEPT SELECT p.* FROM pg_policies p JOIN pg_temp.anon_expanded_scope s ON s.name=p.schemaname||'.'||p.tablename)
    UNION ALL (SELECT p.* FROM pg_policies p JOIN pg_temp.anon_expanded_scope s ON s.name=p.schemaname||'.'||p.tablename EXCEPT SELECT * FROM pg_temp.anon_expanded_policies_before)) THEN RAISE EXCEPTION 'BUSINESS_POLICY_CHANGED'; END IF;
END;
$preserve$;
ROLLBACK;
`;
writeFileSync(join(root,'sql/security/anonymous_business_lockdown_expanded_draft.sql'),sql);
console.log('Prepared guarded expanded draft: 23 relations and 2 exact RPC signatures. No database connection.');
