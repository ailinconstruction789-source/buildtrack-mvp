-- Synthetic integration facade only, appended to the isolated account suite.
BEGIN;
DO $$ BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR to_regnamespace('sales_private') IS NOT NULL THEN
    RAISE EXCEPTION 'FRESH SYNTHETIC CRM ALIGNMENT FIXTURE REQUIRED';
  END IF;
END; $$;
-- Deterministic synthetic roles after the preceding concurrent revoke tests.
UPDATE account_security_private.reviewed_roles SET role=CASE legacy_user_id
  WHEN 1 THEN 'Admin' WHEN 2 THEN 'Sales' WHEN 3 THEN 'Owner' WHEN 4 THEN 'Foreman'
  WHEN 5 THEN 'Site Engineer' WHEN 6 THEN 'QC' WHEN 7 THEN 'Project Planner'
  WHEN 8 THEN 'Procurement' ELSE 'Store' END,enabled=true,review_revision=0;
UPDATE account_security_private.reviewed_admins SET enabled=(legacy_user_id=1);
INSERT INTO auth.users(id,email) VALUES ('a0250000-0000-4000-8000-000000000010','guard_unreviewed@buildtrack.local');
INSERT INTO auth.sessions(id,user_id) VALUES ('b0250000-0000-4000-8000-000000000010','a0250000-0000-4000-8000-000000000010');
INSERT INTO public.users(id,username,role) VALUES(10,'guard_unreviewed','Admin');
-- Same minimal Sales facade as sql/sales/runtime/fixtures/bootstrap.sql, while
-- retaining the richer Auth/session/users fixture used by account security.
CREATE TABLE public.projects(name text PRIMARY KEY,is_closed boolean);
CREATE TABLE public.plots(id text PRIMARY KEY,project_name text,has_customer boolean,sale_status text);
CREATE TABLE public.leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),phone text);
CREATE TABLE public.sales(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid,plot_id text,contract_status text,cancellation_reason text);
CREATE TABLE public.customer_voices(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
REVOKE ALL ON public.projects,public.plots,public.leads,public.sales,public.customer_voices FROM PUBLIC,anon,authenticated;
COMMIT;
