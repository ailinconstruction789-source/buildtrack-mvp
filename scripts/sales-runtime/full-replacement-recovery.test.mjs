import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanProcessEnvironment, localConnectionArgs, assertLocalDatabaseTarget, assertPlainSql, verifyClusterIdentity } from './safety.mjs';
import { recoveryConnectionArgs, prepareFullReplacementRecovery } from './full-replacement-recovery.mjs';

const valid={port:43210,database:'buildtrack_sales_runtime_abcd',user:'runtime_abcd',data:'unused'};
for(const [label,patch] of [
 ['remote conninfo database',{database:'postgresql://remote/db'}],['existing application database',{database:'buildtrack'}],
 ['other database name',{database:'postgres'}],['SQL identifier injection',{user:'runtime_abcd;DROP DATABASE other'}],
 ['low port',{port:543}],['string port',{port:'5432'}],['missing owned data directory',{data:null}],
])test(`reject ${label}`,()=>assert.throws(()=>recoveryConnectionArgs({...valid,...patch})));

test('only explicit loopback and validated owned database are passed to libpq',()=>{
 const args=recoveryConnectionArgs(valid);
 assert.deepEqual(args,['--no-password','--host','127.0.0.1','--port','43210','--username','runtime_abcd','--dbname','buildtrack_sales_runtime_abcd']);
});

