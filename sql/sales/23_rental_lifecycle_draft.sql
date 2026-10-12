-- SALES V2 CANONICAL RENTAL LIFECYCLE -- DESIGN ONLY, 2026-10-09.
-- Isolated rehearsal only. No legacy import, fake Lead, inferred cash/refund,
-- automatic savings credit, transfer entitlement, live activation or deployment.
-- Requires reviewed base + 04/05/18/21/22 customer-deal-details.
BEGIN;
DO $draft_only$
BEGIN
 RAISE EXCEPTION 'DESIGN ONLY: canonical rental lifecycle requires isolated verification and reviewed activation';
END;
$draft_only$;

ALTER TABLE public.crm_settings ADD COLUMN rental_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE sales_private.rental_contracts (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
 interest_id uuid NOT NULL, project_name text NOT NULL, plot_id text NOT NULL REFERENCES public.plots(id) ON DELETE RESTRICT,
 program_type text NOT NULL CHECK(program_type IN ('program_a','program_b','program_c')),
 status text NOT NULL CHECK(status IN ('active','renewed','ended','converted')),
 revision uuid NOT NULL, start_date date NOT NULL, end_date date NOT NULL,
 monthly_rent_satang bigint NOT NULL CHECK(monthly_rent_satang BETWEEN 1 AND 99999999999),
 security_deposit_satang bigint NOT NULL CHECK(security_deposit_satang BETWEEN 0 AND 99999999999),
 advance_rent_satang bigint NOT NULL CHECK(advance_rent_satang BETWEEN 0 AND 99999999999),
 savings_per_month_satang bigint NOT NULL CHECK(savings_per_month_satang BETWEEN 0 AND 99999999999),
 base_price_satang bigint CHECK(base_price_satang BETWEEN 1 AND 99999999999),
 ended_date date, converted_sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 FOREIGN KEY(interest_id,customer_id) REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT,
 FOREIGN KEY(interest_id,project_name) REFERENCES public.lead_project_interests(id,project_name) ON DELETE RESTRICT,
 CHECK(end_date>=start_date AND isfinite(start_date) AND isfinite(end_date)
  AND start_date>=DATE '0001-01-01' AND end_date<DATE '10000-01-01'),
 CHECK(program_type='program_b' OR savings_per_month_satang=0),
 CHECK(program_type<>'program_c' OR base_price_satang IS NOT NULL),
 CHECK((status IN ('active','renewed') AND ended_date IS NULL AND converted_sale_id IS NULL)
  OR (status='ended' AND ended_date>=start_date AND converted_sale_id IS NULL)
  OR (status='converted' AND ended_date>=start_date AND converted_sale_id IS NOT NULL))
);
CREATE UNIQUE INDEX crm_rental_active_plot_idx ON sales_private.rental_contracts(plot_id) WHERE status IN ('active','renewed');
CREATE INDEX crm_rental_interest_idx ON sales_private.rental_contracts(interest_id,created_at DESC,id DESC);
CREATE INDEX crm_rental_project_idx ON sales_private.rental_contracts(project_name,created_at DESC,id DESC);
CREATE TABLE sales_private.rental_events (
 id uuid PRIMARY KEY, contract_id uuid NOT NULL REFERENCES sales_private.rental_contracts(id) ON DELETE RESTRICT,
 command text NOT NULL CHECK(command IN ('start','renew','record_payment','end','convert_to_buy')),
 occurred_date date, recorded_at timestamptz NOT NULL, actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 reason text NOT NULL, old_values jsonb, new_values jsonb NOT NULL
);
CREATE INDEX crm_rental_events_idx ON sales_private.rental_events(contract_id,recorded_at DESC,id DESC);
CREATE TABLE sales_private.rental_payments (
 id uuid PRIMARY KEY, contract_id uuid NOT NULL REFERENCES sales_private.rental_contracts(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('rent','savings','security_deposit','advance_rent')),
 amount_satang bigint NOT NULL CHECK(amount_satang BETWEEN 1 AND 99999999999), paid_date date NOT NULL,
 reference text NOT NULL, evidence_note text NOT NULL, recorded_at timestamptz NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 UNIQUE(contract_id,reference)
);
CREATE INDEX crm_rental_payments_idx ON sales_private.rental_payments(contract_id,recorded_at DESC,id DESC);
CREATE TABLE sales_private.rental_requests (
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, request_id uuid NOT NULL,
 request_payload jsonb NOT NULL, response jsonb NOT NULL, recorded_at timestamptz NOT NULL,
 PRIMARY KEY(actor_user_id,request_id)
);
CREATE TABLE sales_private.rental_permits (
 transaction_id bigint NOT NULL, backend_pid integer NOT NULL, actor_user_id uuid NOT NULL,
 entity_type text NOT NULL CHECK(entity_type IN ('contract','event','payment','receipt')),
 entity_id uuid NOT NULL, old_row jsonb, new_row jsonb NOT NULL,
 PRIMARY KEY(transaction_id,backend_pid,entity_type,entity_id)
);
ALTER TABLE sales_private.rental_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.rental_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.rental_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.rental_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.rental_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.rental_contracts,sales_private.rental_events,sales_private.rental_payments,
 sales_private.rental_requests,sales_private.rental_permits FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sales_private.crm_rental_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guard$
DECLARE entity text:=CASE TG_TABLE_NAME WHEN 'rental_contracts' THEN 'contract' WHEN 'rental_events' THEN 'event'
 WHEN 'rental_payments' THEN 'payment' ELSE 'receipt' END; identity_id uuid; previous jsonb;
