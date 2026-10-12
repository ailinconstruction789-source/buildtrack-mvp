/** Post-commit recovery proof for a newly owned, disposable native cluster only.
 * No URL, credentials file, existing application database, or production restore.
 * Root supplies its existing process/query closures and generated password.
 * This is intentionally a whole-database restore: immutable/restrict/circular
 * provenance, schema, guards, RLS, ACLs, sequence state and membership stay together.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { assertLocalDatabaseTarget, cleanProcessEnvironment, localConnectionArgs, verifyClusterIdentity } from './safety.mjs';

const identitySql = "SELECT json_build_object('address',host(inet_server_addr()),'port',inet_server_port(),'user',current_user,'database',current_database(),'data',current_setting('data_directory'),'listen',current_setting('listen_addresses'),'marker',current_setting('buildtrack.synthetic_runtime',true));";

/** The result contains hashes/counts only. Raw rows never leave PostgreSQL. */
export const fullReplacementStateSql = `BEGIN;
CREATE TEMP TABLE recovery_state_checks(kind text, name text, count bigint, digest text, diagnostic jsonb) ON COMMIT DROP;
DO $capture$ DECLARE r record; amount bigint; fingerprint text; state jsonb; BEGIN
 FOR r IN SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p','m','S')
  ORDER BY n.nspname,c.relname LOOP
  IF r.relkind='S' THEN
   EXECUTE format('SELECT jsonb_build_object(''lastValue'',last_value,''isCalled'',is_called) FROM %I.%I',r.nspname,r.relname) INTO state;
   amount:=1; fingerprint:=md5(state::text);
  ELSE
   EXECUTE format('SELECT count(*),md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),''[]''::jsonb)::text) FROM %I.%I x',r.nspname,r.relname)
    INTO amount,fingerprint;
  END IF;
  INSERT INTO recovery_state_checks VALUES('rows',r.nspname||'.'||r.relname,amount,fingerprint,NULL);
 END LOOP;
END; $capture$;
WITH app_ns AS (SELECT oid,nspname,nspowner,nspacl FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema'),
objects(kind,name,payload) AS (
 SELECT 'schema',nspname::text,jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',
  (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(COALESCE(nspacl,acldefault('n',nspowner))) a)) FROM app_ns
 UNION ALL SELECT 'relation',n.nspname||'.'||c.relname,jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
  'acl',(SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a),
  'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'persistence',c.relpersistence,'options',c.reloptions,
  'partition',CASE WHEN c.relispartition THEN pg_get_expr(c.relpartbound,c.oid) ELSE NULL END,
  'view',CASE WHEN c.relkind IN('v','m') THEN pg_get_viewdef(c.oid,false) ELSE NULL END)
  FROM pg_class c JOIN app_ns n ON n.oid=c.relnamespace
 UNION ALL SELECT 'column',n.nspname||'.'||c.relname||'.'||a.attnum,jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
  'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'acl',(SELECT jsonb_agg(x::text ORDER BY x::text) FROM unnest(a.attacl) x),'default',pg_get_expr(d.adbin,d.adrelid))
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN app_ns n ON n.oid=c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'constraint',n.nspname||'.'||c.relname||'.'||x.conname,to_jsonb(pg_get_constraintdef(x.oid,false))
  FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN app_ns n ON n.oid=c.relnamespace
 UNION ALL SELECT 'index',n.nspname||'.'||c.relname,jsonb_build_object('definition',pg_get_indexdef(c.oid),'valid',i.indisvalid,'ready',i.indisready)
  FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN app_ns n ON n.oid=c.relnamespace
 UNION ALL SELECT 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,jsonb_build_object('definition',pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled)
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN app_ns n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal
 UNION ALL SELECT 'policy',n.nspname||'.'||c.relname||'.'||p.polname,jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,
  'roles',(SELECT jsonb_agg(CASE WHEN q=0 THEN 'PUBLIC' ELSE pg_get_userbyid(q) END ORDER BY q) FROM unnest(p.polroles) q),
  'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN app_ns n ON n.oid=c.relnamespace
 UNION ALL SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',jsonb_build_object(
  'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
  'acl',(SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(COALESCE(p.proacl,acldefault('f',p.proowner))) a),'securityDefiner',p.prosecdef,'config',p.proconfig)
  FROM pg_proc p JOIN app_ns n ON n.oid=p.pronamespace WHERE p.prokind<>'a'
 UNION ALL SELECT 'defaultAcl',pg_get_userbyid(d.defaclrole)||'.'||COALESCE(n.nspname,'*')||'.'||d.defaclobjtype::text,
  (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(d.defaclacl) a)
  FROM pg_default_acl d LEFT JOIN app_ns n ON n.oid=d.defaclnamespace WHERE d.defaclnamespace=0 OR n.oid IS NOT NULL
 UNION ALL SELECT 'extension',e.extname,jsonb_build_object('version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner))
  FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
 UNION ALL SELECT 'type',n.nspname||'.'||t.typname,jsonb_build_object('kind',t.typtype,'owner',pg_get_userbyid(t.typowner),
  'acl',(SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(COALESCE(t.typacl,acldefault('T',t.typowner))) a),
  'notNull',t.typnotnull,'baseType',format_type(t.typbasetype,t.typtypmod),'default',t.typdefault,
  'enum',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid))
  FROM pg_type t JOIN app_ns n ON n.oid=t.typnamespace WHERE t.typrelid=0 AND t.typelem=0
 UNION ALL SELECT 'domainConstraint',n.nspname||'.'||t.typname||'.'||x.conname,to_jsonb(pg_get_constraintdef(x.oid,false))
  FROM pg_constraint x JOIN pg_type t ON t.oid=x.contypid JOIN app_ns n ON n.oid=t.typnamespace
 UNION ALL SELECT 'rule',n.nspname||'.'||c.relname||'.'||r.rulename,to_jsonb(pg_get_ruledef(r.oid,false))
  FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN app_ns n ON n.oid=c.relnamespace
 UNION ALL SELECT 'role',r.rolname,jsonb_build_object('super',r.rolsuper,'inherit',r.rolinherit,'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,
  'login',r.rolcanlogin,'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'connLimit',r.rolconnlimit,'config',r.rolconfig,'validUntil',r.rolvaliduntil)
  FROM pg_roles r WHERE r.rolname !~ '^pg_'
 UNION ALL SELECT 'membership',pg_get_userbyid(m.roleid)||'.'||pg_get_userbyid(m.member)||'.'||pg_get_userbyid(m.grantor),
  jsonb_build_object('admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) FROM pg_auth_members m
 UNION ALL SELECT 'database','owned',jsonb_build_object('owner',pg_get_userbyid(d.datdba),
  'acl',(SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(COALESCE(d.datacl,acldefault('d',d.datdba))) a),'encoding',d.encoding,
  'collation',d.datcollate,'ctype',d.datctype,'provider',d.datlocprovider)
  FROM pg_database d WHERE d.datname=current_database()
 UNION ALL SELECT 'databaseSetting',CASE WHEN s.setrole=0 THEN 'all' ELSE pg_get_userbyid(s.setrole) END,to_jsonb(s.setconfig)
  FROM pg_db_role_setting s WHERE s.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())
 UNION ALL SELECT 'sequenceDefinition',n.nspname||'.'||c.relname,(to_jsonb(s)-'seqrelid')||jsonb_build_object('type',format_type(s.seqtypid,NULL))
  FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN app_ns n ON n.oid=c.relnamespace
)
INSERT INTO recovery_state_checks SELECT kind,name,1,md5(payload::text),payload FROM objects;
CREATE UNIQUE INDEX recovery_state_checks_unique_object ON recovery_state_checks(kind,name);
SELECT json_build_object('version','owned-full-db-state-v1','objectChecks',count(*),
 'rowRelations',count(*) FILTER(WHERE kind='rows'),'digest',md5(COALESCE(jsonb_agg(jsonb_build_array(kind,name,count,digest) ORDER BY kind,name), '[]'::jsonb)::text),
 'diagnostics',COALESCE(jsonb_agg(jsonb_build_object('kind',kind,'name',name,'payload',diagnostic) ORDER BY kind,name) FILTER(WHERE kind<>'rows'),'[]'::jsonb),
 'checks',COALESCE(jsonb_agg(jsonb_build_array(kind,name,count,digest) ORDER BY kind,name),'[]'::jsonb))
FROM recovery_state_checks;
COMMIT;`;

