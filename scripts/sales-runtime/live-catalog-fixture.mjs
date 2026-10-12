/** Reconstruct captured business objects in an EMPTY, owned loopback fixture.
 * This is not an installer or a production connection. Initial seed restoration
 * precedes trigger installation, like pg_restore; every canonical mutation must
 * follow finalize, with captured guards/sync/update triggers enabled unchanged.
 * No credential files, user storage, Auth sessions or tokens are read here.
 */
import { createHash } from 'node:crypto';
import { assertPlainSql, localConnectionArgs, verifyClusterIdentity } from './safety.mjs';

const quote = name => {
 if(typeof name!=='string'||!name.length||name.includes('\0'))throw new Error('Invalid catalog identifier');
 return '"'+name.replaceAll('"','""')+'"';
};
const qualified = (schema,name)=>quote(schema)+'.'+quote(name);
const literal = value=>"'"+value.replaceAll("'","''")+"'";
const list = value=>Array.isArray(value)?value:[];
const key = item=>(item.schema??item.table_schema??item.schemaname)+'.'+(item.table??item.table_name??item.tablename??item.name);
const checkedSql = sql=>{assertPlainSql(sql);return sql};
const statement = sql=>checkedSql(sql.trimEnd().endsWith(';')?sql:sql+';');
const tablePrivilege={a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN'};

/** Review aid only: never substitutes for actual captured catalog hash checks. */
export function sqlTokenFingerprint(source) {
 if(typeof source!=='string')throw new Error('SQL body required');
 const tokens=[];let at=0;
 while(at<source.length){
  if(/\s/.test(source[at])){at++;continue;}
  if(source.startsWith('--',at)){const end=source.indexOf('\n',at+2);at=end<0?source.length:end+1;continue;}
  if(source.startsWith('/*',at)){let depth=1;at+=2;while(at<source.length&&depth){if(source.startsWith('/*',at)){depth++;at+=2;}else if(source.startsWith('*/',at)){depth--;at+=2;}else at++;}if(depth)throw new Error('Unterminated SQL comment');continue;}
  if(source[at]==="'"||source[at]==='"'){
   const begin=at,quote=source[at++];let ended=false;
   const escapes=quote==="'"&&tokens.at(-1)==='e';
   while(at<source.length){if(escapes&&source[at]==='\\'){at+=2;}else if(source[at]===quote){at++;if(source[at]===quote)at++;else{ended=true;break;}}else at++;}
   if(!ended)throw new Error('Unterminated SQL literal');tokens.push(source.slice(begin,at));continue;
  }
  const tag=source.slice(at).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
  if(tag){const end=source.indexOf(tag,at+tag.length);if(end<0)throw new Error('Unterminated dollar literal');tokens.push(source.slice(at,end+tag.length));at=end+tag.length;continue;}
  const word=source.slice(at).match(/^[A-Za-z_][A-Za-z_0-9$]*/)?.[0];
  if(word){tokens.push(word.toLowerCase());at+=word.length;continue;}
  const number=source.slice(at).match(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0];
  if(number){tokens.push(number);at+=number.length;continue;}
  const operator=source.slice(at).match(/^(?:::|:=|<>|!=|<=|>=|\|\||->>|->|#>>|#>|\?&|\?\||@>|<@)/)?.[0];
  if(operator){tokens.push(operator);at+=operator.length;continue;}
  tokens.push(source[at++]);
 }
 return {tokens,tokenCount:tokens.length,sha256:createHash('sha256').update(JSON.stringify(tokens)).digest('hex')};
}

function aclGrants(acl,objectType,target,owner) {
 const chars=objectType==='FUNCTION'?{X:'EXECUTE'}:objectType==='SCHEMA'?{U:'USAGE',C:'CREATE'}:objectType==='SEQUENCE'?{r:'SELECT',w:'UPDATE',U:'USAGE'}:tablePrivilege;
 const statements=[],roles=new Set();
 for(const item of acl??[]){
  const match=/^(?:"((?:[^"]|"")*)"|([^=]*))=([^/]*)\/(?:"((?:[^"]|"")*)"|(.+))$/.exec(item);
  if(!match)throw new Error('Unsupported captured ACL encoding');
  const raw=(match[1]??match[2]).replaceAll('""','"');
  const role=raw==='postgres'?owner:raw||'PUBLIC';roles.add(role);
  for(let n=0;n<match[3].length;n++){
   const privilege=chars[match[3][n]];
   if(!privilege)throw new Error('Unsupported captured ACL privilege '+match[3][n]);
   const grantable=match[3][n+1]==='*';if(grantable)n++;
   statements.push(`GRANT ${privilege} ON ${objectType} ${target} TO ${role==='PUBLIC'?'PUBLIC':quote(role)}${grantable?' WITH GRANT OPTION':''};`);
  }
 }
 return {statements,roles};
}

function functionSignature(fn){
 const signature=fn.identityArgs??fn.identityArguments??fn.args;
 if(typeof signature!=='string')throw new Error('Captured function identity arguments required');
 // args is pg_get_function_identity_arguments, not caller supplied SQL.
 checkedSql(signature);
 return qualified(fn.schema,fn.name)+'('+signature+')';
}

function restoreViewOrder(views) {
 const remaining=[...views],done=[];
 while(remaining.length){
  const ready=remaining.find(v=>!remaining.some(other=>other!==v&&new RegExp('\\b(?:FROM|JOIN)\\s+(?:"?'+other.schema+'"?\\.)?"?'+other.name+'"?\\b','i').test(v.definition)));
  if(!ready)throw new Error('Captured view dependencies require an explicit reviewed restore order');
  done.push(ready);remaining.splice(remaining.indexOf(ready),1);
 }
 return done;
}

function normalizeSequence(captured) {
 return {...captured,schema:captured.schema??captured.schemaname,name:captured.name??captured.sequencename,
  type:captured.type??captured.data_type,increment:captured.increment??captured.increment_by,
  minimum:captured.minimum??captured.min_value,maximum:captured.maximum??captured.max_value,
  start:captured.start??captured.start_value,cache:captured.cache??captured.cache_size,
  lastValue:captured.lastValue??captured.last_value,isCalled:captured.isCalled??captured.is_called};
}
function sequenceOptions(sequence){
 return `INCREMENT BY ${sequence.increment} MINVALUE ${sequence.minimum} MAXVALUE ${sequence.maximum} START WITH ${sequence.start} CACHE ${sequence.cache} ${sequence.cycle?'CYCLE':'NO CYCLE'}`;
}

/** Pure builder. Missing enriched metadata stays an explicit readiness blocker. */
export function buildLiveCatalogFixturePlan({catalog,rowsByTable,ownedUser,emptyDataTables=[],schemaAcls,knownRoles=['anon','authenticated','service_role'],extensionSql=[]}) {
 if(!/^runtime_[a-f0-9]+$/.test(ownedUser??''))throw new Error('Owned fixture user required');
 if(!catalog||!Array.isArray(catalog.tables)||!Array.isArray(catalog.functions))throw new Error('Captured tables/functions required');
 if(!rowsByTable||typeof rowsByTable!=='object'||Array.isArray(rowsByTable))throw new Error('Explicit captured/sanitized rows required');
 const blockers=[],notes=[],requiredRoles=new Set(['anon','authenticated']),tables=catalog.tables,tableNames=new Set(tables.map(t=>t.schema+'.'+t.name)),seedRows=new Map();
 const functions=[...catalog.functions,...list(catalog.triggerFunctions)].filter((f,i,a)=>a.findIndex(x=>x.schema===f.schema&&x.name===f.name&&(x.args??x.identityArgs)===(f.args??f.identityArgs))===i);
 for(const name of ['indexes','tableGrants','sequences','views'])if(!Array.isArray(catalog[name]))blockers.push('Missing enriched '+name+' metadata');
 const capturedSchemaAcls=schemaAcls??catalog.schemaAcls;
 if(!Array.isArray(capturedSchemaAcls))blockers.push('Missing schema ACL/owner metadata');
 const schemas=new Set([...list(catalog.schemas).map(x=>typeof x==='string'?x:x.name??x.schema),...tables.map(x=>x.schema),...functions.map(x=>x.schema)]);
 const stages={schemas:[],prerequisiteFunctions:[],tables:[],functions:[],seed:[],constraints:[],indexes:[],foreignKeys:[],views:[],triggers:[],security:[]};
 const sequences=list(catalog.sequences).map(normalizeSequence),identitySequences=new Map();
 for(const table of tables)for(const column of table.columns.filter(c=>c.identity)){
  const ownerKey=table.schema+'.'+table.name+'.'+column.name;
  const sequence=sequences.find(s=>typeof s.ownedBy==='string'&&s.ownedBy.replaceAll('"','')===ownerKey);
  if(!sequence)blockers.push('Missing identity sequence ownership '+ownerKey);
  else{
   identitySequences.set(ownerKey,sequence);
   if(sequence.dependencyType&&sequence.dependencyType!=='i')blockers.push('Unexpected identity sequence dependency '+ownerKey);
   if(sequence.type!==column.type)blockers.push('Identity sequence data type mismatch '+ownerKey);
  }
 }
 for(const schema of schemas){
  if(schema==='auth')throw new Error('Auth schema must come only from the explicitly synthetic root stub');
  if(schema!=='public')stages.schemas.push(`CREATE SCHEMA ${quote(schema)} AUTHORIZATION ${quote(ownedUser)};`);
 }
 stages.schemas.push(...extensionSql.map(checkedSql));
 for(const sequence of sequences){
  const name=qualified(sequence.schema,sequence.name);
  const identityOwned=[...identitySequences.values()].includes(sequence);
  if([sequence.increment,sequence.minimum,sequence.maximum,sequence.start,sequence.cache,sequence.lastValue].some(x=>typeof x==='number'&&!Number.isSafeInteger(x)))
   blockers.push('Unsafe rounded sequence integer metadata '+sequence.schema+'.'+sequence.name+'; recapture as text');
  if(sequence.definition&&!identityOwned)stages.schemas.push(statement(sequence.definition));
  else if(sequence.type&&sequence.increment!=null&&sequence.minimum!=null&&sequence.maximum!=null&&sequence.start!=null&&sequence.cache!=null){
   if(!identityOwned)stages.schemas.push(`CREATE SEQUENCE ${name} AS ${sequence.type} ${sequenceOptions(sequence)};`);
  }else blockers.push('Incomplete sequence definition '+sequence.schema+'.'+sequence.name);
  if(sequence.lastValue!=null&&typeof sequence.isCalled==='boolean')stages.seed.push(`SELECT setval(${literal(sequence.schema+'.'+sequence.name)}::regclass,${literal(String(sequence.lastValue))}::bigint,${sequence.isCalled});`);
  else blockers.push('Missing sequence state '+sequence.schema+'.'+sequence.name);
  if(sequence.ownedBy&&!identityOwned)stages.constraints.push(`ALTER SEQUENCE ${name} OWNED BY ${sequence.ownedBy};`);
  if(!Object.hasOwn(sequence,'ownedBy'))blockers.push('Missing sequence ownership dependency '+sequence.schema+'.'+sequence.name);
  const sequenceOwner=sequence.owner??sequence.sequenceowner;
  if(sequenceOwner&&sequenceOwner!=='postgres'&&sequenceOwner!==ownedUser)blockers.push('Unreviewed sequence owner '+sequence.schema+'.'+sequence.name);
  if(sequence.acl){const grants=aclGrants(sequence.acl,'SEQUENCE',name,ownedUser);grants.roles.forEach(r=>requiredRoles.add(r));
   stages.security.push(`REVOKE ALL ON SEQUENCE ${name} FROM PUBLIC,${knownRoles.map(quote).join(',')};`,...grants.statements);}
  else blockers.push('Missing sequence ACL '+sequence.schema+'.'+sequence.name);
 }
 // Disable only CREATE-time function validation for circular SQL dependencies.
 // Every captured definition/body/config is copied unchanged and checked after.
 stages.prerequisiteFunctions.push('SET check_function_bodies=off;');
 for(const fn of functions){
  if(fn.owner!=='postgres'&&fn.owner!==ownedUser)blockers.push('Unreviewed function owner '+fn.schema+'.'+fn.name+': '+fn.owner);
  if(typeof fn.body==='string'&&fn.md5){
   const raw=createHash('md5').update(fn.body).digest('hex'),lf=createHash('md5').update(fn.body.replaceAll('\r\n','\n')).digest('hex');
   if(raw!==fn.md5&&lf!==fn.md5)throw new Error('Captured function body hash mismatch '+fn.schema+'.'+fn.name);
   if(raw!==fn.md5)notes.push('Captured LF-normalized MD5 verified; unchanged raw definition copied for '+fn.schema+'.'+fn.name);
  }
  const header=fn.definition.slice(0,fn.definition.search(/\nAS\s|\sAS\s/));
  const needsComposite=tables.some(t=>new RegExp('(?:RETURNS|IN|OUT|INOUT|VARIADIC)\\s+(?:SETOF\\s+)?(?:"?'+t.schema+'"?\\.)?"?'+t.name+'"?(?:\\W|$)','i').test(header));
  stages[needsComposite?'functions':'prerequisiteFunctions'].push(statement(fn.definition));
  const signature=functionSignature(fn);
  stages.functions.push(`ALTER FUNCTION ${signature} OWNER TO ${quote(ownedUser)};`);
  const grants=aclGrants(fn.acl??['=X/postgres','postgres=X/postgres'],'FUNCTION',signature,ownedUser);
  grants.roles.forEach(r=>requiredRoles.add(r));
  stages.security.push(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,${knownRoles.map(quote).join(',')};`,...grants.statements);
 }
 for(const table of tables){
  const tableKey=table.schema+'.'+table.name,name=qualified(table.schema,table.name);
  if(table.owner&&table.owner!=='postgres'&&table.owner!==ownedUser)blockers.push('Unreviewed table owner '+tableKey);
  const definitions=table.columns.map(column=>{
   if(column.identity&&!['a','d'].includes(column.identity))throw new Error('Unsupported identity mode');
   if(column.generated&&!['s'].includes(column.generated))throw new Error('Unsupported generated column mode');
   let sql=quote(column.name)+' '+column.type;
   if(column.generated){if(!column.default)throw new Error('Generated expression missing');sql+=' GENERATED ALWAYS AS ('+column.default+') STORED';}
   else if(column.identity){
    const sequence=identitySequences.get(tableKey+'.'+column.name);
    sql+=' GENERATED '+(column.identity==='a'?'ALWAYS':'BY DEFAULT')+' AS IDENTITY'+(sequence?' (SEQUENCE NAME '+qualified(sequence.schema,sequence.name)+' '+sequenceOptions(sequence)+')':'');
   }
   else if(column.default!=null)sql+=' DEFAULT '+column.default;
   if(column.notNull)sql+=' NOT NULL';
   return checkedSql(sql);
  });
  stages.tables.push(`CREATE TABLE ${name} (${definitions.join(',\n')});`);
  let rows=rowsByTable[tableKey];
  if(!Array.isArray(rows)){if(emptyDataTables.includes(tableKey)){rows=[];notes.push('Explicitly unseeded dependency table '+tableKey);}else{blockers.push('Missing explicit data capture '+tableKey);rows=[];}}
  if(tableKey==='public.users'){
   if(rows.some(row=>!Object.hasOwn(row,'id')||Object.keys(row).some(x=>!['id','role'].includes(x))||(Object.hasOwn(row,'role')&&typeof row.role!=='string')))
    throw new Error('public.users seed must contain only sanitized id and optional explicitly captured business role');
   rows=rows.map(row=>({id:row.id,username:'fixture-user-'+row.id,role:Object.hasOwn(row,'role')?row.role:'fixture'}));
   notes.push('public.users username is a synthetic fixture label; optional business role is copied from explicit sanitized capture, with absent roles labeled fixture; actual CRM authority comes from captured private reviewed roles');
  }
  const columns=table.columns.filter(x=>!x.generated),names=new Set(table.columns.map(x=>x.name));
  for(const row of rows)if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(x=>!names.has(x)))throw new Error('Unknown seed column in '+tableKey);
  if(rows.some(row=>Object.keys(row).some(name=>/^(?:pin|password|secret|access_token|refresh_token|token_hash)$/i.test(name))))
   throw new Error('Credential-bearing rows must not be read or seeded in '+tableKey);
  seedRows.set(tableKey,rows);
  if(rows.length){const projection=columns.map(x=>quote(x.name)).join(',');
   // Full captured rows are typed by PostgreSQL itself; generated columns are
   // recomputed from the unchanged captured expressions, never copied blindly.
   stages.seed.push(`INSERT INTO ${name} (${projection})${columns.some(x=>x.identity==='a')?' OVERRIDING SYSTEM VALUE':''} SELECT ${projection} FROM jsonb_populate_recordset(NULL::${name},${literal(JSON.stringify(rows))}::jsonb);`);
  }
  for(const constraint of list(table.constraints)){
   if(constraint.type==='f'&&constraint.refSchema!=='auth'&&!tableNames.has(constraint.refSchema+'.'+constraint.refTable))blockers.push('Missing FK parent '+constraint.refSchema+'.'+constraint.refTable);
   stages[constraint.type==='f'?'foreignKeys':'constraints'].push(checkedSql(`ALTER TABLE ${name} ADD CONSTRAINT ${quote(constraint.name)} ${constraint.definition};`));
  }
  for(const trigger of list(table.triggers)){
   if(!['O','D','A','R'].includes(trigger.enabled))throw new Error('Unsupported trigger state');
   stages.triggers.push(checkedSql(trigger.definition+';'));
   const mode={O:'ENABLE',D:'DISABLE',A:'ENABLE ALWAYS',R:'ENABLE REPLICA'}[trigger.enabled];
   stages.triggers.push(`ALTER TABLE ${name} ${mode} TRIGGER ${quote(trigger.name)};`);
  }
  stages.security.push(`ALTER TABLE ${name} ${table.rls?'ENABLE':'DISABLE'} ROW LEVEL SECURITY;`);
  stages.security.push(`ALTER TABLE ${name} ${table.forceRls?'FORCE':'NO FORCE'} ROW LEVEL SECURITY;`);
  for(const policy of list(table.policies)){
   const roles=list(policy.roles).map(r=>r.toLowerCase()==='public'?'PUBLIC':r==='postgres'?ownedUser:r);roles.forEach(r=>requiredRoles.add(r));
   if(!['ALL','SELECT','INSERT','UPDATE','DELETE'].includes(policy.cmd)||!['PERMISSIVE','RESTRICTIVE'].includes(policy.permissive))throw new Error('Unsupported captured policy');
   stages.security.push(checkedSql(`CREATE POLICY ${quote(policy.policyname)} ON ${name} AS ${policy.permissive} FOR ${policy.cmd} TO ${roles.map(r=>r==='PUBLIC'?'PUBLIC':quote(r)).join(',')}${policy.qual!=null?' USING ('+policy.qual+')':''}${policy.with_check!=null?' WITH CHECK ('+policy.with_check+')':''};`));
  }
  stages.security.push(`REVOKE ALL ON TABLE ${name} FROM PUBLIC,${knownRoles.map(quote).join(',')};`);
 }
 for(const index of list(catalog.indexes)){
  const parent=tables.find(t=>t.schema===(index.schema??index.table_schema)&&t.name===(index.table??index.table_name));
  const indexName=index.name??index.indexname;
  if(index.constraintName||index.isConstraint||parent?.constraints?.some(c=>['p','u','x'].includes(c.type)&&c.name===indexName))continue;
  stages.indexes.push(checkedSql((index.definition??index.indexdef)+';'));
 }
 const views=list(catalog.views).map(v=>({...v,schema:v.schema??v.schemaname,name:v.name??v.viewname,owner:v.owner??v.viewowner}));
 for(const view of restoreViewOrder(views)){
  if(view.owner&&view.owner!=='postgres'&&view.owner!==ownedUser)blockers.push('Unreviewed view owner '+view.schema+'.'+view.name);
  if(!Object.hasOwn(view,'options')&&!Object.hasOwn(view,'reloptions'))blockers.push('Missing view security options '+view.schema+'.'+view.name);
  const options=view.options??view.reloptions;
  const clause=options?.length?' WITH ('+options.map(checkedSql).join(',')+')':'';
  stages.views.push(checkedSql(/^CREATE\b/i.test(view.definition)?view.definition:`CREATE VIEW ${qualified(view.schema,view.name)}${clause} AS ${view.definition};`));
  stages.security.push(`REVOKE ALL ON TABLE ${qualified(view.schema,view.name)} FROM PUBLIC,${knownRoles.map(quote).join(',')};`);
 }
 for(const grant of list(catalog.tableGrants)){
  const privilege=grant.privilege??grant.privilegeType??grant.privilege_type;
  if(!Object.values(tablePrivilege).includes(privilege))throw new Error('Unsupported table grant privilege');
  const role=grant.grantee==='postgres'?ownedUser:grant.grantee?.toUpperCase()==='PUBLIC'?'PUBLIC':grant.grantee;requiredRoles.add(role);
  const schema=grant.schema??grant.table_schema,name=grant.table??grant.table_name;
  const grantable=grant.grantable===true||grant.isGrantable==='YES'||grant.is_grantable==='YES';
  stages.security.push(`GRANT ${privilege} ON TABLE ${qualified(schema,name)} TO ${role==='PUBLIC'?'PUBLIC':quote(role)}${grantable?' WITH GRANT OPTION':''};`);
 }
 for(const schema of list(capturedSchemaAcls)){
  const schemaName=schema.name??schema.schema;
  if(schema.owner&&schema.owner!=='postgres'&&schema.owner!==ownedUser&&!(schemaName==='public'&&schema.owner==='pg_database_owner'))blockers.push('Unreviewed schema owner '+schemaName+': '+schema.owner);
  const grants=aclGrants(schema.acl??['postgres=UC/postgres'],'SCHEMA',quote(schemaName),ownedUser);grants.roles.forEach(r=>requiredRoles.add(r));
  stages.security.push(`REVOKE ALL ON SCHEMA ${quote(schemaName)} FROM PUBLIC,${knownRoles.map(quote).join(',')};`,...grants.statements);
 }
 const authTriggers=list(catalog.authTriggers);
 if(functions.some(fn=>fn.name==='assert_crm_review_ready'&&fn.definition.includes('buildtrack_crm_auth_revocation'))&&!authTriggers.some(t=>t.name==='buildtrack_crm_auth_revocation'))
  blockers.push('Missing business-owned Auth revocation trigger metadata (synthetic auth.users only)');
 for(const trigger of authTriggers){
  if(trigger.schema!=='auth'||trigger.table!=='users'||trigger.name!=='buildtrack_crm_auth_revocation'||!['O','D','A','R'].includes(trigger.enabled))
   throw new Error('Only captured business-owned Auth revocation trigger is allowed on synthetic Auth');
  stages.triggers.push(statement(trigger.definition));
  const mode={O:'ENABLE',D:'DISABLE',A:'ENABLE ALWAYS',R:'ENABLE REPLICA'}[trigger.enabled];
  stages.triggers.push(`ALTER TABLE "auth"."users" ${mode} TRIGGER ${quote(trigger.name)};`);
 }
 const knownFunctionNames=new Set(functions.map(f=>f.schema+'.'+f.name));
 const accountFunctionRefs=[...new Set(functions.flatMap(fn=>[...fn.definition.matchAll(/\baccount_security_private\.([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)].map(m=>'account_security_private.'+m[1])))];
 // INSERT INTO schema.table(columns) is a relation reference, not a function
 // call. Captured authorization ledgers use that shape in several helpers.
 for(const ref of accountFunctionRefs)if(!knownFunctionNames.has(ref)&&!tableNames.has(ref))blockers.push('Missing captured authorization function '+ref);
 for(const fn of functions.filter(f=>['crm_v2_role','current_crm_role','current_actor','guard_crm_role_projection','guard_materialized_history','materialize_crm'].includes(f.name))){
  const roleTableRefs=[...new Set([...fn.definition.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+account_security_private\.([A-Za-z_][A-Za-z_0-9]*)/gi)].map(m=>'account_security_private.'+m[1]))];
  for(const ref of roleTableRefs)if(!tableNames.has(ref))blockers.push('Missing captured authorization relation '+ref+' used by '+fn.schema+'.'+fn.name);
 }
 for(const table of tables)for(const constraint of list(table.constraints).filter(c=>c.type==='f'&&c.refSchema!=='auth')){
  const match=/^FOREIGN KEY \(([^)]+)\) REFERENCES (?:(?:"(?:[^"]|"")*"|[^\s.(]+)\.)?(?:"(?:[^"]|"")*"|[^\s(]+)\(([^)]+)\)/.exec(constraint.definition);
  if(!match){blockers.push('FK data closure needs reviewed column mapping '+table.schema+'.'+table.name+'.'+constraint.name);continue;}
  const columns=match[1].split(',').map(x=>x.trim().replace(/^"|"$/g,'').replaceAll('""','"'));
  const refColumns=match[2].split(',').map(x=>x.trim().replace(/^"|"$/g,'').replaceAll('""','"'));
  const parents=seedRows.get(constraint.refSchema+'.'+constraint.refTable)??[],children=seedRows.get(table.schema+'.'+table.name)??[];
  const keys=new Set(parents.map(row=>JSON.stringify(refColumns.map(name=>row[name]))));
  const unmatched=children.filter(row=>columns.every(name=>row[name]!=null)&&!keys.has(JSON.stringify(columns.map(name=>row[name])))).length;
  if(unmatched)blockers.push('Missing seeded FK parent '+constraint.refSchema+'.'+constraint.refTable+' for '+table.schema+'.'+table.name+'.'+constraint.name+' ('+unmatched+' child rows)');
 }
 for(const table of tables)for(const trigger of list(table.triggers)){
  const target=/EXECUTE FUNCTION\s+([^\s(]+)/i.exec(trigger.definition)?.[1]?.replaceAll('"','');
  if(target&&!knownFunctionNames.has(target.includes('.')?target:'public.'+target))blockers.push('Missing captured trigger function '+target);
 }
 if(tables.some(t=>t.columns.some(c=>c.default?.includes('uuid_generate_v4(')))&&!functions.some(f=>f.name==='uuid_generate_v4')&&!extensionSql.length)
  blockers.push('uuid_generate_v4 requires reviewed local uuid-ossp extension or explicit labeled synthetic stub');
 stages.security.push('SET check_function_bodies=on;');
 return {version:'captured-business-fixture-plan-v1',ready:blockers.length===0,blockers:[...new Set(blockers)],notes,requiredRoles:[...requiredRoles].filter(x=>x!=='PUBLIC'&&x!==ownedUser),
  stages,counts:{tables:tables.length,functions:functions.length,sourceSeedRows:Object.values(rowsByTable).reduce((n,x)=>n+(Array.isArray(x)?x.length:0),0)},
  expectedFunctions:functions.map(fn=>({schema:fn.schema,name:fn.name,args:fn.identityArgs??fn.identityArguments??fn.args,
   rawMd5:typeof fn.body==='string'?createHash('md5').update(fn.body).digest('hex'):null,
   lfMd5:typeof fn.body==='string'?createHash('md5').update(fn.body.replaceAll('\r\n','\n')).digest('hex'):null,owner:ownedUser,securityDefiner:fn.securityDefiner??false,config:fn.config??null})),
  expectedTriggers:[...tables.flatMap(t=>list(t.triggers).map(x=>({schema:t.schema,table:t.name,name:x.name,enabled:x.enabled}))),...authTriggers.map(x=>({schema:x.schema,table:x.table,name:x.name,enabled:x.enabled}))],
  scope:'actual captured business objects/data with explicitly synthetic Auth and sanitized public.users; not Supabase Auth or production recovery'};
}

/** query belongs to root's already verified fresh-cluster closure. */
export async function restoreLiveCatalogFixture({query,connection,plan}) {
 localConnectionArgs(connection?.port,connection?.database,connection?.user);
 const identity=JSON.parse(await query("SELECT json_build_object('address',host(inet_server_addr()),'port',inet_server_port(),'user',current_user,'database',current_database(),'data',current_setting('data_directory'),'listen',current_setting('listen_addresses'),'marker',current_setting('buildtrack.synthetic_runtime',true));"));
 verifyClusterIdentity(identity,connection);
 if(!plan?.ready)throw new Error('Captured fixture is not ready: '+(plan?.blockers??[]).join('; '));
 const existing=Number(await query("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN('information_schema','auth') AND c.relkind IN('r','p','m','v','S');"));
 if(existing!==0)throw new Error('Captured fixture requires an empty business database; no overwrite allowed');
 // Full restore is one transaction. Root query retains the same connection only
 // per call, so a single SQL batch is required for CREATE-time validation GUCs.
 const sql=['BEGIN;SET LOCAL search_path=public,pg_catalog;',...Object.values(plan.stages).flat(),'COMMIT;'].join('\n');
 checkedSql(sql);await query(sql);
 const functionChecks=JSON.parse(await query("SELECT COALESCE(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'config',p.proconfig) ORDER BY n.nspname,p.proname),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN('information_schema','auth');"));
 for(const expected of plan.expectedFunctions){
  const actual=functionChecks.find(x=>x.schema===expected.schema&&x.name===expected.name&&x.args===expected.args);
  if(!actual||(expected.rawMd5&&actual.md5!==expected.rawMd5&&actual.md5!==expected.lfMd5)||actual.owner!==expected.owner||actual.securityDefiner!==expected.securityDefiner||JSON.stringify(actual.config)!==JSON.stringify(expected.config))
   throw new Error('Captured fixture function differs from original '+expected.schema+'.'+expected.name);
 }
 const triggerChecks=JSON.parse(await query("SELECT COALESCE(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled) ORDER BY n.nspname,c.relname,t.tgname),'[]'::jsonb) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname !~ '^pg_';"));
 for(const expected of plan.expectedTriggers)if(!triggerChecks.some(actual=>Object.keys(expected).every(k=>actual[k]===expected[k])))
  throw new Error('Captured fixture trigger missing/changed '+expected.schema+'.'+expected.table+'.'+expected.name);
 return {passed:true,counts:plan.counts,notes:plan.notes,functionChecks,triggerChecks,guardsInstalledBeforeCanonicalWrites:true,production:false};
}