BEGIN
 IF TG_OP NOT IN ('INSERT','UPDATE') OR (entity<>'contract' AND TG_OP<>'INSERT') THEN RAISE EXCEPTION 'CRM_RENTAL_FORBIDDEN'; END IF;
 identity_id:=CASE WHEN entity='receipt' THEN (to_jsonb(NEW)->>'request_id')::uuid ELSE (to_jsonb(NEW)->>'id')::uuid END;
 previous:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
 IF auth.uid() IS NULL OR COALESCE(public.crm_v2_role(),'') NOT IN ('sales','admin') OR NOT EXISTS(
  SELECT 1 FROM sales_private.rental_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()
   AND actor_user_id=auth.uid() AND entity_type=entity AND entity_id=identity_id
   AND old_row IS NOT DISTINCT FROM previous AND new_row=to_jsonb(NEW)) THEN RAISE EXCEPTION 'CRM_RENTAL_FORBIDDEN'; END IF;
 RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION sales_private.crm_rental_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_rental_contract_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_private.rental_contracts FOR EACH ROW EXECUTE FUNCTION sales_private.crm_rental_guard();
CREATE TRIGGER crm_rental_event_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_private.rental_events FOR EACH ROW EXECUTE FUNCTION sales_private.crm_rental_guard();
CREATE TRIGGER crm_rental_payment_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_private.rental_payments FOR EACH ROW EXECUTE FUNCTION sales_private.crm_rental_guard();
CREATE TRIGGER crm_rental_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_private.rental_requests FOR EACH ROW EXECUTE FUNCTION sales_private.crm_rental_guard();
CREATE FUNCTION sales_private.crm_rental_no_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'CRM_RENTAL_FORBIDDEN'; END; $$;
REVOKE ALL ON FUNCTION sales_private.crm_rental_no_truncate() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_rental_contract_no_truncate BEFORE TRUNCATE ON sales_private.rental_contracts FOR EACH STATEMENT EXECUTE FUNCTION sales_private.crm_rental_no_truncate();
CREATE TRIGGER crm_rental_event_no_truncate BEFORE TRUNCATE ON sales_private.rental_events FOR EACH STATEMENT EXECUTE FUNCTION sales_private.crm_rental_no_truncate();
CREATE TRIGGER crm_rental_payment_no_truncate BEFORE TRUNCATE ON sales_private.rental_payments FOR EACH STATEMENT EXECUTE FUNCTION sales_private.crm_rental_no_truncate();
CREATE TRIGGER crm_rental_receipt_no_truncate BEFORE TRUNCATE ON sales_private.rental_requests FOR EACH STATEMENT EXECUTE FUNCTION sales_private.crm_rental_no_truncate();

-- Existing booking commands check has_customer. Guards also prevent a legacy
-- writer/cancellation clearing it, or creating a sale over an active rental.
CREATE FUNCTION sales_private.crm_rental_protect_plot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM sales_private.rental_contracts WHERE plot_id=OLD.id AND status IN ('active','renewed'))
  AND (TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.project_name IS DISTINCT FROM OLD.project_name OR NEW.has_customer IS NOT TRUE)
 THEN RAISE EXCEPTION 'CRM_RENTAL_CONFLICT'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
REVOKE ALL ON FUNCTION sales_private.crm_rental_protect_plot() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_rental_protect_plot BEFORE UPDATE OR DELETE ON public.plots FOR EACH ROW EXECUTE FUNCTION sales_private.crm_rental_protect_plot();
CREATE FUNCTION sales_private.crm_rental_protect_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.plot_id IS NOT NULL AND COALESCE(NEW.crm_stage,lower(NEW.contract_status),'unknown')<>'cancelled'
  AND (EXISTS(SELECT 1 FROM sales_private.rental_contracts WHERE plot_id=NEW.plot_id AND status IN ('active','renewed'))
   OR sales_private.crm_rental_legacy_occupied(NEW.plot_id))
 THEN RAISE EXCEPTION 'CRM_RENTAL_CONFLICT'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION sales_private.crm_rental_protect_sale() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_rental_protect_sale BEFORE INSERT OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION sales_private.crm_rental_protect_sale();
CREATE FUNCTION sales_private.crm_rental_protect_legacy_contract()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE plot_value text:=to_jsonb(NEW)->>'plot_id';
BEGIN
 IF COALESCE(to_jsonb(NEW)->>'status','unknown') NOT IN ('MovedOut','Cancelled','ConvertedToBuy') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
  PERFORM 1 FROM public.plots WHERE id=plot_value FOR UPDATE;
  IF EXISTS(SELECT 1 FROM sales_private.rental_contracts WHERE plot_id=plot_value AND status IN ('active','renewed'))
  THEN RAISE EXCEPTION 'CRM_RENTAL_CONFLICT'; END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION sales_private.crm_rental_protect_legacy_contract() FROM PUBLIC,anon,authenticated;
DO $legacy_guard$
BEGIN
 IF to_regclass('public.rental_contracts') IS NOT NULL THEN
  EXECUTE 'CREATE TRIGGER crm_rental_protect_legacy_contract BEFORE INSERT OR UPDATE ON public.rental_contracts FOR EACH ROW EXECUTE FUNCTION sales_private.crm_rental_protect_legacy_contract()';
 END IF;
END;
$legacy_guard$;

CREATE FUNCTION sales_private.crm_rental_legacy_occupied(p_plot_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE occupied boolean:=false;
BEGIN
 IF to_regclass('public.rental_contracts') IS NOT NULL THEN
  -- Unknown legacy status is occupied. Never infer an ended contract by trimming.
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.rental_contracts WHERE plot_id=$1 AND COALESCE(status,''unknown'') NOT IN (''MovedOut'',''Cancelled'',''ConvertedToBuy''))' INTO occupied USING p_plot_id;
 END IF;
 RETURN occupied;
