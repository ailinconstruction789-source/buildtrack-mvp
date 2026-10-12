/** Synthetic Auth dependencies ONLY for a new, verified owned loopback fixture.
 * No live Auth rows, sessions, credentials, JWTs or storage are read. This plan
 * retains the captured business helpers unchanged; it is not Supabase Auth.
 */
import { assertPlainSql } from './safety.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const identifier=value=>'"'+value.replaceAll('"','""')+'"';
const checked=sql=>{assertPlainSql(sql);return sql;};

export function buildOwnedSyntheticAuthPlan({ownedUser,users,sessions}) {
 if(!/^runtime_[a-f0-9]+$/.test(ownedUser??''))throw new Error('Owned fixture user required');
 if(!Array.isArray(users)||!Array.isArray(sessions))throw new Error('Explicit synthetic Auth users and local sessions required');
 const ids=new Set();
 for(const user of users){
  if(typeof user!=='string'||!uuid.test(user)||ids.has(user.toLowerCase()))throw new Error('Unique business Auth UUIDs required');
  ids.add(user.toLowerCase());
 }
 const sessionIds=new Set();
 for(const session of sessions){
  if(!session||typeof session!=='object'||Array.isArray(session)||Object.keys(session).some(k=>!['id','userId','notAfter'].includes(k))
   ||!uuid.test(session.id??'')||!uuid.test(session.userId??'')||!ids.has(session.userId.toLowerCase())||sessionIds.has(session.id.toLowerCase()))
   throw new Error('Explicit unique local session UUID and matching synthetic user required');
  if(session.notAfter!=null&&(typeof session.notAfter!=='string'||!Number.isFinite(Date.parse(session.notAfter))))throw new Error('Synthetic session expiry must be an explicit timestamp or null');
  sessionIds.add(session.id.toLowerCase());
 }
 const sql=[
  `CREATE SCHEMA auth AUTHORIZATION ${identifier(ownedUser)};`,
  'CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,is_anonymous boolean NOT NULL DEFAULT false,banned_until timestamptz);',
  'CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),not_after timestamptz);',
  `CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;`,
  `CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$SELECT NULLIF(auth.jwt()->>'sub','')::uuid$$;`,
  `CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$SELECT auth.jwt()->>'role'$$;`,
  'REVOKE ALL ON SCHEMA auth FROM PUBLIC;',
  'GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;',
  'REVOKE ALL ON FUNCTION auth.jwt(),auth.uid(),auth.role() FROM PUBLIC;',
  'GRANT EXECUTE ON FUNCTION auth.jwt(),auth.uid(),auth.role() TO anon,authenticated,service_role;',
 ];
 if(users.length)sql.push('INSERT INTO auth.users(id) VALUES '+users.map(id=>'('+literal(id)+'::uuid)').join(',')+';');
 if(sessions.length)sql.push('INSERT INTO auth.sessions(id,user_id,not_after) VALUES '+sessions.map(s=>'('+literal(s.id)+'::uuid,'+literal(s.userId)+'::uuid,'+(s.notAfter==null?'NULL':literal(s.notAfter)+'::timestamptz')+')').join(',')+';');
 const bootstrapSql=checked(sql.join('\n'));
 return {
  version:'owned-synthetic-auth-dependencies-v1',bootstrapSql,
  counts:{users:users.length,sessions:sessions.length},
  claimsSql({authUserId,sessionId}) {
   if(!uuid.test(authUserId??'')||!uuid.test(sessionId??'')||!sessions.some(s=>s.id.toLowerCase()===sessionId.toLowerCase()&&s.userId.toLowerCase()===authUserId.toLowerCase()))
    throw new Error('Claims require the matching explicitly seeded synthetic session');
   const claims=JSON.stringify({sub:authUserId,session_id:sessionId,role:'authenticated'});
   // Must execute in the same SQL batch / transaction as the actual helper call.
   return checked('SELECT set_config(\'request.jwt.claims\','+literal(claims)+',true);');
  },
  scope:'locally generated session identities and synthetic Auth status only; actual captured business authorization helpers unchanged; not live Auth or production authorization',
  production:false,
 };
}
