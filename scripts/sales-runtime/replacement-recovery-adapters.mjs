// Exact post-31 catalog adapters. No connection or SQL execution. A separately
// reviewed actual catalog is mandatory; caller must not pass guessed bodies.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const hash = (value, algorithm='md5') => createHash(algorithm).update(value).digest('hex');
const normalize = value => value.replaceAll('\r\n','\n');
const q = value => `'${String(value).replaceAll("'","''")}'`;
const requireValue = (ok, code) => { if (!ok) throw new Error(code); };
const definitions = [
 ['sales_private','crm_booking_protect_sale',''],
 ['crm_external_private','guard_cutover_sale',''],
 ['sales_revision_private','marker_guard',''],
 ['sales_private','crm_customer_deal_details_guard',''],
 ['sales_import_private','forecast_guard',''],
 ['crm_external_private','guard_booking_plot_stock',''],
 ['public','update_sales_updated_at_column',''],
 ['customer_source_membership_private','customer_member','uuid'],
 ['customer_source_membership_private','interest_member','uuid'],
 ['sales_revision_private','assert_stock_catalog',''],
 ['customer_source_membership_private','assert_catalog',''],
 ['sales_history_read_private','records','uuid,uuid,uuid,text'],
 ['sales_history_read_private','original_excel','text'],
 ['sales_revision_private','history','jsonb,jsonb'],
];
const signature = ([schema,name,args]) => `${schema}.${name}(${args})`;
const bodyOf = (functions,definition) => {
 const [schema,name] = definition, found = functions.filter(fn=>fn.schema===schema&&fn.name===name);
 requireValue(found.length===1,'RECOVERY_EXACT_CATALOG_FUNCTION_REQUIRED:'+signature(definition));
 const fn=found[0], body=normalize(fn.body ?? fn.prosrc ?? '');
 requireValue(body.length>0 && typeof fn.definition==='string' && normalize(fn.definition).includes(body)
  && /^[a-f0-9]{32}$/.test(fn.md5??'') && hash(body)===fn.md5 && typeof fn.owner==='string'
  && typeof fn.securityDefiner==='boolean' && (fn.config===null || Array.isArray(fn.config)),
 'RECOVERY_VERIFIED_CATALOG_BODY_REQUIRED:'+signature(definition));
 return {...fn,body};
};
const replacementViews = {
 'sales_revision_private.events':'sales_recovery_private.active_revision_events',
 'sales_source_creation_private.records':'sales_recovery_private.active_creation_records',
 'sales_unknown_history_private.records':'sales_recovery_private.active_unknown_records',
};
const once = (body,old,next,code) => {
 requireValue(body.split(old).length===2,code);
 return body.replace(old,next);
};