END; $$;
REVOKE ALL ON FUNCTION sales_private.crm_rental_legacy_occupied(text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION sales_private.crm_rental_day(p_value jsonb)
RETURNS date LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result date;
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR (p_value#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
 BEGIN result:=(p_value#>>'{}')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END;
 IF NOT isfinite(result) OR result<DATE '0001-01-01' OR result>=DATE '10000-01-01' OR to_char(result,'YYYY-MM-DD')<>p_value#>>'{}' THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
 RETURN result;
END; $$;
CREATE FUNCTION sales_private.crm_rental_money(p_value jsonb,p_positive boolean DEFAULT false,p_nullable boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result bigint;
BEGIN
 IF p_nullable AND p_value='null'::jsonb THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' OR (p_value#>>'{}') !~ '^[0-9]{1,11}$' THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
 result:=(p_value#>>'{}')::bigint;
 IF result>99999999999 OR (p_positive AND result=0) THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION sales_private.crm_rental_day(jsonb),sales_private.crm_rental_money(jsonb,boolean,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.crm_v2_rental_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('contract_version','rental_lifecycle_v1','enabled',
  COALESCE(public.crm_v2_role() IN ('sales','admin','owner'),false)
  AND COALESCE((public.crm_v2_booking_capabilities()->>'enabled')::boolean,false)
  AND COALESCE((public.crm_v2_customer_deal_details_capabilities()->>'enabled')::boolean,false)
  AND COALESCE((SELECT rental_enabled FROM public.crm_settings WHERE id),false));
$$;
REVOKE ALL ON FUNCTION public.crm_v2_rental_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_rental_capabilities() TO authenticated;
CREATE FUNCTION sales_private.crm_rental_contract_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',r.id,'customerId',r.customer_id,'interestId',r.interest_id,'projectName',r.project_name,
  'plotId',r.plot_id,'ownerUserId',i.owner_user_id,'programType',r.program_type,'status',r.status,'revision',r.revision,
  'startDate',r.start_date,'endDate',r.end_date,'monthlyRentSatang',r.monthly_rent_satang,
  'securityDepositSatang',r.security_deposit_satang,'advanceRentSatang',r.advance_rent_satang,
  'savingsPerMonthSatang',r.savings_per_month_satang,'basePriceSatang',r.base_price_satang,
  'confirmedSavingsSatang',COALESCE((SELECT sum(amount_satang) FROM sales_private.rental_payments WHERE contract_id=r.id AND kind='savings'),0),
  'confirmedDepositSatang',COALESCE((SELECT sum(amount_satang) FROM sales_private.rental_payments WHERE contract_id=r.id AND kind='security_deposit'),0),
  'endedDate',r.ended_date,'convertedSaleId',r.converted_sale_id)
 FROM sales_private.rental_contracts r JOIN public.lead_project_interests i ON i.id=r.interest_id WHERE r.id=p_id;
$$;
REVOKE ALL ON FUNCTION sales_private.crm_rental_contract_json(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.crm_v2_rental_context(p_customer_id uuid,p_project_name text,p_contract_id uuid DEFAULT NULL,
 p_contract_page integer DEFAULT 0,p_event_page integer DEFAULT 0,p_payment_page integer DEFAULT 0,p_plot_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $context$
DECLARE actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); c public.sales_customers%ROWTYPE;
 i public.lead_project_interests%ROWTYPE; contracts jsonb; events jsonb; payments jsonb; plots jsonb;
 more_contracts boolean; more_events boolean; more_payments boolean; more_plots boolean; selected jsonb:='null'::jsonb;
BEGIN
 IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_RENTAL_FORBIDDEN'; END IF;
 IF NOT (public.crm_v2_rental_capabilities()->>'enabled')::boolean THEN RAISE EXCEPTION 'CRM_RENTAL_SETUP_REQUIRED'; END IF;
 IF p_customer_id IS NULL OR p_project_name IS NULL OR length(btrim(p_project_name)) NOT BETWEEN 1 AND 200
  OR p_contract_page IS NULL OR p_event_page IS NULL OR p_payment_page IS NULL OR p_plot_page IS NULL
  OR p_contract_page NOT BETWEEN 0 AND 100000 OR p_event_page NOT BETWEEN 0 AND 100000
  OR p_payment_page NOT BETWEEN 0 AND 100000 OR p_plot_page NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
 SELECT * INTO c FROM public.sales_customers WHERE id=p_customer_id AND merged_into_customer_id IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RENTAL_NOT_FOUND'; END IF;
 SELECT * INTO i FROM public.lead_project_interests WHERE customer_id=c.id AND project_name=p_project_name;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RENTAL_NOT_FOUND'; END IF;
 IF p_contract_id IS NOT NULL THEN
  PERFORM 1 FROM sales_private.rental_contracts WHERE id=p_contract_id AND customer_id=c.id AND interest_id=i.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RENTAL_NOT_FOUND'; END IF;
  selected:=sales_private.crm_rental_contract_json(p_contract_id);
 END IF;
 WITH page AS (SELECT id,created_at,row_number() OVER(ORDER BY created_at DESC,id DESC) rn
  FROM sales_private.rental_contracts WHERE customer_id=c.id AND interest_id=i.id ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET p_contract_page*50)
 SELECT COALESCE(jsonb_agg(sales_private.crm_rental_contract_json(id) ORDER BY created_at DESC,id DESC) FILTER(WHERE rn<=p_contract_page*50+50),'[]'::jsonb),count(*)>50 INTO contracts,more_contracts FROM page;
 WITH page AS (SELECT e.*,row_number() OVER(ORDER BY e.recorded_at DESC,e.id DESC) rn
  FROM sales_private.rental_events e WHERE e.contract_id=p_contract_id ORDER BY e.recorded_at DESC,e.id DESC LIMIT 51 OFFSET p_event_page*50)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'contractId',contract_id,'command',command,'occurredDate',occurred_date,
  'recordedAt',recorded_at,'actorUserId',actor_user_id,'reason',reason) ORDER BY recorded_at DESC,id DESC) FILTER(WHERE rn<=p_event_page*50+50),'[]'::jsonb),count(*)>50 INTO events,more_events FROM page;
 WITH page AS (SELECT p.*,row_number() OVER(ORDER BY p.recorded_at DESC,p.id DESC) rn
  FROM sales_private.rental_payments p WHERE p.contract_id=p_contract_id ORDER BY p.recorded_at DESC,p.id DESC LIMIT 51 OFFSET p_payment_page*50)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'contractId',contract_id,'kind',kind,'amountSatang',amount_satang,
  'paidDate',paid_date,'reference',reference,'evidenceNote',evidence_note,'recordedAt',recorded_at,'actorUserId',actor_user_id)
  ORDER BY recorded_at DESC,id DESC) FILTER(WHERE rn<=p_payment_page*50+50),'[]'::jsonb),count(*)>50 INTO payments,more_payments FROM page;
 WITH page AS (SELECT p.*,row_number() OVER(ORDER BY id) rn FROM public.plots p WHERE project_name=i.project_name ORDER BY id LIMIT 51 OFFSET p_plot_page*50)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',COALESCE(to_jsonb(page)->>'plot_name',to_jsonb(page)->>'name'),'available',has_customer IS FALSE
  AND lower(btrim(COALESCE(sale_status,''))) IN ('','active','normal','ready_for_sale','available','vacant')
  AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.plot_id=page.id AND COALESCE(s.crm_stage,lower(s.contract_status),'unknown')<>'cancelled')
  AND NOT EXISTS(SELECT 1 FROM sales_private.rental_contracts r WHERE r.plot_id=page.id AND r.status IN ('active','renewed'))
  AND NOT sales_private.crm_rental_legacy_occupied(id)) ORDER BY id) FILTER(WHERE rn<=p_plot_page*50+50),'[]'::jsonb),count(*)>50 INTO plots,more_plots FROM page;
 RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),
  'customer',jsonb_build_object('id',c.id,'name',sales_private.crm_effective_customer_name(c.id),'phone',sales_private.crm_effective_customer_phone(c.id),'revision',c.lifecycle_revision),
  'interest',jsonb_build_object('id',i.id,'projectName',i.project_name,'ownerUserId',i.owner_user_id,'revision',i.lifecycle_revision,
  'canEdit',(actor_role='admin' OR (actor_role='sales' AND actor_id=i.owner_user_id)) AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=i.owner_user_id AND is_active AND role='sales')),
  'contracts',contracts,'contractPage',p_contract_page,'contractsHasMore',more_contracts,'selectedContract',selected,
  'events',events,'eventPage',p_event_page,'eventsHasMore',more_events,'payments',payments,'paymentPage',p_payment_page,'paymentsHasMore',more_payments,
  'plots',plots,'plotPage',p_plot_page,'plotsHasMore',more_plots);
