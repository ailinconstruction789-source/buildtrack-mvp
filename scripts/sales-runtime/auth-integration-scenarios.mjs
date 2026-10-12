// Executes exact deployed identity/session functions against synthetic records.
// This tests DB guards; it does not start GoTrue or validate a JWT signature.
import {actorId,sessionId,asIntegrationActor,seedIntegrationActor} from './integration-base.mjs';
export async function runAuthIntegration({query,applyDraft}) {
  const roles=['Admin','Owner','Sales','Foreman','Site Engineer','QC','Project Planner','Procurement','Store'];
  const cases=[];
  const equal=(a,b,label)=>{if(a!==b)throw Error(label+': '+a+' != '+b);cases.push(label);};
  const deny=async(sql,pattern,label)=>{try{await query(sql);}catch(e){if(!pattern.test(e.message))throw Error(label+': '+e.message);cases.push(label);return;}throw Error(label+': accepted');};
  for(const [index,role] of roles.entries())await seedIntegrationActor(query,index+1,role);
  // The live facade/helper are closed to clients. Test the exact internal actor
  // guard as its definer owner, and separately prove client EXECUTE stays denied.
  const actor=(n,claims={})=>asIntegrationActor(n,'SELECT account_security_private.current_actor();',{claims,role:'postgres'});
  const crm=(n,readOnly=false,claims={})=>asIntegrationActor(n,"SELECT coalesce(nullif(public.crm_v2_role(),''),'DENIED');",{readOnly,claims});
  for(const phase of ['before','after']) {
    if(phase==='after')await applyDraft();
    for(const [index,role] of roles.entries()) {
      const n=index+1,value=JSON.parse(await query(actor(n,{user_metadata:{role:'Admin'},app_metadata:{role:'Admin'}})));
      equal(value.role,role,phase+' canonical actor ignores metadata '+role);
      equal(value.authUserId,actorId(n),phase+' canonical Auth identity '+role);
      equal(value.canManageAccounts,role==='Admin',phase+' reviewed Admin approval '+role);
      for(const readOnly of [false,true])equal(await query(crm(n,readOnly)),['Admin','Owner','Sales'].includes(role)?role.toLowerCase():'DENIED',phase+' CRM projection '+role+' readonly='+readOnly);
    }
    for(const [label,claims] of [
      ['missing Auth identity',{sub:null}],['malformed identity',{sub:'bad-uuid'}],
      ['missing session',{session_id:null}],['malformed session',{session_id:'bad-uuid'}],
      ['another account session',{session_id:sessionId(2)}],['nonexistent session',{session_id:sessionId(99)}]
    ]) {
      await deny(actor(3,claims),/APP_ACTOR_REQUIRED|invalid input syntax for type uuid/,phase+' actor denies '+label);
      for(const readOnly of [false,true]) {
        if(label==='malformed identity')await deny(crm(3,readOnly,claims),/invalid input syntax for type uuid/,phase+' CRM rejects malformed identity readonly='+readOnly);
        else equal(await query(crm(3,readOnly,claims)),'DENIED',phase+' CRM denies '+label+' readonly='+readOnly);
      }
    }
    const mutations=[
      ['banned user',`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${actorId(3)}'`,`UPDATE auth.users SET banned_until=NULL WHERE id='${actorId(3)}'`],
      ['deleted user',`UPDATE auth.users SET deleted_at=now() WHERE id='${actorId(3)}'`,`UPDATE auth.users SET deleted_at=NULL WHERE id='${actorId(3)}'`],
      ['anonymous Auth user',`UPDATE auth.users SET is_anonymous=true WHERE id='${actorId(3)}'`,`UPDATE auth.users SET is_anonymous=false WHERE id='${actorId(3)}'`],
      ['expired session',`UPDATE auth.sessions SET not_after=now()-interval '1 hour' WHERE id='${sessionId(3)}'`,`UPDATE auth.sessions SET not_after=NULL WHERE id='${sessionId(3)}'`],
      ['disabled reviewed binding',`UPDATE account_security_private.reviewed_roles SET enabled=false WHERE auth_user_id='${actorId(3)}'`,`UPDATE account_security_private.reviewed_roles SET enabled=true WHERE auth_user_id='${actorId(3)}'`]
    ];
    for(const [label,change,restore] of mutations) {
      await query(change+';');await deny(actor(3),/APP_ACTOR_REQUIRED/,phase+' actor denies '+label);
      for(const readOnly of [false,true])equal(await query(crm(3,readOnly)),'DENIED',phase+' CRM denies '+label+' readonly='+readOnly);
      await query(restore+';');
    }
    for(const [label,change,restore] of [
      ['inactive projection',`UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${actorId(3)}'`,`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${actorId(3)}'`],
      ['stale projection review',`UPDATE sales_private.crm_user_roles SET trusted_review_revision=2 WHERE user_id='${actorId(3)}'`,`UPDATE sales_private.crm_user_roles SET trusted_review_revision=1 WHERE user_id='${actorId(3)}'`],
      ['projection role mismatch',`UPDATE sales_private.crm_user_roles SET role='admin' WHERE user_id='${actorId(3)}'`,`UPDATE sales_private.crm_user_roles SET role='sales' WHERE user_id='${actorId(3)}'`]
    ]) {
      await query(change+';');for(const readOnly of [false,true])equal(await query(crm(3,readOnly)),'DENIED',phase+' CRM denies '+label+' readonly='+readOnly);await query(restore+';');
    }
    await deny(`UPDATE sales_private.crm_user_roles SET trusted_review_revision=0 WHERE user_id='${actorId(3)}';`,/crm_user_roles_trusted_review_revision_check/,phase+' invalid active review revision fails real check constraint');
    await query(`DELETE FROM auth.sessions WHERE id='${sessionId(3)}';`);
    await deny(actor(3),/APP_ACTOR_REQUIRED/,phase+' deleted session invalidates old claims');
    for(const readOnly of [false,true])equal(await query(crm(3,readOnly)),'DENIED',phase+' CRM rejects signed-out session readonly='+readOnly);
    await query(`INSERT INTO auth.sessions(id,user_id) VALUES('${sessionId(3)}','${actorId(3)}');`);
    await deny(asIntegrationActor(3,'SELECT account_security_private.current_actor();'),/permission denied/,phase+' private actor not a second client entry point');
    await deny(asIntegrationActor(3,'SELECT public.app_current_actor();'),/permission denied/,phase+' trusted actor facade remains closed until reviewed activation');
    await deny(asIntegrationActor(3,'SELECT public.app_current_actor();',{role:'anon',claims:{}}),/permission denied/,phase+' anon actor facade denied');
    equal(JSON.parse(await query(actor(3))).role,'Sales',phase+' valid session restored');
  }
  return {assertions:cases.length,cases,exactFunctions:6,syntheticReviewedRoles:roles,authAndCrmBehaviorParity:true,
    limitations:['Synthetic Auth users/sessions/review bindings and request claims in disposable PostgreSQL','Actor helper runs as its owner; actual app_current_actor and private actor client EXECUTE remain denied, so trusted-login UI activation is not demonstrated','Actual auth.uid/jwt and actor/CRM source, but no JWT signature, login/password/refresh or HTTP/API test','Auth-side revocation triggers and unrelated projection seals are not installed in this narrow guard suite','Not a live business write or real-phone/performance measurement']};
}
