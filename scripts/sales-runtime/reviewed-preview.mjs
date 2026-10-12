// Local reviewed customer-workspace configuration. Contains no credentials.
// Keep build and start on the same explicit flags: RootLayout is prerendered.
import {spawn} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const mode=process.argv[2];
if(!['build','start'].includes(mode)||process.argv.length!==3)throw Error('Usage: node scripts/sales-runtime/reviewed-preview.mjs build|start');
const enabled=['SALES_CRM_V2_ENABLED','SALES_CRM_LEAD_WORK_ENABLED','SALES_CRM_LIFECYCLE_ENABLED','SALES_CRM_BOOKING_ENABLED',
 'SALES_CRM_PROJECT_SALES_ENABLED','SALES_CRM_PROJECT_WORKSPACE_ENABLED','SALES_CRM_POST_BOOKING_ENABLED',
 'SALES_CRM_CUSTOMER_DEAL_DETAILS_ENABLED','SALES_CRM_HISTORICAL_EVIDENCE_ENABLED',
 'SALES_CRM_VISITS_ENABLED','SALES_CRM_VISIT_SOP_ENABLED','SALES_CRM_CUSTOMER_VOICES_ENABLED'];
const disabled=['SALES_CRM_RENTALS_ENABLED','SALES_CRM_HISTORICAL_IMPORT_ENABLED','SALES_CRM_SCHEDULE_ENABLED',
 'SALES_CRM_NOTIFICATIONS_ENABLED','SALES_CRM_SLA_PREVIEW_ENABLED','SALES_CRM_SLA_PROCESSING_ENABLED',
 'SALES_CRM_PROJECT_INTERESTS_ENABLED','SALES_CRM_VISIT_FOLLOW_UP_ENABLED'];
const env={...process.env,SALES_CRM_RELEASE_SCOPE:'',...Object.fromEntries(enabled.map(key=>[key,'false'])),
 ...Object.fromEntries(disabled.map(key=>[key,'false']))};
const child=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),mode,...(mode==='start'?['--hostname','127.0.0.1','--port','3001']:[])],
 {cwd:root,env,stdio:'inherit',windowsHide:true});
child.on('error',()=>{process.stderr.write('REVIEWED_PREVIEW_START_FAILED\n');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
