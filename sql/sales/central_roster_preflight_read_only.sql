-- Operator-only identity binding report for the roster approved on 2026-09-28.
-- NOT an installer or authorization source. Never expose through a public RPC.
-- Only staff IDs/names, availability, and aggregate legacy counts are returned.
-- No customer identities, credentials, Auth metadata, or session values.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
WITH approved(username,expected_role,display_name) AS (VALUES
  ('Admin','Admin','Admin'), ('Owner','Owner','Owner'),
  ('BELL','Sales','BELL'), ('FIELD','Sales','FIELD'),
  ('JEEJEE','Sales','JEEJEE'), ('NOOK','Sales','NOOK'),
  ('PIEW','Sales','PIEW'), ('TEAW','Sales','TAEW'), ('YING','Sales','YING')
), staff AS (
  SELECT a.*,
    (SELECT count(*) FROM public.users p WHERE p.username=a.username) AS directory_matches,
    (SELECT count(*) FROM public.users p
      WHERE lower(replace(p.username,' ',''))=lower(replace(a.username,' ',''))) AS login_key_matches,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('legacyUserId',p.id,'legacyRole',p.role)
      ORDER BY p.id),'[]'::jsonb) FROM public.users p WHERE p.username=a.username) AS directory,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('authUserId',u.id,
      'deleted',u.deleted_at IS NOT NULL,'anonymous',coalesce(u.is_anonymous,false),
      'banned',u.banned_until IS NOT NULL AND u.banned_until>statement_timestamp()) ORDER BY u.id),'[]'::jsonb)
      FROM auth.users u WHERE u.email=lower(replace(a.username,' ',''))||'@buildtrack.local') AS auth_bindings
  FROM approved a
), agents AS (
  SELECT agent_name AS source_label,count(*) AS lead_count,
    CASE agent_name WHEN 'TAEW' THEN 'TEAW' WHEN 'Piwe' THEN 'PIEW' ELSE agent_name END AS login_name
  FROM public.leads GROUP BY agent_name
)
SELECT jsonb_build_object(
  'reportVersion','central-roster-preflight-v1',
  'generatedAt',statement_timestamp(),
  'readOnly',current_setting('transaction_read_only')='on',
  'staff',(SELECT jsonb_agg(jsonb_build_object('username',username,'expectedRole',expected_role,
    'displayName',display_name,'directoryMatches',directory_matches,'loginKeyMatches',login_key_matches,
    'directory',directory,'authBindings',auth_bindings) ORDER BY username) FROM staff),
  'reviewedAdmins',(SELECT coalesce(jsonb_agg(jsonb_build_object('legacyUserId',legacy_user_id,
    'authUserId',auth_user_id) ORDER BY legacy_user_id),'[]'::jsonb)
    FROM account_security_private.reviewed_admins WHERE enabled),
  'legacyAgents',(SELECT coalesce(jsonb_agg(jsonb_build_object('sourceLabel',source_label,
    'loginName',login_name,'leadCount',lead_count) ORDER BY source_label),'[]'::jsonb) FROM agents),
  'counts',jsonb_build_object('leads',(SELECT count(*) FROM public.leads),
    'sales',(SELECT count(*) FROM public.sales),'plots',(SELECT count(*) FROM public.plots)),
  'salesSchemaExists',to_regnamespace('sales_private') IS NOT NULL,
  'anonymousFullDirectoryRead',has_table_privilege('anon','public.users','SELECT')
) AS central_roster_preflight;
ROLLBACK;