function validateConnection(connection) {
 localConnectionArgs(connection?.port, connection?.database, connection?.user);
 assertLocalDatabaseTarget(connection.database, connection.database);
 if(typeof connection.data!=='string') throw new Error('Owned data directory required');
 return connection;
}

export function recoveryConnectionArgs(connection) {
 validateConnection(connection);
 return ['--no-password','--host','127.0.0.1','--port',String(connection.port),'--username',connection.user,'--dbname',connection.database];
}

function archivePath(directory,connection) {
 const folder=realpathSync(directory), data=realpathSync(connection.data);
 if(relative(folder,data)!=='data') throw new Error('Recovery directory must contain the owned data directory');
 const path=resolve(folder,'full-replacement-before.dump');
 const child=relative(folder,path);
 if(!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Recovery archive escapes owned run directory');
 return path;
}

function privateEnvironment(environment) {
 if(typeof environment?.PGPASSWORD!=='string'|| !/^[a-f0-9]{64}$/.test(environment.PGPASSWORD)) throw new Error('Generated runtime password required');
 return {...cleanProcessEnvironment(environment),PGPASSWORD:environment.PGPASSWORD,PGCLIENTENCODING:'UTF8',
  PGOPTIONS:'-c buildtrack.synthetic_runtime=on -c standard_conforming_strings=on -c statement_timeout=120000 -c lock_timeout=12000'};
}

/** Call before the replacement. root callback must complete/commit before restore. */
export async function prepareFullReplacementRecovery({query,command,executable,connection,directory,environment}) {
 validateConnection(connection);
 const env=privateEnvironment(environment), path=archivePath(directory,connection);
 const verify=async(target=connection.database)=>{
  assertLocalDatabaseTarget(target,connection.database);
  verifyClusterIdentity(JSON.parse(await query(identitySql,target)),{...connection,database:target});
 };
 await verify();
 if(existsSync(path)) throw new Error('Recovery checkpoint is immutable; refuse overwrite');
 for(const name of ['pg_dump','pg_restore']) if(!existsSync(executable(name))) throw new Error(`Missing reviewed portable ${name}`);
 const before=JSON.parse(await query(fullReplacementStateSql));
 await command(executable('pg_dump'),[...recoveryConnectionArgs(connection),'--format=custom','--file',path], '',env,120000);
 const archive=readFileSync(path), sha256=createHash('sha256').update(archive).digest('hex');
 if(!archive.subarray(0,5).equals(Buffer.from('PGDMP'))) throw new Error('Invalid recovery custom archive');
 await command(executable('pg_restore'),['--list',path],'',env,120000);
 const afterDump=JSON.parse(await query(fullReplacementStateSql));
 if(afterDump.digest!==before.digest) throw new Error('Database changed while preparing the recovery checkpoint');
 let restored=false;
 return {
  before,
  archive:{path,sha256,bytes:archive.length,format:'custom',scope:'whole owned fixture database; cluster globals remain in owned cluster'},
  async restoreAfterCommit(){
   if(restored) throw new Error('Recovery checkpoint has already been restored');
   await verify(); await verify('postgres');
   if(createHash('sha256').update(readFileSync(path)).digest('hex')!==sha256) throw new Error('Recovery archive changed; refuse destructive restore');
   // These are fixed identifiers validated by localConnectionArgs, never shell SQL.
   await query(`DROP DATABASE ${connection.database};`,'postgres');
   await query(`CREATE DATABASE ${connection.database} OWNER ${connection.user};`,'postgres');
   await verify();
   await command(executable('pg_restore'),[...recoveryConnectionArgs(connection),'--exit-on-error','--single-transaction',path],'',env,120000);
   await verify();
   const after=JSON.parse(await query(fullReplacementStateSql));
   if(after.digest!==before.digest||after.objectChecks!==before.objectChecks||after.rowRelations!==before.rowRelations){
    const beforeChecks=new Map(before.checks.map(x=>[x[0]+':'+x[1],JSON.stringify(x)]));
    const afterChecks=new Map(after.checks.map(x=>[x[0]+':'+x[1],JSON.stringify(x)]));
    const changed=[...new Set([...beforeChecks.keys(),...afterChecks.keys()])].filter(key=>beforeChecks.get(key)!==afterChecks.get(key));
    writeFileSync(join(directory,'recovery-catalog-differences.json'),JSON.stringify({changed,before:before.diagnostics.filter(x=>changed.includes(x.kind+':'+x.name)),after:after.diagnostics.filter(x=>changed.includes(x.kind+':'+x.name))},null,2),{mode:0o600,flag:'wx'});
    throw new Error('Post-commit whole database restore differs from its checkpoint: '+changed.join(', '));
   }
   restored=true;
   return {passed:true,before,restored:after,archiveSha256:sha256,restoredSchemaDataOwnersGrantsRlsTriggersSequences:true,
    productionRecoveryCertified:false};
  },
 };
}

/** Optional integration convenience; always recover after a committed callback. */
export async function runFullReplacementRecovery(options,applyAndVerify) {
 if(typeof applyAndVerify!=='function') throw new Error('Explicit committed replacement callback required');
 const checkpoint=await prepareFullReplacementRecovery(options);
 let applicationResult, applicationError;
 try{applicationResult=await applyAndVerify();}catch(error){applicationError=error;}
 const recovery=await checkpoint.restoreAfterCommit();
 if(applicationError) throw applicationError;
 return {applicationResult,recovery,archive:checkpoint.archive};
}
