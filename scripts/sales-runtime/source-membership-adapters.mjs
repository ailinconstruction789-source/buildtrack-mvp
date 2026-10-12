/** Exact-source compiler for private source membership readers. No DB access. */
import { createHash } from 'node:crypto';
const md5 = text => createHash('md5').update(text.replace(/\r\n/g, '\n')).digest('hex');
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const relations = new Map([['sales_customers','customers'],['lead_project_interests','interests'],['sales','sales']]);

/** Lex SQL into code and opaque strings/comments; never alter SQL literals. */
export function sqlSegments(source) {
 const parts=[]; let cursor=0, start=0;
 while(cursor<source.length){
  let end=null;
  if(source.startsWith('--',cursor)){end=source.indexOf('\n',cursor);if(end<0)end=source.length;}
  else if(source.startsWith('/*',cursor)){let depth=1;end=cursor+2;while(depth&&end<source.length){if(source.startsWith('/*',end)){depth++;end+=2;}else if(source.startsWith('*/',end)){depth--;end+=2;}else end++;}if(depth)throw Error('Unterminated SQL comment');}
  else if(source[cursor]==="'" || source[cursor]==='"'){const quote=source[cursor];end=cursor+1;while(end<source.length){if(source[end]===quote){if(source[end+1]===quote){end+=2;continue;}end++;break;}if(source[end]==='\\'&&source[cursor-1]?.toLowerCase()==='e')end+=2;else end++;}if(source[end-1]!==quote)throw Error('Unterminated SQL string');}
  else if(source[cursor]==='$'){const tag=source.slice(cursor).match(/^\$(?:[A-Za-z_][\w]*)?\$/)?.[0];if(tag){end=source.indexOf(tag,cursor+tag.length);if(end<0)throw Error('Unterminated dollar literal');end+=tag.length;}}
  if(end!==null){if(start<cursor)parts.push({code:true,text:source.slice(start,cursor)});parts.push({code:false,text:source.slice(cursor,end)});cursor=end;start=end;}else cursor++;
 }
 if(start<source.length)parts.push({code:true,text:source.slice(start)});return parts;
}
export function rewriteSourceReads(source) {
 let changes=0,cursor=0,body='';
 const mask=sqlSegments(source).map(part=>part.code?part.text:' '.repeat(part.text.length)).join('');
 for(const match of mask.matchAll(/\b(FROM|JOIN)\s+public\.(sales_customers|lead_project_interests|sales)\b/gi)){
  if(match[1].toLowerCase()==='from'&&/\bDELETE\s*$/i.test(mask.slice(0,match.index)))continue;
  body+=source.slice(cursor,match.index)+`${match[1]} customer_source_membership_private.${relations.get(match[2].toLowerCase())}`;cursor=match.index+match[0].length;changes++;
 }
 body+=source.slice(cursor);return {body,changes};
}
function injectBegin(body, statement){
 const segments=sqlSegments(body);let done=false;
 const result=segments.map(part=>{if(done||!part.code)return part.text;return part.text.replace(/\bBEGIN\b/i,match=>{done=true;return `${match}\n ${statement}`;});}).join('');
 if(!done)throw Error('PL/pgSQL BEGIN required');return result;
}
const specialReaders = new Set(['sales_history_read_private.records','sales_history_read_private.original_excel','crm_excel_private.evidence','crm_excel_private.booking_amounts']);
const sqlReaders = new Set(['public.crm_v2_voice_row_readable']);
/** Preserve the complete legacy mapping integrity test, scoped only by the
 * reviewed original Lead identities after authoritative replacement activation.
 * No source Lead, status, identity link or cohort date is manufactured here. */