export function reviewedReplacementRecoveryAdapters(root,catalog) {
 requireValue(catalog && Array.isArray(catalog.functions),'RECOVERY_POST_MEMBERSHIP_CATALOG_REQUIRED');
 const captured = new Map(definitions.map(definition=>[signature(definition),bodyOf(catalog.functions,definition)]));
 const changes = new Map();
 for (const definition of definitions.slice(0,7)) {
  const fn=signature(definition),source=captured.get(fn), name=definition[1];
  const condition=name==='guard_booking_plot_stock'
   ? "TG_OP='UPDATE' AND sales_recovery_private.stock_allowed(to_jsonb(OLD),to_jsonb(NEW))"
   : `${name==='update_sales_updated_at_column'?"TG_TABLE_NAME='sales' AND TG_OP='UPDATE' AND ":''}sales_recovery_private.row_allowed(TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END)`;
  const next=once(source.body,'BEGIN',`BEGIN\n IF ${condition} THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;`,'RECOVERY_GUARD_SINGLE_BEGIN_REQUIRED');
  changes.set(fn,next);
 }
 for(const definition of definitions.slice(7,9)) {
  const fn=signature(definition),source=captured.get(fn),kind=definition[1]==='customer_member'?'customer':'interest';
  requireValue(/^\s*SELECT\b/.test(source.body) && /;\s*$/.test(source.body),'RECOVERY_MEMBERSHIP_SQL_BODY_REQUIRED');
  changes.set(fn,`\n SELECT NOT sales_recovery_private.retired_parent('${kind}',p_id) AND (${source.body.trim().replace(/;$/,'')});\n`);
 }
 const stockSignature='crm_external_private.guard_booking_plot_stock()',stockAfter=hash(changes.get(stockSignature));
 const stockCheck='sales_revision_private.assert_stock_catalog()';
 const reviewedStock=once(captured.get(stockCheck).body,
  "IN('eb32ae486d63956e802027ec8ce6fd28','a498131001bda620bc0becbd867acf20')",
  `IN('eb32ae486d63956e802027ec8ce6fd28','a498131001bda620bc0becbd867acf20','${stockAfter}')`,
  'RECOVERY_STOCK_CATALOG_SOURCE_REQUIRED');
 changes.set(stockCheck,once(reviewedStock,
  "md5(replace(prosrc,E'\\r\\n',E'\\n'))='06bcf30ac3d0a7f279a54cbf228a7bec'",
  "sales_recovery_private.adapter_matches('public.update_sales_updated_at_column()','06bcf30ac3d0a7f279a54cbf228a7bec',md5(replace(prosrc,E'\\r\\n',E'\\n')))",
  'RECOVERY_UPDATER_CATALOG_SOURCE_REQUIRED'));
 const membershipCheck='customer_source_membership_private.assert_catalog()';
 changes.set(membershipCheck,once(captured.get(membershipCheck).body,
  "md5(replace(p.prosrc,E'\\r\\n',E'\\n')) IS DISTINCT FROM a.after_md5",
  "NOT sales_recovery_private.adapter_matches(a.signature,a.after_md5,md5(replace(p.prosrc,E'\\r\\n',E'\\n')))",
  'RECOVERY_MEMBERSHIP_CATALOG_SOURCE_REQUIRED'));
 for(const definition of definitions.slice(11)) {
  const fn=signature(definition),source=captured.get(fn);let next=source.body;
  for(const [old,view]of Object.entries(replacementViews))next=next.replaceAll(old,view);
  if(next!==source.body)changes.set(fn,next);
 }
 // These two functions are necessary to suppress compensated events before
 // integrity checks and report aggregation, not merely after pagination.
 requireValue(changes.has('sales_history_read_private.records(uuid,uuid,uuid,text)')
  && changes.has('sales_revision_private.history(jsonb,jsonb)'), 'RECOVERY_HISTORY_FILTER_COVERAGE_REQUIRED');
 let sql=`-- Reviewed exact-original recovery adapters. No original authorization branch is removed.\n`;
 const metadata=[];
 for(const [fn,next]of changes) {
  const source=captured.get(fn),beforeMd5=hash(source.body),afterMd5=hash(next);
  requireValue(!source.body.includes('sales_recovery_private.'),'RECOVERY_ALREADY_ADAPTED_CATALOG');
  const settings=source.config===null?'NULL::text[]':`ARRAY[${source.config.map(q).join(',')}]::text[]`;
  sql+=`DO $recovery_adapter_${metadata.length}$\nDECLARE definition text;body text;\nBEGIN\n SELECT replace(pg_get_functiondef(oid),E'\\r\\n',E'\\n'),replace(prosrc,E'\\r\\n',E'\\n') INTO definition,body FROM pg_proc WHERE oid=${q(fn)}::regprocedure;\n IF body IS DISTINCT FROM ${q(source.body)} OR md5(body) IS DISTINCT FROM '${beforeMd5}'\n  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=${q(fn)}::regprocedure AND pg_get_userbyid(proowner)=current_user\n   AND prosecdef=${source.securityDefiner} AND proconfig IS NOT DISTINCT FROM ${settings})\n  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1\n THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;\n EXECUTE replace(definition,body,${q(next)});\n INSERT INTO sales_recovery_private.adapters VALUES(${q(fn)},'${beforeMd5}','${afterMd5}');\nEND;\n$recovery_adapter_${metadata.length}$;\n`;
  metadata.push({signature:fn,beforeMd5,afterMd5,securityDefiner:source.securityDefiner,settings:source.config});
 }
 sql+=recoveryIdentityAnchorSql();
 const sourcePath='sql/sales/32_customer_replacement_recovery_draft.sql';
 return {version:'reviewed-replacement-recovery-adapters-v1',sql,functions:metadata,
  catalogDigest:hash(JSON.stringify(catalog),'sha256'),sourcePath,
  sourceSha256:hash(readFileSync(join(root,sourcePath)),'sha256'),productionChanged:false,executed:false};
}

export function recoveryIdentityAnchorSql() {
 return `-- Replace only the reviewed immutable-ledger Sale FK targets. Keep all other FKs and every guard.\nDO $recovery_sale_identity_fks$\nDECLARE target record;fk record;column_number smallint;found_count integer;\nBEGIN\n PERFORM sales_recovery_private.operator();\n INSERT INTO sales_recovery_private.sale_identities SELECT sale_id FROM sales_revision_private.events UNION SELECT sale_id FROM customer_source_membership_private.members WHERE sale_id IS NOT NULL ON CONFLICT DO NOTHING;\n FOR target IN SELECT * FROM (VALUES('sales_revision_private.events','historical_sale_identity_fk',true),('customer_source_membership_private.members','membership_sale_identity_fk',false)) x(relation_name,new_name,deferred) LOOP\n  SELECT attnum INTO STRICT column_number FROM pg_attribute WHERE attrelid=target.relation_name::regclass AND attname='sale_id' AND NOT attisdropped;\n  SELECT count(*) INTO found_count FROM pg_constraint WHERE conrelid=target.relation_name::regclass AND contype='f' AND conkey=ARRAY[column_number]\n   AND confrelid='public.sales'::regclass AND confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.sales'::regclass AND attname='id')];\n  IF found_count<>1 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_SALE_FK_REVIEW_REQUIRED'; END IF;\n  SELECT * INTO STRICT fk FROM pg_constraint WHERE conrelid=target.relation_name::regclass AND contype='f' AND conkey=ARRAY[column_number] AND confrelid='public.sales'::regclass;\n  IF fk.confdeltype NOT IN('a','r') OR fk.confupdtype<>'a' OR fk.condeferrable IS DISTINCT FROM target.deferred OR fk.condeferred IS DISTINCT FROM target.deferred\n   THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_SALE_FK_REVIEW_REQUIRED'; END IF;\n  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',target.relation_name,fk.conname);\n  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY(sale_id) REFERENCES sales_recovery_private.sale_identities(id) ON DELETE RESTRICT',target.relation_name,target.new_name);\n END LOOP;\nEND;\n$recovery_sale_identity_fks$;\n`;
}