test('post-commit recovery restores full data, immutable circular provenance, functions, RLS, grants, sequence state and removes newly installed schema',{timeout:180000},async()=>{
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
 const cache=join(root,'node_modules/.cache/buildtrack-sales-runtime/runs');mkdirSync(cache,{recursive:true});
 const directory=realpathSync(mkdtempSync(join(cache,'recovery-'))),data=join(directory,'data');
 const nonce=randomBytes(12).toString('hex'),database=`buildtrack_sales_runtime_${nonce}`,user=`runtime_${nonce}`,password=randomBytes(32).toString('hex');
 const env={...cleanProcessEnvironment(process.env),PGPASSWORD:password,PGCLIENTENCODING:'UTF8',PGOPTIONS:'-c buildtrack.synthetic_runtime=on -c standard_conforming_strings=on'};
 const binaries=join(root,'node_modules/.cache/buildtrack-sales-runtime/postgres17/pgsql/bin');
 const executable=name=>join(binaries,`${name}${process.platform==='win32'?'.exe':''}`);
 const command=async(file,args,input='',environment=env,timeout=45000)=>execFileSync(file,args,{cwd:root,env:environment,input,encoding:'utf8',windowsHide:true,timeout,maxBuffer:16*1024*1024}).trim();
 const passwordPath=join(directory,'password');writeFileSync(passwordPath,password,{flag:'wx',mode:0o600});
 let postgres;let exited=false;let port;
 const report={version:'owned-post-commit-recovery-test-v1',passed:false,stopped:false,production:false};
 try{
  await command(executable('initdb'),['-D',data,'-U',user,'--pwfile',passwordPath,'-A','scram-sha-256','--encoding=UTF8','--no-locale']);unlinkSync(passwordPath);
  const server=createServer();await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept)});port=server.address().port;
  await new Promise((accept,reject)=>server.close(error=>error?reject(error):accept()));
  // Own the server child directly. pg_ctl start can retain inherited Windows
  // pipe handles despite returning success, so never use it as a hidden helper.
  postgres=spawn(executable('postgres'),['-D',data,'-p',String(port),'-c','listen_addresses=127.0.0.1','-c','timezone=UTC'],
   {cwd:root,env,windowsHide:true,stdio:['ignore','ignore','ignore']});
  postgres.on('exit',()=>{exited=true});postgres.on('error',()=>{exited=true});
  const query=async(sql,target=database)=>{
   assertLocalDatabaseTarget(target,database);assertPlainSql(sql);
   const args=localConnectionArgs(port,database,user);args[args.indexOf('-d')+1]=target;
   return command(executable('psql'),args,sql);
  };
  const verify=async(target)=>verifyClusterIdentity(JSON.parse(await query("SELECT json_build_object('address',host(inet_server_addr()),'port',inet_server_port(),'user',current_user,'database',current_database(),'data',current_setting('data_directory'),'listen',current_setting('listen_addresses'),'marker',current_setting('buildtrack.synthetic_runtime',true));",target)),{port,user,database:target,data});
  let ready=false;let lastError;
  for(let n=0;n<50&&!ready;n++){
   if(exited)throw new Error('Owned recovery fixture server exited');
   try{await verify('postgres');ready=true}catch(error){lastError=error;await new Promise(accept=>setTimeout(accept,100))}
  }
  if(!ready)throw lastError??new Error('Owned recovery fixture was not ready');
  await query(`CREATE DATABASE ${database};`,'postgres');await verify(database);
  await query(`CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
   CREATE SCHEMA crm_fixture_private;REVOKE ALL ON SCHEMA crm_fixture_private FROM PUBLIC;
   CREATE TABLE public.customer(id integer PRIMARY KEY,provenance integer);
   CREATE TABLE crm_fixture_private.evidence(id integer PRIMARY KEY,customer_id integer REFERENCES public.customer(id) ON DELETE RESTRICT,payload jsonb);
   ALTER TABLE public.customer ADD CONSTRAINT circular_evidence FOREIGN KEY(provenance) REFERENCES crm_fixture_private.evidence(id) DEFERRABLE INITIALLY DEFERRED;
   BEGIN;INSERT INTO public.customer VALUES(1,1);INSERT INTO crm_fixture_private.evidence VALUES(1,1,'{"original":true}');COMMIT;
   CREATE TABLE crm_fixture_private.source_membership(id integer PRIMARY KEY,active boolean);INSERT INTO crm_fixture_private.source_membership VALUES(1,true);
   ALTER TABLE public.customer ENABLE ROW LEVEL SECURITY;
   CREATE POLICY member_read ON public.customer FOR SELECT TO authenticated USING(id=1);
   GRANT USAGE ON SCHEMA public TO authenticated;GRANT SELECT ON public.customer TO authenticated;
   CREATE FUNCTION crm_fixture_private.protect() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN RAISE EXCEPTION 'IMMUTABLE_EVIDENCE';END;$$;
   REVOKE ALL ON FUNCTION crm_fixture_private.protect() FROM PUBLIC,authenticated;
   CREATE TRIGGER seal BEFORE UPDATE OR DELETE ON crm_fixture_private.evidence FOR EACH ROW EXECUTE FUNCTION crm_fixture_private.protect();
   CREATE SEQUENCE public.receipt_seq;SELECT nextval('public.receipt_seq');
   CREATE FUNCTION public.customer_read() RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT count(*)::integer FROM public.customer;$$;
   REVOKE ALL ON FUNCTION public.customer_read() FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.customer_read() TO authenticated;`);
  const checkpoint=await prepareFullReplacementRecovery({query,command,executable,connection:{port,database,user,data},directory,environment:env});
  await query(`BEGIN;UPDATE crm_fixture_private.source_membership SET active=false;INSERT INTO public.customer VALUES(2,NULL);SET CONSTRAINTS ALL IMMEDIATE;
   CREATE SCHEMA newly_installed_membership;CREATE TABLE newly_installed_membership.revision(id integer);INSERT INTO newly_installed_membership.revision VALUES(2);
   ALTER TABLE public.customer DISABLE ROW LEVEL SECURITY;REVOKE EXECUTE ON FUNCTION public.customer_read() FROM authenticated;SELECT nextval('public.receipt_seq');COMMIT;`);
  assert.equal(await query('SELECT count(*) FROM public.customer;'),'2');
  assert.equal(await query("SELECT to_regnamespace('newly_installed_membership') IS NOT NULL;"),'t');
  const recovery=await checkpoint.restoreAfterCommit();assert.equal(recovery.passed,true);
  assert.equal(await query('SELECT count(*) FROM public.customer;'),'1');
  assert.equal(await query("SELECT to_regnamespace('newly_installed_membership') IS NULL;"),'t');
  assert.equal(await query('SELECT active FROM crm_fixture_private.source_membership;'),'t');
  assert.equal(await query('SET ROLE authenticated;SELECT public.customer_read();'),'1');
  await assert.rejects(()=>query("SET ROLE authenticated;SELECT * FROM crm_fixture_private.evidence;"),/permission denied/);
  await assert.rejects(()=>query("UPDATE crm_fixture_private.evidence SET payload='{}';"),/IMMUTABLE_EVIDENCE/);
  assert.equal(await query('SELECT nextval(\'public.receipt_seq\');'),'2');
  await assert.rejects(()=>checkpoint.restoreAfterCommit(),/already been restored/);
  report.passed=true;report.recovery=recovery;report.archive={sha256:checkpoint.archive.sha256,bytes:checkpoint.archive.bytes};
 }finally{
  if(postgres&&!exited){await command(executable('pg_ctl'),['-D',data,'stop','-m','fast','-w']);
   for(let n=0;n<30&&!exited;n++)await new Promise(accept=>setTimeout(accept,50));
   if(!exited){postgres.kill();throw new Error('Owned recovery server shutdown was not confirmed')}
  }
  report.stopped=Boolean(postgres&&exited);
  writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));
 }
});
