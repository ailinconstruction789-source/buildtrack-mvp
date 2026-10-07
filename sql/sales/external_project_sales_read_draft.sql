-- Private operator preview of ONE prepared replacement snapshot.
-- No public endpoint, client grant, flag change or public.sales cutover.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: prepared project sales reader requires isolated verification';
END;
$draft_only$;

CREATE FUNCTION crm_external_private.read_prepared_project_sales(p_batch uuid,p_project_name text DEFAULT NULL,
  p_tab text DEFAULT 'booked',p_query text DEFAULT '',p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE receipt crm_external_private.booking_release_receipts%ROWTYPE; actor_id uuid; snapshot_day text;
  trim_chars text:=U&' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  search_value text; rows_json jsonb:='[]'; more boolean:=false; pending_count integer;
BEGIN
  IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class
    WHERE oid='crm_external_private.snapshot_batches'::regclass) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='EXTERNAL_PROJECT_READ_OPERATOR_REQUIRED';
  END IF;
  IF p_batch IS NULL OR p_tab IS NULL OR p_tab NOT IN ('booked','transferred','cancelled','all')
    OR p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000 OR p_query IS NULL
    OR p_query ~ U&'[\0001-\001F\007F-\009F\2028\2029]'
    OR length(btrim(p_query,trim_chars))>200 OR length(btrim(p_query,trim_chars))=1
    OR (p_project_name IS NOT NULL AND (length(p_project_name) NOT BETWEEN 1 AND 200
      OR p_project_name ~ U&'[\0001-\001F\007F-\009F\2028\2029]')) THEN
    RAISE EXCEPTION 'EXTERNAL_PROJECT_READ_INVALID_INPUT';
  END IF;
  search_value:=btrim(p_query,trim_chars);
  IF p_project_name IS NULL AND (p_page<>0 OR search_value<>'') THEN RAISE EXCEPTION 'EXTERNAL_PROJECT_READ_INVALID_INPUT'; END IF;
  SELECT * INTO receipt FROM crm_external_private.booking_release_receipts WHERE batch_id=p_batch;
  IF receipt.batch_id IS NULL THEN RAISE EXCEPTION 'EXTERNAL_PROJECT_READ_PREPARATION_REQUIRED'; END IF;
  actor_id:=(receipt.request->'identityRequest'->>'admin')::uuid;
  IF NOT EXISTS(SELECT 1 FROM account_security_private.reviewed_roles r
    JOIN account_security_private.reviewed_admins a ON a.auth_user_id=r.auth_user_id AND a.legacy_user_id=r.legacy_user_id
    JOIN auth.users u ON u.id=r.auth_user_id
    WHERE r.auth_user_id=actor_id AND r.enabled AND r.role='Admin' AND r.review_revision>0 AND a.enabled
      AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false)
      AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())) THEN
    RAISE EXCEPTION 'EXTERNAL_PROJECT_READ_REVIEWED_ADMIN_REQUIRED';
  END IF;
  SELECT payload->>'snapshotDate' INTO snapshot_day FROM crm_external_private.snapshot_batches WHERE id=p_batch;
  -- Check full coverage BEFORE filtering. A source append or a broken link may
  -- never make a filtered project look complete. This reader never repairs data.
  IF (SELECT count(*) FROM crm_external_private.prepared_booking_sales WHERE batch_id=p_batch)
      <>(receipt.response->>'bookingHistories')::integer
    OR (SELECT count(*) FROM crm_external_private.booking_history WHERE batch_id=p_batch)
      <>(receipt.response->>'bookingHistories')::integer
    OR EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales s
      LEFT JOIN crm_external_private.booking_sales_projection p ON p.batch_id=s.batch_id AND p.booking_key=s.booking_key
      WHERE s.batch_id=p_batch AND (p.booking_key IS NULL OR s.payload IS DISTINCT FROM to_jsonb(p))) THEN
    RAISE EXCEPTION 'EXTERNAL_PROJECT_READ_INTEGRITY_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales s
    LEFT JOIN sales_private.crm_user_roles r ON r.user_id=(s.payload->>'closing_sales_user_id')::uuid
    WHERE s.batch_id=p_batch AND s.payload->>'closing_sales_user_id' IS NOT NULL
      AND (r.user_id IS NULL OR r.role<>'sales')) THEN
    RAISE EXCEPTION 'EXTERNAL_PROJECT_READ_INTEGRITY_REQUIRED';
  END IF;
  SELECT count(*) INTO pending_count FROM crm_external_private.prepared_booking_sales
    WHERE batch_id=p_batch AND (payload->>'customer_id' IS NULL OR payload->>'interest_id' IS NULL
      OR payload->>'closing_sales_user_id' IS NULL);
  IF p_project_name IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN RAISE EXCEPTION 'EXTERNAL_PROJECT_READ_NOT_FOUND'; END IF;
    IF EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales s
      JOIN crm_external_private.booking_history h ON h.batch_id=s.batch_id AND h.entity_key=s.booking_key
      LEFT JOIN crm_external_private.interest_candidates i ON i.batch_id=h.batch_id AND i.entity_key=h.interest_key
      LEFT JOIN public.plots p ON p.id=s.plot_id WHERE s.batch_id=p_batch AND s.plot_id IS NOT NULL
      AND (p.id IS NULL OR p.project_name IS DISTINCT FROM coalesce(s.payload->>'project_name',i.project_label))) THEN
      RAISE EXCEPTION 'EXTERNAL_PROJECT_READ_INTEGRITY_REQUIRED';
    END IF;
    WITH page_rows AS (
      SELECT s.id,s.plot_id,s.stage,s.payload,c.id AS customer_id,c.customer_name,c.phone,
        i.id AS interest_id,i.owner_user_id,i.project_name,p.plot_name,
        coalesce(nullif(btrim(r.display_name),''),r.user_id::text) AS owner_name
      FROM crm_external_private.prepared_booking_sales s
      JOIN public.sales_customers c ON c.id=(s.payload->>'customer_id')::uuid
      JOIN public.lead_project_interests i ON i.id=(s.payload->>'interest_id')::uuid AND i.customer_id=c.id
      JOIN sales_private.crm_user_roles r ON r.user_id=i.owner_user_id
      LEFT JOIN public.plots p ON p.id=s.plot_id
      WHERE s.batch_id=p_batch AND i.project_name=p_project_name
        AND (p_tab='all' OR p_tab=s.stage)
        AND (search_value='' OR strpos(lower(c.customer_name),lower(search_value))>0
          OR strpos(lower(coalesce(c.phone,'')),lower(search_value))>0
          OR strpos(lower(coalesce(s.plot_id,'')),lower(search_value))>0
          OR strpos(lower(coalesce(p.plot_name,'')),lower(search_value))>0)
      ORDER BY s.payload->>'booked_date' DESC NULLS LAST,s.id LIMIT 51 OFFSET p_page*50
    ), numbered AS (SELECT *,row_number() OVER(ORDER BY payload->>'booked_date' DESC NULLS LAST,id) rn FROM page_rows)
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'saleId',s.id,'customerId',s.customer_id,'customerName',s.customer_name,'phone',s.phone,
      'interestId',s.interest_id,'projectName',s.project_name,'ownerUserId',s.owner_user_id,'ownerName',s.owner_name,
      'plotId',s.plot_id,'plotName',s.plot_name,'stage',s.stage,'bookingRound',NULL,'previousSaleId',NULL,
      'bookedAt',NULL,'cancelledAt',NULL,'cancellationReason',s.payload->'cancellation_reason',
      'listPrice',NULL,'discountAmount',NULL,'salePrice',s.payload->'sale_price',
      'depositAmount',s.payload->'deposit_amount','paymentMethod',s.payload->'payment_method',
      'historyEvidence',jsonb_build_object('sourceRow',s.payload->'source_row','bookedDate',s.payload->'booked_date',
        'cancelledDate',s.payload->'cancelled_date','transferredDate',s.payload->'transferred_date',
        'held',NOT (s.payload->>'eligible_for_release_review')::boolean))
      ORDER BY s.payload->>'booked_date' DESC NULLS LAST,s.id) FILTER(WHERE rn<=50),'[]'),count(*)>50
      INTO rows_json,more FROM numbered s;
  END IF;
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role','admin'),
    'projectName',p_project_name,'projects',coalesce((SELECT jsonb_agg(jsonb_build_object('name',name) ORDER BY name) FROM public.projects),'[]'),
    'tab',p_tab,'query',search_value,'page',p_page,'hasMore',more,'rows',rows_json,
    'prepared',jsonb_build_object('batchId',p_batch,'snapshotDate',snapshot_day,'pendingUnlinkedHistories',pending_count));
END;
$$;
DO $seal$
DECLARE grantee_name text;
BEGIN
  FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='crm_external_private.read_prepared_project_sales(uuid,text,text,text,integer)'::regprocedure AND a.grantee<>p.proowner LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION crm_external_private.read_prepared_project_sales(uuid,text,text,text,integer) FROM %s',grantee_name);
  END LOOP;
END;
$seal$;
ROLLBACK;
