// No existing connection or credentials are accepted. Reuse only the verified owned fixture cluster.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { cleanProcessEnvironment, assertPlainSql, verifyClusterIdentity, localConnectionArgs } from './safety.mjs';
const root=process.cwd(),run=resolve(root,'node_modules/.cache/buildtrack-sales-runtime/runs/run-Phbac0');
const options=process.argv.slice(2);
if(options.length>1||options.some(option=>option!=='--crlf'))throw Error('Only --crlf is supported');
const data=resolve(run,'data'),bin=resolve(root,'node_modules/.cache/buildtrack-sales-runtime/postgres17/pgsql/bin');
const database='buildtrack_sales_runtime_5eca4dc6bfc9483ebaa5de56',user='runtime_5eca4dc6bfc9483ebaa5de56';
const env=cleanProcessEnvironment(process.env),hba=resolve(data,'pg_hba.conf'),originalHba=readFileSync(hba,'utf8');
const socket=createServer();await new Promise((ok,no)=>{socket.once('error',no);socket.listen(0,'127.0.0.1',ok)});
const port=socket.address().port;await new Promise(ok=>socket.close(ok));
function command(name,args,input=''){
 const result=spawnSync(resolve(bin,name+'.exe'),args,{env,input,encoding:'utf8',windowsHide:true,timeout:110000,
   stdio:name==='pg_ctl'?'ignore':'pipe',maxBuffer:8*1024*1024});
 if(result.status!==0)throw Error(name+': '+(result.stderr??result.error?.message)); return result.stdout?.trim()??'';
}
function query(sql){assertPlainSql(sql);return command('psql',localConnectionArgs(port,database,user),sql);}
let started=false;
try{
 writeFileSync(hba,'host all all 127.0.0.1/32 trust\n');
 command('pg_ctl',['-D',data,'-l',resolve(run,'native-sidebar-proof.log'),'-o',`-h 127.0.0.1 -p ${port} -c buildtrack.synthetic_runtime=on`,'start','-w','-t','20']);started=true;
 const actual=JSON.parse(query("select json_build_object('address',host(inet_server_addr()),'port',inet_server_port(),'user',current_user,'database',current_database(),'data',current_setting('data_directory'),'listen',current_setting('listen_addresses'),'marker',current_setting('buildtrack.synthetic_runtime',true));"));
 verifyClusterIdentity(actual,{port,user,database,data});
 const guard=readFileSync('reports/native-sidebar-guard-before-2026-10-12.sql','utf8');
 const stock=readFileSync('reports/native-sidebar-stock-guard-before-2026-10-12.sql','utf8');
 const source=readFileSync('sql/sales/native_sidebar_permissions_review.sql','utf8').replace(/\r\n/g,'\n').replace(/^BEGIN;\s*$/m,'').replace(/COMMIT;\s*$/,'');
 const migration=options.includes('--crlf')?source.replace(/\n/g,'\r\n'):source;
 const proof=readFileSync('scripts/sales-runtime/native-sidebar-permissions-proof.sql','utf8');
 // Emulate the inspected current live configuration with synthetic data; rollback ALL local changes.
 const setup=`BEGIN;
 DO $$ BEGIN IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true)<>'on'
   OR host(inet_server_addr())<>'127.0.0.1' THEN RAISE EXCEPTION 'OWNED_FIXTURE_ONLY'; END IF; END $$;
 ${guard}; ${stock};
 ALTER TABLE public.lead_activities DROP CONSTRAINT lead_activities_customer_id_fkey;
 ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_customer_id_fkey FOREIGN KEY(customer_id) REFERENCES public.sales_customers(id) ON DELETE RESTRICT;
 ALTER TABLE public.lead_activities ALTER COLUMN recorded_by_user_id DROP DEFAULT;
 DROP POLICY IF EXISTS native_lead_activity_insert ON public.lead_activities;
 REVOKE INSERT,UPDATE,DELETE ON public.sales FROM authenticated;
 REVOKE INSERT,UPDATE,DELETE ON public.lead_activities FROM authenticated;
 ALTER TABLE public.crm_settings DISABLE TRIGGER USER;
 UPDATE public.crm_settings SET central_intake_enabled=true,booking_enabled=true,post_booking_enabled=true;
 ALTER TABLE public.crm_settings ENABLE TRIGGER USER;
 ALTER TABLE crm_external_private.sales_cutover_receipts RENAME TO fixture_saved_cutover_receipts;
 CREATE TABLE crm_external_private.sales_cutover_receipts(batch_id uuid);
 INSERT INTO crm_external_private.sales_cutover_receipts VALUES('10000000-0000-4000-8000-000000000096');
 ALTER TABLE crm_external_private.booking_writer_releases RENAME TO fixture_saved_writer_releases;
 CREATE TABLE crm_external_private.booking_writer_releases(batch_id uuid);
 INSERT INTO crm_external_private.booking_writer_releases VALUES('10000000-0000-4000-8000-000000000096');
 INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id)
  SELECT '10000000-0000-4000-8000-000000000097','Synthetic old CRM customer','0811111111',auth_user_id,auth_user_id
   FROM account_security_private.reviewed_roles WHERE enabled AND role='Admin' LIMIT 1;
 INSERT INTO public.lead_activities(id,customer_id,activity_type,occurred_at,recorded_by_user_id,note)
  SELECT '10000000-0000-4000-8000-000000000098','10000000-0000-4000-8000-000000000097','note',now(),auth_user_id,'Synthetic old CRM history'
   FROM account_security_private.reviewed_roles WHERE enabled AND role='Admin' LIMIT 1;
 -- A synthetic unlinked historical Sale tests row-denial; no real imported data/identities are copied.
 ALTER TABLE public.sales DISABLE TRIGGER USER;
 INSERT INTO public.sales(id,sale_price,contract_status) VALUES('10000000-0000-4000-8000-000000000099',99,'Cancelled');
 ALTER TABLE public.sales ENABLE TRIGGER USER;
 `;
 const output=query(setup+'\n'+migration+'\n'+proof+'\nROLLBACK;');
 const replies=output.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
 const result=replies.find(row=>row.phase==='native_sidebar_permission_proof');
 if(!result||result.passed!==20)throw Error('Incomplete native sidebar proof: '+JSON.stringify(result));
 writeFileSync('reports/native-sidebar-permissions-proof-2026-10-12'+(options.includes('--crlf')?'-crlf':'')+'.json',JSON.stringify({ownedLoopback:true,realDatabaseWrites:false,
   migrationLineEndings:options.includes('--crlf')?'CRLF':'LF',
   transactionRolledBack:true,retention:replies.find(row=>row.installed),...result},null,2));
 console.log(JSON.stringify({phase:result.phase,passed:result.passed,lineEndings:options.includes('--crlf')?'CRLF':'LF',ownedLoopback:true,transactionRolledBack:true}));
}finally{if(started)command('pg_ctl',['-D',data,'stop','-m','fast','-w','-t','20']);writeFileSync(hba,originalHba);console.log('ownedClusterStopped=true');}