export function rewriteSalesReportLegacyGuard(body) {
 const marker=`IF EXISTS(SELECT 1 FROM public.leads legacy
    LEFT JOIN public.crm_legacy_lead_links link ON link.legacy_lead_id=legacy.id
    LEFT JOIN customer_source_membership_private.customers c ON c.id=link.customer_id
    LEFT JOIN customer_source_membership_private.interests i ON i.id=link.project_interest_id
    WHERE link.legacy_lead_id IS NULL OR c.id IS NULL OR c.merged_into_customer_id IS NOT NULL
      OR (link.project_interest_id IS NOT NULL AND (i.id IS NULL OR i.customer_id IS DISTINCT FROM link.customer_id))) THEN`;
 if(body.split(marker).length!==2)throw Error('Sales report legacy integrity guard changed');
 const scoped=marker.replace('WHERE link.legacy_lead_id IS NULL',
  'WHERE customer_source_membership_private.report_requires_legacy_mapping(legacy.id) AND (link.legacy_lead_id IS NULL')
  .replace('link.customer_id))) THEN','link.customer_id)))) THEN');
 return body.replace(marker,scoped);
}
export function compileSourceMembershipAdapters(catalog) {
 if(!Array.isArray(catalog)||catalog.length===0)throw Error('Reviewed pg_proc catalog required');
 const entries=[];const seen=new Set();
 for(const row of catalog){
  if(!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\([^;]*\)$/.test(row.signature??''))throw Error('Invalid function signature');
  if(seen.has(row.signature))throw Error('Duplicate function signature');seen.add(row.signature);
  const name=row.signature.slice(0,row.signature.indexOf('('));
  if(!name.startsWith('public.crm_v2_')&&!specialReaders.has(name))continue;
  if(typeof row.source!=='string')throw Error(`Unsupported function metadata: ${row.signature}`);
  const source=row.source.replace(/\r\n/g,'\n');const rewritten=rewriteSourceReads(source);
  // A full catalog can include role/normalization/capability SQL helpers. They
  // do not read canonical relations and must remain completely untouched.
  if(rewritten.changes===0&&!row.arguments?.includes('p_payload jsonb')&&!specialReaders.has(name))continue;
  if(!row.securityDefiner||!Array.isArray(row.settings)||typeof row.owner!=='string'||(row.language!=='plpgsql'&&!(row.language==='sql'&&sqlReaders.has(name)&&!row.arguments?.includes('p_payload jsonb'))))throw Error(`Unsupported function metadata: ${row.signature}`);
  let body=rewritten.body;
  if(name==='public.crm_v2_sales_report')body=rewriteSalesReportLegacyGuard(body);
  if(row.language==='sql'&&name==='public.crm_v2_voice_row_readable'){
   if(!/;\s*$/.test(body))throw Error('Voice RLS helper terminator changed');
   // Admin/Owner originally bypass the Sales-only interest subquery. Preserve
   // that authorization expression but reject an explicitly retired parent
   // for every role; nonexistent/legacy-unlinked visit semantics remain intact.
   body=`\n SELECT (${body.trim().replace(/;$/,'')}) AND NOT EXISTS(
  SELECT 1 FROM public.lead_visits retired_visit JOIN public.lead_project_interests retired_interest ON retired_interest.id=retired_visit.project_interest_id
  WHERE retired_visit.id=p_visit_id AND NOT customer_source_membership_private.interest_member(retired_interest.id));\n`;
  }
  if(row.arguments?.includes('p_payload jsonb'))body=injectBegin(body,'PERFORM customer_source_membership_private.assert_payload(p_payload);');
  if(name==='sales_history_read_private.records'){
   const marker='RETURN result;';if(body.split(marker).length!==2)throw Error('History return marker changed');
   body=body.replace(marker,'RETURN customer_source_membership_private.history(result,p_customer_id,p_interest_id,p_sale_id,p_project_name);');
  }
  // Scope source-row evidence independently of parent IDs. An excluded visit
  // can share a customer with an included row and must still be hidden.
  if(name==='sales_history_read_private.records'||name==='sales_history_read_private.original_excel'){
   const marker="s.disposition='mapped_for_review'";const count=body.split(marker).length-1;
   if(count===0)throw Error('Source evidence scope marker missing');
   body=body.replaceAll(marker,`${marker} AND customer_source_membership_private.source_member(s.batch_id,s.source_row)`);
  }
  if(body===source)continue;
  entries.push({...row,source,body,beforeMd5:md5(source),afterMd5:md5(body),relationReplacements:rewritten.changes});
 }
 if(entries.length===0)throw Error('No source membership adapters found');
 const sql=entries.map((entry,index)=>`DO $membership_adapter_${index}$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\\r\\n',E'\\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid=${q(entry.signature)}::regprocedure;
 d:=replace(d,E'\\r\\n',E'\\n');
 IF md5(b) IS DISTINCT FROM ${q(entry.beforeMd5)} OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM ${q(entry.owner)} OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY[${entry.settings.map(q).join(',')}]::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,${q(entry.body)});
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES(${q(entry.signature)},${q(entry.beforeMd5)},${q(entry.afterMd5)},ARRAY[${entry.settings.map(q).join(',')}]::text[]);
END; $membership_adapter_${index}$;`).join('\n');
 return {sql,entries:entries.map(({source,body,...metadata})=>metadata)};
}

export const sourceMembershipCatalogSql = `SELECT coalesce(jsonb_agg(jsonb_build_object('signature',quote_ident(n.nspname)||'.'||quote_ident(p.proname)||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')','source',p.prosrc,'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'settings',p.proconfig,'language',l.lanname,'arguments',pg_get_function_arguments(p.oid)) ORDER BY n.nspname,p.proname,p.oid),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE (n.nspname='public' AND p.proname LIKE 'crm_v2_%' AND p.prosecdef AND (l.lanname='plpgsql' OR (l.lanname='sql' AND p.proname='crm_v2_voice_row_readable')) AND (p.prosrc ~ 'public\\.(sales_customers|lead_project_interests|sales)\\M' OR pg_get_function_arguments(p.oid) LIKE '%p_payload jsonb%')) OR (n.nspname,p.proname) IN (('sales_history_read_private','records'),('sales_history_read_private','original_excel'),('crm_excel_private','evidence'),('crm_excel_private','booking_amounts'));`;
