-- Read-only aggregate review; name overlap is NOT identity evidence.
-- Do not use this query to merge records or select a bulk Lost write set.
WITH sale_customers AS (
 SELECT s.id AS sale_id,s.lead_id,c.customer_name
 FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id
 JOIN public.sales_customers c ON c.id=i.customer_id
)
SELECT jsonb_build_object(
 'legacy_leads', (SELECT count(*) FROM public.leads),
 'legacy_visit_leads', (SELECT count(*) FROM public.leads WHERE status='Visit'),
 'sales_with_exact_lead_id', (SELECT count(*) FROM public.sales WHERE lead_id IS NOT NULL),
 'sales_with_exact_crm_customer', (SELECT count(*) FROM sale_customers),
 'same_name_unlinked_pairs', (SELECT count(*) FROM public.leads l JOIN sale_customers s
   ON lower(trim(l.customer_name))=lower(trim(s.customer_name))
   WHERE s.lead_id IS DISTINCT FROM l.id AND trim(l.customer_name)<>''),
 'visit_leads_sharing_a_name_with_unlinked_sale', (SELECT count(*) FROM public.leads l
   WHERE l.status='Visit' AND EXISTS (SELECT 1 FROM sale_customers s
     WHERE lower(trim(s.customer_name))=lower(trim(l.customer_name))
     AND s.lead_id IS DISTINCT FROM l.id AND trim(l.customer_name)<>''))
) AS aggregate_review;


-- Browser-role table grants: false does not permit a nested CRM browser read.
SELECT r.role_name,t.table_name,
 has_table_privilege(r.role_name,'public.'||t.table_name,'SELECT') AS can_select
FROM (VALUES ('anon'),('authenticated')) r(role_name)
CROSS JOIN (VALUES ('sales'),('lead_project_interests'),('sales_customers')) t(table_name)
ORDER BY r.role_name,t.table_name;
