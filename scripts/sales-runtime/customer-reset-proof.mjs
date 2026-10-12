// One owned loopback fixture cluster; no real Auth sessions/credentials are read.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {cleanProcessEnvironment,assertPlainSql,verifyClusterIdentity,localConnectionArgs,syntheticDraftBody} from './safety.mjs';
const root=process.cwd(),run=resolve(root,'node_modules/.cache/buildtrack-sales-runtime/runs/run-Phbac0');
const data=resolve(run,'data'),bin=resolve(root,'node_modules/.cache/buildtrack-sales-runtime/postgres17/pgsql/bin');
const db='buildtrack_sales_runtime_5eca4dc6bfc9483ebaa5de56',user='runtime_5eca4dc6bfc9483ebaa5de56';
const env=cleanProcessEnvironment(process.env);
const server=createServer();await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
const port=server.address().port;await new Promise(ok=>server.close(ok));
const hba=resolve(data,'pg_hba.conf'),oldHba=readFileSync(hba,'utf8');
function command(name,args,input=''){const r=spawnSync(resolve(bin,name+'.exe'),args,{env,input,encoding:'utf8',windowsHide:true,timeout:110000,stdio:name==='pg_ctl'?'ignore':'pipe',maxBuffer:8*1024*1024});if(r.status!==0)throw Error(name+': '+(r.stderr??r.error?.message));return r.stdout?.trim()??'';}
function query(sql){assertPlainSql(sql);return command('psql',localConnectionArgs(port,db,user),sql);}
let started=false;
try {
 writeFileSync(hba,'host all all 127.0.0.1/32 trust\n');
 command('pg_ctl',['-D',data,'-l',resolve(run,'customer-reset-proof.log'),'-o',`-h 127.0.0.1 -p ${port} -c buildtrack.synthetic_runtime=on`,'start','-w','-t','20']);started=true;
 const actual=JSON.parse(query("select json_build_object('address',host(inet_server_addr()),'port',inet_server_port(),'user',current_user,'database',current_database(),'data',current_setting('data_directory'),'listen',current_setting('listen_addresses'),'marker',current_setting('buildtrack.synthetic_runtime',true));"));
 verifyClusterIdentity(actual,{port,user,database:db,data});
 // This retained cluster was restored to its original catalog after the prior proof.
 if(query("SELECT to_regclass('sales_activation_private.releases') IS NOT NULL;")!=='t')for(const name of ['20_sales_reports_read','21_post_booking','22_customer_deal_details','25_unknown_historical_evidence','26_reviewed_import_details','28_historical_sale_revision','27_source_bound_customer_creation','29_imported_history_projection','30_rental_source_retirement','31_customer_source_membership','32_customer_replacement_recovery','33_customer_replacement_operator','34_canonical_workspace_read','35_reviewed_post_booking_activation']){
  const path='sql/sales/'+name+'_draft.sql';query(syntheticDraftBody(path,readFileSync(resolve(root,path),'utf8')));
 }
 const reset=readFileSync(resolve(root,'scripts/sales-runtime/customer-reset-owner.sql'),'utf8');
 // The cloned catalog is owned by this cluster's random superuser, not a live postgres login.
 const ownedReset=reset.replace("current_user<>'postgres'",`current_user<>'${user}'`);
 if(ownedReset===reset)throw Error('Unexpected owner guard');
 const missingSql="SELECT json_agg(r) FROM unnest(ARRAY["+reset.match(/DECLARE targets text\[\]:=ARRAY\[([\s\S]*?)\];/)[1]+"]) r WHERE to_regclass(r) IS NULL;";
 const missing=JSON.parse(query(missingSql)||'null')??[];
 if(missing.length){console.log(JSON.stringify({missing}));throw Error('Local reset dependencies missing');}
 const resetResult=JSON.parse(query(ownedReset));
 writeFileSync(resolve(run,'customer-reset-proof-result.json'),JSON.stringify(resetResult,null,2));
 console.log(JSON.stringify({phase:'reset',clearedTables:resetResult.clearedTables,protectedRelations:resetResult.protectedRelations,protectedPlotFieldsUnchanged:resetResult.protectedPlotFieldsUnchanged,triggersRestored:resetResult.triggersRestored}));
 const fixturePath=resolve(root,'scripts/sales-runtime/customer-native-proof.sql');
 console.log(query(readFileSync(fixturePath,'utf8')));
} finally {if(started)command('pg_ctl',['-D',data,'stop','-m','fast','-w','-t','20']);writeFileSync(hba,oldHba);console.log('ownedClusterStopped=true');}
