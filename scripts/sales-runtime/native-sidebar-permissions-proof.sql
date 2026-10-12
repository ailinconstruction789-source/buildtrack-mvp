-- Synthetic fixture in a verified owned loopback cluster only; caller wraps in BEGIN/ROLLBACK.
CREATE TEMP TABLE native_sidebar_roles AS
 SELECT DISTINCT ON(r.role) r.role,r.auth_user_id,s.id session_id
 FROM account_security_private.reviewed_roles r JOIN auth.sessions s ON s.user_id=r.auth_user_id
 WHERE r.enabled ORDER BY r.role;
GRANT SELECT ON native_sidebar_roles TO authenticated;
CREATE TEMP TABLE native_sidebar_results(label text PRIMARY KEY,passed boolean NOT NULL);
GRANT ALL ON native_sidebar_results TO authenticated;
DO $proof$
DECLARE actor record; lead uuid; sale uuid; plot text; n integer; denied boolean; claims text; sample uuid;
BEGIN
 FOR actor IN SELECT * FROM native_sidebar_roles WHERE role IN('Admin','Sales','Owner') LOOP
  SELECT p.id INTO plot FROM public.plots p WHERE NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.plot_id=p.id)
    ORDER BY p.id LIMIT 1;
  IF plot IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_VACANT_PLOT_REQUIRED'; END IF;
  claims:=jsonb_build_object('sub',actor.auth_user_id,'session_id',actor.session_id,'role','authenticated',
    'user_metadata',jsonb_build_object('role','Admin'))::text;
  PERFORM set_config('request.jwt.claims',claims,true); PERFORM set_config('request.jwt.claim.sub','',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF actor.role IN('Sales','Admin') THEN
   INSERT INTO public.leads(customer_name,status,project_name)
    VALUES('Synthetic native customer','Booked',(SELECT project_name FROM public.plots WHERE id=plot)) RETURNING id INTO lead;
   INSERT INTO public.sales(id,lead_id,plot_id,contract_status,crm_stage,payment_method,list_price,discount_amount,
     sale_price,booking_amount,bank_name,booked_at,created_at,updated_at)
    VALUES(gen_random_uuid(),lead,plot,'Reserved','booked','mortgage',1500000,100000,1400000,10000,NULL,now(),now(),now())
    RETURNING id INTO sale;
   INSERT INTO native_sidebar_results VALUES(actor.role||'_native_booking_with_active_old_seals',true);
   IF NOT EXISTS(SELECT 1 FROM public.plots WHERE id=plot AND has_customer) THEN RAISE EXCEPTION 'NATIVE_STOCK_NOT_SYNCED'; END IF;
   INSERT INTO native_sidebar_results VALUES(actor.role||'_exact_plot_stock_synced',true);
   UPDATE public.sales SET sale_price=1300000,land_office_price=1250000,bank_name='Synthetic bank',crm_stage='contracted',contract_status='Contracted',contracted_at=now() WHERE id=sale;
   GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'NATIVE_UPDATE_FAILED'; END IF;
   UPDATE public.leads SET customer_name='Synthetic updated',phone='0811111111',occupation='Synthetic',agent_name='Synthetic Sales',notes='Synthetic preserved note' WHERE id=lead;
   GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'NATIVE_LEAD_UPDATE_FAILED'; END IF;
   INSERT INTO public.status_history(entity_type,entity_id,old_status,new_status,changed_by) VALUES('lead',lead,'booked','contracted','Synthetic actor');
   INSERT INTO native_sidebar_results VALUES(actor.role||'_profile_price_bank_status_history_saved',true);
   INSERT INTO public.lead_activities(native_lead_id,activity_type,result,occurred_at,note,next_follow_up_at)
    VALUES(lead,'note','contact_success',now(),'Synthetic booking history',now()+interval '1 day');
   IF NOT EXISTS(SELECT 1 FROM public.lead_activities WHERE native_lead_id=lead AND customer_id IS NULL
     AND crm_scope_key IS NULL AND recorded_by_user_id=actor.auth_user_id) THEN RAISE EXCEPTION 'NATIVE_HISTORY_ACTOR_FAILED'; END IF;
   INSERT INTO native_sidebar_results VALUES(actor.role||'_new_history_separate_from_old_crm_fk',true);
   denied:=false;
   BEGIN INSERT INTO public.lead_activities(native_lead_id,activity_type,occurred_at,recorded_by_user_id)
     VALUES(lead,'note',now(),gen_random_uuid()); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
   IF NOT denied THEN RAISE EXCEPTION 'NATIVE_ACTOR_SPOOF_ALLOWED'; END IF;
   INSERT INTO native_sidebar_results VALUES(actor.role||'_history_actor_spoof_denied',true);
   denied:=false;
   BEGIN UPDATE public.sales SET lead_id=gen_random_uuid() WHERE id=sale; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
   IF NOT denied THEN RAISE EXCEPTION 'NATIVE_IDENTITY_WRITE_ALLOWED'; END IF;
   INSERT INTO native_sidebar_results VALUES(actor.role||'_sale_identity_reassignment_denied',true);
   denied:=false;
   BEGIN UPDATE public.plots SET has_customer=false WHERE id=plot; EXCEPTION WHEN raise_exception THEN denied:=true; END;
   IF NOT denied THEN RAISE EXCEPTION 'NATIVE_FORGED_STOCK_ALLOWED'; END IF;
   INSERT INTO native_sidebar_results VALUES(actor.role||'_forged_plot_stock_denied',true);
   UPDATE public.sales SET crm_stage='transfer_pending' WHERE id=sale;
   UPDATE public.sales SET crm_stage='transferred',contract_status='Transferred',transferred_at='2026-10-12T05:00:00Z' WHERE id=sale;
   UPDATE public.sales SET crm_stage='handover',crm_handover_at='2026-10-12T05:00:00Z' WHERE id=sale;
   IF NOT EXISTS(SELECT 1 FROM public.plots WHERE id=plot AND has_customer AND sale_status='transferred') THEN RAISE EXCEPTION 'NATIVE_TRANSFER_STOCK_FAILED'; END IF;
   INSERT INTO native_sidebar_results VALUES(actor.role||'_transfer_handover_exact_plot_synced',true);
   UPDATE public.sales SET sale_price=1 WHERE id='10000000-0000-4000-8000-000000000099';
   GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'UNLINKED_HISTORICAL_SALE_CHANGED'; END IF;
   INSERT INTO native_sidebar_results VALUES(actor.role||'_historical_unlinked_sale_write_denied',true);
  ELSE
   denied:=false;
   BEGIN INSERT INTO public.leads(customer_name,status) VALUES('Synthetic owner denied','New'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
   IF NOT denied THEN RAISE EXCEPTION 'OWNER_LEAD_WRITE_ALLOWED'; END IF;
   SELECT id INTO sample FROM public.sales WHERE lead_id IS NOT NULL LIMIT 1;
   UPDATE public.sales SET sale_price=1 WHERE id=sample; GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>0 THEN RAISE EXCEPTION 'OWNER_SALE_UPDATE_ALLOWED'; END IF;
   denied:=false;
   BEGIN INSERT INTO public.status_history(entity_type,entity_id,new_status) VALUES('sale',sample,'booked'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
   IF NOT denied THEN RAISE EXCEPTION 'OWNER_HISTORY_WRITE_ALLOWED'; END IF;
   INSERT INTO native_sidebar_results VALUES('Owner_read_only_despite_forged_Admin_metadata',true);
  END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
 IF (SELECT count(*) FROM native_sidebar_results WHERE label LIKE '%_native_booking_with_active_old_seals')<>2 THEN RAISE EXCEPTION 'ROLE_FIXTURES_MISSING'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lead_activities WHERE id='10000000-0000-4000-8000-000000000098'
   AND customer_id='10000000-0000-4000-8000-000000000097' AND native_lead_id IS NULL
   AND crm_scope_key='customer:10000000-0000-4000-8000-000000000097') THEN RAISE EXCEPTION 'OLD_CRM_HISTORY_CHANGED'; END IF;
 INSERT INTO native_sidebar_results VALUES('old_CRM_history_FK_scope_values_retained',true);
END; $proof$;
SELECT jsonb_build_object('phase','native_sidebar_permission_proof','passed',(SELECT count(*) FROM native_sidebar_results),
 'results',(SELECT jsonb_agg(to_jsonb(r) ORDER BY label) FROM native_sidebar_results r));
