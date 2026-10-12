// Pure exact-source adapter preparation. No credentials, Auth claims or DB calls.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const md5=v=>createHash('md5').update(v).digest('hex');
const lf=v=>v.replaceAll('\r\n','\n');
const need=(v,c)=>{if(!v)throw new Error(c);};
const signature='crm_external_private.reject_unreviewed_activation()';
const expectedSource=`
DECLARE allowed boolean:=false;
BEGIN
  IF EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(NEW)) j
    WHERE (j.key LIKE '%\\_enabled' ESCAPE '\\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    allowed:=crm_external_private.booking_activation_allowed(to_jsonb(NEW));
    IF allowed IS DISTINCT FROM true AND TG_OP='UPDATE' THEN
      allowed:=crm_external_private.visit_workflow_activation_allowed(to_jsonb(OLD),to_jsonb(NEW));
    END IF;
    IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'EXTERNAL_CRM_ACTIVATION_REVIEW_REQUIRED'; END IF;
  END IF;
  RETURN NEW;
END;
`;
const marker="    IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'EXTERNAL_CRM_ACTIVATION_REVIEW_REQUIRED'; END IF;";
const hook=`    IF allowed IS DISTINCT FROM true AND TG_OP='UPDATE' THEN
      allowed:=sales_activation_private.settings_allowed(to_jsonb(OLD),to_jsonb(NEW));
    END IF;
`;
export const reviewedPostBookingActivationDraftPath='sql/sales/35_reviewed_post_booking_activation_draft.sql';
export function reviewedPostBookingActivationAdapter(catalog){
 need(Array.isArray(catalog?.functions),'POST_BOOKING_ACTIVATION_VERIFIED_CATALOG_REQUIRED');
 const matches=catalog.functions.filter(f=>f.schema==='crm_external_private'&&f.name==='reject_unreviewed_activation');
 need(matches.length===1,'POST_BOOKING_ACTIVATION_EXACT_FUNCTION_REQUIRED');
 const fn=matches[0],source=lf(fn.body??fn.prosrc??'');
 need(source===expectedSource&&md5(source)==='d9679ba1d8fa229c754033144ec0bf42'
  &&[md5(source),md5(fn.body??fn.prosrc??'')].includes(fn.md5)
  &&fn.securityDefiner===false&&JSON.stringify(fn.config)===JSON.stringify(['search_path=""'])
  &&typeof fn.owner==='string'&&fn.owner.length>0&&typeof fn.definition==='string'
  &&lf(fn.definition).includes(source)&&(fn.args??fn.identityArgs??'')==='',
 'POST_BOOKING_ACTIVATION_EXACT_SOURCE_REQUIRED');
 need(source.split(marker).length===2,'POST_BOOKING_ACTIVATION_UNIQUE_DENIAL_REQUIRED');
 const after=source.replace(marker,hook+marker),afterMd5=md5(after);
 const sql=`DO $post_booking_reviewed_adapter$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_activation_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\\r\\n',E'\\n'),replace(prosrc,E'\\r\\n',E'\\n') INTO definition,body FROM pg_proc WHERE oid=${q(signature)}::regprocedure;
 IF body IS DISTINCT FROM ${q(source)} OR md5(body) IS DISTINCT FROM 'd9679ba1d8fa229c754033144ec0bf42'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=${q(signature)}::regprocedure AND pg_get_userbyid(proowner)=current_user AND NOT prosecdef AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=""'])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,${q(after)});
 INSERT INTO sales_activation_private.adapters VALUES(${q(signature)},'d9679ba1d8fa229c754033144ec0bf42','${afterMd5}',ARRAY['search_path=""'],false);
 PERFORM sales_activation_private.assert_catalog();
END;
$post_booking_reviewed_adapter$;`;
 return {version:'reviewed-post-booking-activation-adapter-v1',sql,signature,beforeMd5:md5(source),afterMd5,
  originalBody:source,adaptedBody:after,productionChanged:false,executed:false};
}
export function reviewedPostBookingActivationSql({root,catalog,reviewedInstallSql}){
 // The caller must review/prepare the executable installer separately; drafts
 // keep their abort sentinel. Never silently convert a production draft here.
 need(typeof reviewedInstallSql==='string'&&reviewedInstallSql.length>0,'POST_BOOKING_ACTIVATION_REVIEWED_INSTALLER_REQUIRED');
 const source=readFileSync(join(root,reviewedPostBookingActivationDraftPath),'utf8');
 need(source.includes("RAISE EXCEPTION 'DESIGN ONLY: reviewed post-booking activation requires whole replacement proof'"),
 'POST_BOOKING_ACTIVATION_DRAFT_SENTINEL_REQUIRED');
 const expectedInstaller=lf(source).replace(/^BEGIN;\n/m,'')
  .replace("DO $draft_only$ BEGIN RAISE EXCEPTION 'DESIGN ONLY: reviewed post-booking activation requires whole replacement proof'; END; $draft_only$;\n",'')
  .replace(/^ROLLBACK;\s*$/m,'').trim();
 need(lf(reviewedInstallSql).trim()===expectedInstaller
  &&!reviewedInstallSql.includes('RAISE EXCEPTION \'DESIGN ONLY:')
  &&!/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(reviewedInstallSql),
 'POST_BOOKING_ACTIVATION_REVIEWED_INSTALLER_REQUIRED');
 return {sql:`BEGIN;\n${reviewedInstallSql}\n${reviewedPostBookingActivationAdapter(catalog).sql}\nCOMMIT;`,draftSha256:createHash('sha256').update(source).digest('hex')};
}
export function postBookingActivationCommandSql(runId,reviewReference){
 need(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runId??'')&&typeof reviewReference==='string'&&reviewReference.trim()&&reviewReference.length<=1000,'POST_BOOKING_ACTIVATION_REVIEW_REQUIRED');
 return `BEGIN; SELECT sales_activation_private.activate(${q(runId)}::uuid,${q(reviewReference)}); COMMIT;`;
}
export function postBookingActivationRestoreSql(releaseId,reviewReference){
 need(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(releaseId??'')&&typeof reviewReference==='string'&&reviewReference.trim()&&reviewReference.length<=1000,'POST_BOOKING_ACTIVATION_REVIEW_REQUIRED');
 return `BEGIN; SELECT sales_activation_private.restore(${q(releaseId)}::uuid,${q(reviewReference)}); COMMIT;`;
}
