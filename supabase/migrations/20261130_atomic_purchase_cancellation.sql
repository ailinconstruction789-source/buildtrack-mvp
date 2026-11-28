BEGIN;

-- Retire all existing grants with a fail-closed implementation as well.
CREATE OR REPLACE FUNCTION public.cancel_plot_sale_and_release(
  p_plot_id text, p_sale_id uuid DEFAULT NULL, p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'SALES_TX_USE_PURCHASE_CANCELLATION';
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_plot_sale_and_release(text,uuid,text) FROM PUBLIC, anon, authenticated;

ALTER TABLE sales_private.plot_stock_write_permits DROP CONSTRAINT plot_stock_write_permits_command_check,
  ADD CHECK (command IN ('rental_book','rental_sign_contract','rental_cancel_booking','rental_move_out','rental_convert_to_buy','purchase_book','purchase_ensure_sale','legacy_plot_release','purchase_cancel'));
ALTER TABLE sales_private.sale_tx_write_permits DROP CONSTRAINT sale_tx_write_permits_command_check,
  ADD CHECK (command IN ('rental_convert_to_buy','purchase_book','purchase_ensure_sale','purchase_cancel')),
  ALTER COLUMN lead_id DROP NOT NULL,
  ADD CHECK (lead_id IS NOT NULL OR command = 'purchase_cancel');
ALTER TABLE sales_private.rental_tx_requests DROP CONSTRAINT rental_tx_requests_command_check,
  ADD CHECK (command IN ('rental_book','rental_sign_contract','rental_cancel_booking','rental_move_out','rental_convert_to_buy','purchase_book','legacy_plot_release','purchase_cancel'));

CREATE FUNCTION sales_private.cancel_native_purchase(p_request_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE
  actor record;
  receipt sales_private.rental_tx_requests%ROWTYPE;
  s public.sales%ROWTYPE;
  l public.leads%ROWTYPE;
  p public.plots%ROWTYPE;
  lead_key uuid := (p_payload->>'leadId')::uuid;
  plot_key text := p_payload->>'plotId';
  sale_key uuid := (p_payload->>'saleId')::uuid;
  why text := nullif(btrim(p_payload->>'reason'),'');
  category text := p_payload->>'category';
  sale_patch jsonb := coalesce(p_payload->'salePatch','{}');
  lead_patch jsonb := coalesce(p_payload->'leadPatch','{}');
  event_time timestamptz := ((p_payload->>'eventDate')::date + time '12:00') AT TIME ZONE 'Asia/Bangkok';
  result jsonb;
BEGIN
  SELECT * INTO actor FROM sales_private.require_sales_writer();
  IF actor.actor_role NOT IN ('sales','admin') OR actor.actor_id IS NULL THEN RAISE EXCEPTION 'SALES_TX_FORBIDDEN'; END IF;
  IF p_request_id IS NULL OR sale_key IS NULL OR plot_key IS NULL OR why IS NULL
     OR category IS NULL OR category NOT IN ('booking_cancelled','downpayment_abandoned','final_loan_rejection','other')
     OR event_time IS NULL OR (p_payload->>'eventDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR NOT (p_payload ?& ARRAY['leadId','expectedSaleUpdatedAt','expectedLeadUpdatedAt'])
     OR jsonb_typeof(sale_patch) <> 'object' OR jsonb_typeof(lead_patch) <> 'object'
     OR sale_patch - ARRAY['sale_price','land_office_price','payment_method','bank_name'] <> '{}'
     OR lead_patch - ARRAY['customer_name','phone','occupation','agent_name'] <> '{}'
     OR (lead_key IS NULL AND lead_patch <> '{}')
     OR (lead_patch ? 'customer_name' AND nullif(btrim(lead_patch->>'customer_name'),'') IS NULL)
     OR (sale_patch ? 'payment_method' AND coalesce(sale_patch->>'payment_method','') NOT IN ('cash','mortgage'))
     OR (sale_patch->>'sale_price')::numeric < 0 OR (sale_patch->>'land_office_price')::numeric < 0
  THEN RAISE EXCEPTION 'SALES_TX_INVALID_INPUT'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
  SELECT * INTO receipt FROM sales_private.rental_tx_requests WHERE actor_user_id=actor.actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF receipt.command <> 'purchase_cancel' OR receipt.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'SALES_TX_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN receipt.response;
  END IF;
  IF EXISTS (SELECT FROM public.crm_settings WHERE central_intake_enabled OR booking_enabled OR post_booking_enabled) THEN RAISE EXCEPTION 'SALES_TX_FORBIDDEN'; END IF;
  PERFORM 1 FROM public.projects pr JOIN public.plots pl ON pl.project_name=pr.name
    WHERE pl.id=plot_key AND NOT coalesce(pr.is_closed,false) FOR SHARE OF pr;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALES_TX_PROJECT_UNAVAILABLE'; END IF;
  SELECT * INTO STRICT p FROM public.plots WHERE id=plot_key FOR UPDATE;
  IF lower(coalesce(p.sale_status,'')) IN ('transferred','sold','handover','rented')
     OR nullif(btrim(p.current_tenant_name),'') IS NOT NULL OR p.rental_program IS NOT NULL
  THEN RAISE EXCEPTION 'SALES_TX_PLOT_HELD_BY_OTHER'; END IF;
  IF lead_key IS NOT NULL THEN
    SELECT * INTO STRICT l FROM public.leads WHERE id=lead_key FOR UPDATE;
    IF l.project_name IS DISTINCT FROM p.project_name OR (l.interested_plot_id IS NOT NULL AND l.interested_plot_id <> plot_key)
       OR l.status IS NULL OR lower(l.status) NOT IN ('booked','reserved','contracted','downpayment','documentprep','loanprocessing','approved','transferpending','loanrejected')
       OR sales_private.lead_is_active_or_pending_rental_holder(l) OR sales_private.lead_has_deal_conflict(l)
       OR l.updated_at IS DISTINCT FROM (p_payload->>'expectedLeadUpdatedAt')::timestamptz
    THEN RAISE EXCEPTION 'SALES_TX_STALE_STATE'; END IF;
  END IF;
  SELECT * INTO STRICT s FROM public.sales WHERE id=sale_key FOR UPDATE;
  IF s.lead_id IS DISTINCT FROM lead_key OR s.plot_id IS DISTINCT FROM plot_key
     OR s.updated_at IS DISTINCT FROM (p_payload->>'expectedSaleUpdatedAt')::timestamptz
     OR s.contract_status IS NULL OR s.contract_status NOT IN ('Reserved','Booked','Contracted')
     OR coalesce(s.crm_stage,'booked') NOT IN ('booked','contracted','downpayment','document_prep','loan_submitted','loan_rejected','loan_approved','transfer_pending')
     OR s.transferred_at IS NOT NULL OR s.crm_handover_at IS NOT NULL OR s.cancelled_at IS NOT NULL
     OR s.project_interest_id IS NOT NULL OR s.external_booking_id IS NOT NULL OR s.external_source_stage IS NOT NULL
  THEN RAISE EXCEPTION 'SALES_TX_STALE_STATE'; END IF;
  IF EXISTS (SELECT FROM public.sales other WHERE other.id <> sale_key AND (other.plot_id=plot_key OR other.lead_id=lead_key)
      AND lower(coalesce(other.crm_stage,other.contract_status,'')) <> 'cancelled') THEN RAISE EXCEPTION 'SALES_TX_CONFLICT'; END IF;

  IF lead_key IS NOT NULL THEN
    UPDATE public.leads SET status='Cancelled',crm_status='Cancelled — ยกเลิกจอง',lost_reason=why,
      customer_name=coalesce(lead_patch->>'customer_name',customer_name),
      phone=CASE WHEN lead_patch ? 'phone' THEN lead_patch->>'phone' ELSE phone END,
      occupation=CASE WHEN lead_patch ? 'occupation' THEN lead_patch->>'occupation' ELSE occupation END,
      agent_name=CASE WHEN lead_patch ? 'agent_name' THEN lead_patch->>'agent_name' ELSE agent_name END,
      notes=concat_ws(E'\n',format('[ยกเลิกจอง %s โดย %s] %s',p_payload->>'eventDate',actor.actor_label,why),nullif(p_payload->>'note',''),notes),
      deal_revision=gen_random_uuid(),updated_at=clock_timestamp() WHERE id=lead_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'SALES_TX_STALE_STATE'; END IF;
  END IF;
  INSERT INTO sales_private.sale_tx_write_permits(transaction_id,backend_pid,actor_user_id,sale_id,plot_id,lead_id,command,expected_op,expected_contract_status,expected_crm_stage)
    VALUES(txid_current(),pg_backend_pid(),actor.actor_id,sale_key,plot_key,lead_key,'purchase_cancel','UPDATE','Cancelled','cancelled');
  -- The sales AFTER trigger changes only has_customer. Permit its exact original status first.
  INSERT INTO sales_private.plot_stock_write_permits(transaction_id,backend_pid,actor_user_id,plot_id,command,expected_has_customer,expected_sale_status)
    VALUES(txid_current(),pg_backend_pid(),actor.actor_id,plot_key,'purchase_cancel',false,p.sale_status);
  UPDATE public.sales SET contract_status='Cancelled',crm_stage='cancelled',cancelled_at=event_time,
    cancellation_reason=why,cancellation_category=category,
    sale_price=CASE WHEN sale_patch ? 'sale_price' THEN (sale_patch->>'sale_price')::numeric ELSE sale_price END,
    land_office_price=CASE WHEN sale_patch ? 'land_office_price' THEN (sale_patch->>'land_office_price')::numeric ELSE land_office_price END,
    bank_name=CASE WHEN sale_patch ? 'bank_name' THEN sale_patch->>'bank_name' ELSE bank_name END,
    payment_method=coalesce(sale_patch->>'payment_method',payment_method),updated_at=clock_timestamp()
    WHERE id=sale_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALES_TX_STALE_STATE'; END IF;
  IF sales_private.plot_has_active_holder(plot_key) THEN RAISE EXCEPTION 'SALES_TX_PLOT_HELD_BY_OTHER'; END IF;
  UPDATE sales_private.plot_stock_write_permits SET expected_sale_status='ready_for_sale'
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND plot_id=plot_key;
  UPDATE public.plots SET has_customer=false,sale_status='ready_for_sale',
    highlight_note=CASE WHEN highlight_note LIKE 'จอง:%' THEN NULL ELSE highlight_note END WHERE id=plot_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALES_TX_STALE_STATE'; END IF;
  INSERT INTO public.status_history(entity_type,entity_id,old_status,new_status,changed_by,created_at)
    VALUES ('sale',sale_key,coalesce(s.crm_stage,s.contract_status),'cancelled',concat_ws(' | ',actor.actor_label,why,nullif(p_payload->>'note','')),event_time);
  IF lead_key IS NOT NULL THEN
    INSERT INTO public.status_history(entity_type,entity_id,old_status,new_status,changed_by,created_at)
      VALUES ('lead',lead_key,l.status,'cancelled',concat_ws(' | ',actor.actor_label,why,nullif(p_payload->>'note','')),event_time);
  END IF;
  result := jsonb_build_object('requestId',p_request_id,'command','purchase_cancel','saleId',sale_key,'leadId',lead_key,'plotId',plot_key,'plotReleased',true);
  INSERT INTO sales_private.rental_tx_requests(actor_user_id,request_id,command,request_payload,response)
    VALUES(actor.actor_id,p_request_id,'purchase_cancel',p_payload,result);
  DELETE FROM sales_private.plot_stock_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND plot_id=plot_key;
  DELETE FROM sales_private.sale_tx_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND sale_id=sale_key;
  RETURN result;
END;
$fn$;
REVOKE ALL ON FUNCTION sales_private.cancel_native_purchase(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION sales_private.cancel_native_purchase(uuid,jsonb) TO authenticated;
-- SQL-standard body resolves the private name at definition time.
CREATE FUNCTION public.sales_tx_cancel_purchase(p_request_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog
RETURN sales_private.cancel_native_purchase(p_request_id,p_payload);
REVOKE ALL ON FUNCTION public.sales_tx_cancel_purchase(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_tx_cancel_purchase(uuid,jsonb) TO authenticated;
COMMIT;