END;
$context$;
REVOKE ALL ON FUNCTION public.crm_v2_rental_context(uuid,text,uuid,integer,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_rental_context(uuid,text,uuid,integer,integer,integer,integer) TO authenticated;

-- Caller-role checked projection for the project map. The revision covers the
-- complete project collection, including effective customer profile and owner;
-- it is change detection, not an authorization token or a persisted business row.
CREATE FUNCTION public.crm_v2_rental_project_context(p_project_name text,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $project_context$
DECLARE actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); project_value text;
 rows_json jsonb; more boolean; snapshot_revision text;
BEGIN
 IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_RENTAL_FORBIDDEN'; END IF;
 IF NOT (public.crm_v2_rental_capabilities()->>'enabled')::boolean THEN RAISE EXCEPTION 'CRM_RENTAL_SETUP_REQUIRED'; END IF;
 IF p_project_name IS NULL OR p_page IS NULL OR p_page NOT BETWEEN 0 AND 99 THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
 BEGIN project_value:=sales_private.crm_work_text(p_project_name,200); EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END;
 IF project_value IS DISTINCT FROM p_project_name THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
 -- Closed projects remain readable; this operation cannot create or renew leases.
 PERFORM 1 FROM public.projects WHERE name=project_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RENTAL_NOT_FOUND'; END IF;
 IF (SELECT count(*)>5000 FROM (SELECT 1 FROM sales_private.rental_contracts WHERE project_name=project_value LIMIT 5001) bounded) THEN
  RAISE EXCEPTION 'CRM_RENTAL_SETUP_REQUIRED';
 END IF;
 WITH projected AS MATERIALIZED (
  SELECT r.id,r.created_at,jsonb_build_object('contractId',r.id,'customerId',r.customer_id,'interestId',r.interest_id,
   'ownerUserId',i.owner_user_id,'projectName',r.project_name,'plotId',r.plot_id,
   'customerName',sales_private.crm_effective_customer_name(r.customer_id),'customerPhone',sales_private.crm_effective_customer_phone(r.customer_id),
   'programType',r.program_type,'status',r.status,'revision',r.revision,'startDate',r.start_date,'endDate',r.end_date,
   'endedDate',r.ended_date,'convertedSaleId',r.converted_sale_id) row_json
  FROM sales_private.rental_contracts r JOIN public.lead_project_interests i ON i.id=r.interest_id
  WHERE r.project_name=project_value
 ), paged AS (
  SELECT *,row_number() OVER(ORDER BY created_at DESC,id DESC) rn FROM projected ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET p_page*50
 )
 SELECT (SELECT md5(COALESCE(jsonb_agg(row_json ORDER BY id),'[]'::jsonb)::text) FROM projected),
  COALESCE(jsonb_agg(row_json ORDER BY created_at DESC,id DESC) FILTER(WHERE rn<=p_page*50+50),'[]'::jsonb),count(*)>50
  INTO snapshot_revision,rows_json,more FROM paged;
 RETURN jsonb_build_object('projectName',project_value,'actor',jsonb_build_object('userId',actor_id,'role',actor_role),
  'snapshotRevision',snapshot_revision,'page',p_page,'hasMore',more,'rows',rows_json);
END;
$project_context$;
REVOKE ALL ON FUNCTION public.crm_v2_rental_project_context(text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_rental_project_context(text,integer) TO authenticated;

CREATE FUNCTION public.crm_v2_rental_command(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $command$
DECLARE actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text; actor_active boolean:=false; owner_active boolean:=false;
 c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; r sales_private.rental_contracts%ROWTYPE;
 request sales_private.rental_requests%ROWTYPE; role_row sales_private.crm_user_roles%ROWTYPE;
 event_row sales_private.rental_events%ROWTYPE; payment_row sales_private.rental_payments%ROWTYPE;
 previous jsonb; audit_previous jsonb; command_name text; reason_value text; project_value text; allowed_keys text[];
 customer_id_value uuid; interest_id_value uuid; contract_id_value uuid; expected_customer uuid; expected_interest uuid; expected_contract uuid;
 server_now timestamptz; today date; occurred date; months integer; money bigint; booking_result jsonb;
 response jsonb; booking_payload jsonb; plot_value text; savings_total numeric;
BEGIN
 IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin') THEN RAISE EXCEPTION 'CRM_RENTAL_FORBIDDEN'; END IF;
 IF NOT (public.crm_v2_rental_capabilities()->>'enabled')::boolean THEN RAISE EXCEPTION 'CRM_RENTAL_SETUP_REQUIRED'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>16384
  OR jsonb_typeof(p_payload->'command') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
 command_name:=p_payload->>'command';
 IF command_name NOT IN ('start','renew','record_payment','end','convert_to_buy') THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
 allowed_keys:=ARRAY['command','customerId','interestId','projectName','expectedCustomerRevision','expectedInterestRevision','contractId','expectedContractRevision','reason']||CASE command_name
  WHEN 'start' THEN ARRAY['plotId','programType','startDate','durationMonths','monthlyRentSatang','securityDepositSatang','advanceRentSatang','savingsPerMonthSatang','basePriceSatang']
  WHEN 'renew' THEN ARRAY['renewalMonths','monthlyRentSatang'] WHEN 'record_payment' THEN ARRAY['kind','amountSatang','paidDate','evidenceNote','reference']
  WHEN 'end' THEN ARRAY['endDate'] WHEN 'convert_to_buy' THEN ARRAY['purchaseDate','paymentMethod','listPriceSatang','discountSatang','depositSatang','bookingRoute','visitId'] ELSE NULL END;
 IF allowed_keys IS NULL OR NOT p_payload ?& allowed_keys OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT k=ANY(allowed_keys)) THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
 BEGIN
  customer_id_value:=sales_private.crm_booking_uuid(p_payload->'customerId'); interest_id_value:=sales_private.crm_booking_uuid(p_payload->'interestId');
  contract_id_value:=sales_private.crm_booking_uuid(p_payload->'contractId',command_name='start');
  expected_customer:=sales_private.crm_booking_uuid(p_payload->'expectedCustomerRevision'); expected_interest:=sales_private.crm_booking_uuid(p_payload->'expectedInterestRevision');
  expected_contract:=sales_private.crm_booking_uuid(p_payload->'expectedContractRevision',command_name='start');
  IF jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'projectName') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
  reason_value:=sales_private.crm_work_text(p_payload->>'reason',1000); project_value:=sales_private.crm_work_text(p_payload->>'projectName',200);
 EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END;
 IF command_name='start' AND (contract_id_value IS NOT NULL OR expected_contract IS NOT NULL) THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 SELECT * INTO request FROM sales_private.rental_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
 SELECT * INTO c FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RENTAL_NOT_FOUND'; END IF;
 IF c.merged_into_customer_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_RENTAL_CONFLICT'; END IF;
 SELECT * INTO i FROM public.lead_project_interests WHERE id=interest_id_value AND customer_id=c.id AND project_name=project_value FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RENTAL_NOT_FOUND'; END IF;
 FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,i.owner_user_id) ORDER BY user_id FOR SHARE LOOP
  IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; actor_active:=true; END IF;
  IF role_row.user_id=i.owner_user_id THEN owner_active:=role_row.is_active AND role_row.role='sales'; END IF;
 END LOOP;
 IF NOT actor_active OR NOT owner_active OR actor_role NOT IN ('sales','admin') OR (actor_role='sales' AND actor_id<>i.owner_user_id) THEN RAISE EXCEPTION 'CRM_RENTAL_FORBIDDEN'; END IF;
 IF NOT (public.crm_v2_rental_capabilities()->>'enabled')::boolean THEN RAISE EXCEPTION 'CRM_RENTAL_SETUP_REQUIRED'; END IF;
 IF request.request_id IS NOT NULL THEN
  IF request.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'CRM_RENTAL_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN request.response||jsonb_build_object('replayed',true);
 END IF;
 IF c.lifecycle_revision IS DISTINCT FROM expected_customer OR i.lifecycle_revision IS DISTINCT FROM expected_interest THEN RAISE EXCEPTION 'CRM_RENTAL_STALE_STATE'; END IF;
 server_now:=clock_timestamp(); today:=(server_now AT TIME ZONE 'Asia/Bangkok')::date;
 IF command_name<>'start' THEN
  SELECT * INTO r FROM sales_private.rental_contracts WHERE id=contract_id_value AND customer_id=c.id AND interest_id=i.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RENTAL_NOT_FOUND'; END IF;
  IF r.revision IS DISTINCT FROM expected_contract THEN RAISE EXCEPTION 'CRM_RENTAL_STALE_STATE'; END IF;
  IF r.status NOT IN ('active','renewed') THEN RAISE EXCEPTION 'CRM_RENTAL_CONFLICT'; END IF;
  previous:=to_jsonb(r); PERFORM 1 FROM public.plots WHERE id=r.plot_id AND project_name=i.project_name AND has_customer IS TRUE FOR UPDATE;
  IF NOT FOUND OR sales_private.crm_rental_legacy_occupied(r.plot_id) OR EXISTS(SELECT 1 FROM public.sales WHERE plot_id=r.plot_id AND COALESCE(crm_stage,lower(contract_status),'unknown')<>'cancelled') THEN RAISE EXCEPTION 'CRM_RENTAL_CONFLICT'; END IF;
 ELSE
  IF c.intake_status='lost' OR i.engagement_status='lost' THEN RAISE EXCEPTION 'CRM_RENTAL_CONFLICT'; END IF;
  PERFORM 1 FROM public.projects WHERE name=i.project_name AND is_closed IS NOT TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RENTAL_CONFLICT'; END IF;
  IF jsonb_typeof(p_payload->'plotId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'programType') IS DISTINCT FROM 'string'
   OR p_payload->>'programType' NOT IN ('program_a','program_b','program_c') OR jsonb_typeof(p_payload->'durationMonths') IS DISTINCT FROM 'number'
   OR (p_payload->>'durationMonths') !~ '^[0-9]{1,3}$' OR (p_payload->>'durationMonths')::integer NOT BETWEEN 12 AND 120 THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
  BEGIN plot_value:=sales_private.crm_work_text(p_payload->>'plotId',200); EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END;
  PERFORM 1 FROM public.plots WHERE id=plot_value AND project_name=i.project_name AND has_customer IS FALSE
   AND lower(btrim(COALESCE(sale_status,''))) IN ('','active','normal','ready_for_sale','available','vacant') FOR UPDATE;
  IF NOT FOUND OR sales_private.crm_rental_legacy_occupied(plot_value)
   OR EXISTS(SELECT 1 FROM sales_private.rental_contracts WHERE plot_id=plot_value AND status IN ('active','renewed'))
   OR EXISTS(SELECT 1 FROM public.sales WHERE plot_id=plot_value AND COALESCE(crm_stage,lower(contract_status),'unknown')<>'cancelled') THEN RAISE EXCEPTION 'CRM_RENTAL_CONFLICT'; END IF;
  r.id:=gen_random_uuid(); r.customer_id:=c.id; r.interest_id:=i.id; r.project_name:=i.project_name; r.plot_id:=plot_value;
  r.program_type:=p_payload->>'programType'; r.status:='active'; r.start_date:=sales_private.crm_rental_day(p_payload->'startDate');
  months:=(p_payload->>'durationMonths')::integer;
  r.end_date:=(r.start_date+make_interval(months=>months))::date-1;
  IF r.end_date>=DATE '10000-01-01' THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
  r.monthly_rent_satang:=sales_private.crm_rental_money(p_payload->'monthlyRentSatang',true);
  r.security_deposit_satang:=sales_private.crm_rental_money(p_payload->'securityDepositSatang'); r.advance_rent_satang:=sales_private.crm_rental_money(p_payload->'advanceRentSatang');
  r.savings_per_month_satang:=sales_private.crm_rental_money(p_payload->'savingsPerMonthSatang'); r.base_price_satang:=sales_private.crm_rental_money(p_payload->'basePriceSatang',true,true);
  IF (r.program_type<>'program_b' AND r.savings_per_month_satang<>0) OR (r.program_type='program_c' AND r.base_price_satang IS NULL) THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
  r.created_at:=server_now; occurred:=r.start_date;
 END IF;
 audit_previous:=previous;
 IF command_name='renew' THEN
  IF jsonb_typeof(p_payload->'renewalMonths') IS DISTINCT FROM 'number' OR (p_payload->>'renewalMonths') !~ '^[0-9]{1,3}$'
   OR (p_payload->>'renewalMonths')::integer NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
  r.end_date:=(r.end_date+make_interval(months=>(p_payload->>'renewalMonths')::integer))::date;
  IF r.end_date>=DATE '10000-01-01' THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
  r.monthly_rent_satang:=sales_private.crm_rental_money(p_payload->'monthlyRentSatang',true); r.status:='renewed';
 ELSIF command_name='record_payment' THEN
  IF jsonb_typeof(p_payload->'kind') IS DISTINCT FROM 'string' OR p_payload->>'kind' NOT IN ('rent','savings','security_deposit','advance_rent')
   OR (p_payload->>'kind'='savings' AND r.program_type<>'program_b') OR jsonb_typeof(p_payload->'reference') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'evidenceNote') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
  payment_row.id:=gen_random_uuid(); payment_row.contract_id:=r.id; payment_row.kind:=p_payload->>'kind';
  payment_row.amount_satang:=sales_private.crm_rental_money(p_payload->'amountSatang',true);
  payment_row.paid_date:=sales_private.crm_rental_day(p_payload->'paidDate');
  IF payment_row.paid_date>today OR payment_row.paid_date<r.start_date THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
  BEGIN payment_row.reference:=sales_private.crm_work_text(p_payload->>'reference',200); payment_row.evidence_note:=sales_private.crm_work_text(p_payload->>'evidenceNote',1000);
  EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END;
  IF EXISTS(SELECT 1 FROM sales_private.rental_payments WHERE contract_id=r.id AND reference=payment_row.reference) THEN RAISE EXCEPTION 'CRM_RENTAL_CONFLICT'; END IF;
  SELECT COALESCE(sum(amount_satang),0)+payment_row.amount_satang INTO savings_total FROM sales_private.rental_payments WHERE contract_id=r.id AND kind=payment_row.kind;
  IF savings_total>99999999999 THEN RAISE EXCEPTION 'CRM_RENTAL_CONFLICT'; END IF;
  payment_row.recorded_at:=server_now; payment_row.actor_user_id:=actor_id; occurred:=payment_row.paid_date;
  INSERT INTO sales_private.rental_permits VALUES(txid_current(),pg_backend_pid(),actor_id,'payment',payment_row.id,NULL,to_jsonb(payment_row));
  INSERT INTO sales_private.rental_payments SELECT payment_row.*;
 ELSIF command_name IN ('end','convert_to_buy') THEN
  occurred:=sales_private.crm_rental_day(p_payload->CASE WHEN command_name='end' THEN 'endDate' ELSE 'purchaseDate' END);
  IF occurred<r.start_date OR occurred>today THEN RAISE EXCEPTION 'CRM_RENTAL_INVALID_INPUT'; END IF;
  r.ended_date:=occurred;
  IF command_name='end' THEN r.status:='ended'; ELSE
   -- Historical cutover seals all new sale writes until its separately reviewed
   -- booking writer is enabled. Never weaken or bypass that source seal.
   IF to_regprocedure('crm_external_private.guard_cutover_sale()') IS NOT NULL
    AND NOT sales_private.crm_booking_external_ready() THEN RAISE EXCEPTION 'CRM_RENTAL_SETUP_REQUIRED'; END IF;
   -- The existing booking command owns quotation validation, ownership, visit
   -- evidence, financial amounts, booking history and an actual Reserved sale.
   -- Never apply a projected B saving or a C transfer-dependent discount here.
   booking_payload:=jsonb_build_object('command','book','reason',reason_value,'customerId',c.id,'newCustomer',NULL,
    'projectName',i.project_name,'expectedInterestRevision',i.lifecycle_revision,'plotId',r.plot_id,
    'paymentMethod',p_payload->'paymentMethod','bookingRoute',p_payload->'bookingRoute','visitId',p_payload->'visitId',
    'listPriceSatang',p_payload->'listPriceSatang','discountSatang',p_payload->'discountSatang','depositSatang',p_payload->'depositSatang','previousSaleId',NULL);
   -- End occupancy only inside this transaction. The intermediate ended row is
   -- unobservable outside it; any booking/audit failure rolls everything back.
   r.status:='ended'; r.revision:=gen_random_uuid(); r.updated_at:=server_now;
   INSERT INTO sales_private.rental_permits VALUES(txid_current(),pg_backend_pid(),actor_id,'contract',r.id,previous,to_jsonb(r));
   UPDATE sales_private.rental_contracts SET status=r.status,revision=r.revision,ended_date=r.ended_date,updated_at=r.updated_at WHERE id=r.id;
   DELETE FROM sales_private.rental_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND entity_type='contract';
   previous:=to_jsonb(r);
   UPDATE public.plots SET has_customer=false WHERE id=r.plot_id;
   BEGIN booking_result:=public.crm_v2_booking_command(gen_random_uuid(),booking_payload);
   EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IN ('CRM_BOOKING_FORBIDDEN','CRM_BOOKING_STALE_STATE','CRM_BOOKING_INVALID_INPUT','CRM_BOOKING_SETUP_REQUIRED','CRM_BOOKING_NOT_FOUND') THEN
     RAISE EXCEPTION '%',replace(SQLERRM,'CRM_BOOKING_','CRM_RENTAL_'); END IF;
    RAISE EXCEPTION 'CRM_RENTAL_CONFLICT' USING DETAIL=SQLERRM;
   END;
   r.status:='converted'; r.converted_sale_id:=(booking_result->>'saleId')::uuid;
  END IF;
 END IF;
 r.revision:=gen_random_uuid(); r.updated_at:=server_now;
 INSERT INTO sales_private.rental_permits VALUES(txid_current(),pg_backend_pid(),actor_id,'contract',r.id,previous,to_jsonb(r));
 IF command_name='start' THEN INSERT INTO sales_private.rental_contracts SELECT r.*; UPDATE public.plots SET has_customer=true WHERE id=r.plot_id;
 ELSE UPDATE sales_private.rental_contracts SET status=r.status,revision=r.revision,end_date=r.end_date,monthly_rent_satang=r.monthly_rent_satang,
  ended_date=r.ended_date,converted_sale_id=r.converted_sale_id,updated_at=r.updated_at WHERE id=r.id; END IF;
 IF command_name='end' THEN
  UPDATE public.plots SET has_customer=false WHERE id=r.plot_id AND NOT EXISTS(SELECT 1 FROM public.sales WHERE plot_id=r.plot_id AND COALESCE(crm_stage,lower(contract_status),'unknown')<>'cancelled')
   AND NOT EXISTS(SELECT 1 FROM sales_private.rental_contracts WHERE plot_id=r.plot_id AND status IN ('active','renewed'));
 END IF;
 -- Preserve source cohort, engagement, activation reason and native Lead absence.
 IF command_name<>'convert_to_buy' THEN UPDATE public.lead_project_interests SET lifecycle_revision=gen_random_uuid(),updated_at=server_now WHERE id=i.id RETURNING * INTO i;
 ELSE SELECT * INTO i FROM public.lead_project_interests WHERE id=i.id; END IF;
 event_row.id:=gen_random_uuid(); event_row.contract_id:=r.id; event_row.command:=command_name; event_row.occurred_date:=occurred;
 event_row.recorded_at:=server_now; event_row.actor_user_id:=actor_id; event_row.reason:=reason_value; event_row.old_values:=audit_previous; event_row.new_values:=to_jsonb(r);
 INSERT INTO sales_private.rental_permits VALUES(txid_current(),pg_backend_pid(),actor_id,'event',event_row.id,NULL,to_jsonb(event_row));
 INSERT INTO sales_private.rental_events SELECT event_row.*;
 INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,actor_name_snapshot,old_values,new_values,occurred_at,recorded_at)
  VALUES(c.id,'rental',r.id,command_name,reason_value,actor_id,'staff',actor_name,audit_previous,
   jsonb_build_object('contract',to_jsonb(r),'payment',CASE WHEN command_name='record_payment' THEN to_jsonb(payment_row) ELSE NULL END),server_now,server_now);
 response:=jsonb_build_object('requestId',p_request_id,'command',command_name,'customerId',c.id,'interestId',i.id,'contractId',r.id,
  'contractRevision',r.revision,'interestRevision',i.lifecycle_revision,'saleId',r.converted_sale_id,'saleRevision',booking_result->'saleRevision','replayed',false);
 request.actor_user_id:=actor_id; request.request_id:=p_request_id; request.request_payload:=p_payload; request.response:=response; request.recorded_at:=server_now;
 INSERT INTO sales_private.rental_permits VALUES(txid_current(),pg_backend_pid(),actor_id,'receipt',p_request_id,NULL,to_jsonb(request));
 INSERT INTO sales_private.rental_requests SELECT request.*;
 DELETE FROM sales_private.rental_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN response;
END;
$command$;
REVOKE ALL ON FUNCTION public.crm_v2_rental_command(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_rental_command(uuid,jsonb) TO authenticated;
-- Exact reviewed lifecycle adapter: any rental history blocks prebooking Lost.
-- No label/status/date guessing; ended rentals remain business history too.
DO $lifecycle_adapters$
DECLARE plan record; fn oid; definition text; source text; owner_name text; secured boolean; settings text[];
 old_text text; new_text text; occurrences integer;
BEGIN
 FOR plan IN SELECT * FROM (VALUES
  ('public.crm_v2_lead_lifecycle_context(uuid,uuid)','7fdc46b6edffbb2051912b498f61a38b','context'),
  ('public.crm_v2_change_lead_lifecycle(uuid,jsonb)','f8b188911e61bd4c69568c525a75b6b4','command')) v(signature,digest,kind) LOOP
  fn:=to_regprocedure(plan.signature);
  IF fn IS NULL THEN RAISE EXCEPTION 'CRM_RENTAL_LIFECYCLE_REVIEW_REQUIRED'; END IF;
  SELECT pg_get_functiondef(p.oid),p.prosrc,pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig
   INTO definition,source,owner_name,secured,settings FROM pg_proc p WHERE p.oid=fn;
  IF owner_name IS DISTINCT FROM current_user OR NOT secured OR md5(source)<>plan.digest
   OR settings IS NULL OR NOT settings @> ARRAY['search_path=pg_catalog']
   OR EXISTS(SELECT 1 FROM unnest(settings) s WHERE s NOT IN ('search_path=pg_catalog','TimeZone=UTC'))
  THEN RAISE EXCEPTION 'CRM_RENTAL_LIFECYCLE_REVIEW_REQUIRED'; END IF;
  IF plan.kind='context' THEN
   old_text:='OR EXISTS (SELECT 1 FROM public.sales s WHERE s.lead_id=source_lead_id AND s.project_interest_id IS NULL);';
   new_text:='OR EXISTS (SELECT 1 FROM public.sales s WHERE s.lead_id=source_lead_id AND s.project_interest_id IS NULL)'
    ||E'\n    OR EXISTS (SELECT 1 FROM sales_private.rental_contracts r WHERE r.customer_id=p_customer_id AND (p_interest_id IS NULL OR r.interest_id=p_interest_id));';
  ELSE
   old_text:='WHERE s.lead_id=customer_row.legacy_source_lead_id AND s.project_interest_id IS NULL) THEN';
   new_text:='WHERE s.lead_id=customer_row.legacy_source_lead_id AND s.project_interest_id IS NULL)'
    ||E'\n      OR EXISTS (SELECT 1 FROM sales_private.rental_contracts r WHERE r.customer_id=customer_id_value AND (interest_id_value IS NULL OR r.interest_id=interest_id_value)) THEN';
  END IF;
  occurrences:=(length(definition)-length(replace(definition,old_text,'')))/length(old_text);
  IF occurrences<>1 THEN RAISE EXCEPTION 'CRM_RENTAL_LIFECYCLE_REVIEW_REQUIRED'; END IF;
  EXECUTE replace(definition,old_text,new_text);
 END LOOP;
END;
$lifecycle_adapters$;
-- Review deployment/RLS/source guards and retire legacy writers separately.
ROLLBACK;
