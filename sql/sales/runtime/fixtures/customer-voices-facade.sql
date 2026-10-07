-- Synthetic native-test facade ONLY. Column definitions verified against
-- sales_funnel_and_leads_migration.sql; never run against an application database.
DO $guard$ BEGIN
  IF current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
    THEN RAISE EXCEPTION 'Synthetic database required'; END IF;
END $guard$;
ALTER TABLE public.customer_voices
  ADD COLUMN lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  ADD COLUMN survey_date timestamptz DEFAULT now(),
  ADD COLUMN customer_name varchar,
  ADD COLUMN nickname varchar, ADD COLUMN age varchar, ADD COLUMN gender varchar,
  ADD COLUMN phone varchar, ADD COLUMN line_id varchar, ADD COLUMN project_name varchar,
  ADD COLUMN agent_name varchar, ADD COLUMN marital_status varchar, ADD COLUMN education_level varchar,
  ADD COLUMN occupation varchar, ADD COLUMN monthly_income varchar, ADD COLUMN family_members varchar,
  ADD COLUMN previous_residence varchar, ADD COLUMN monthly_rent numeric(15,2),
  ADD COLUMN purpose_relocate boolean DEFAULT false,
  ADD COLUMN purpose_family_expansion boolean DEFAULT false,
  ADD COLUMN purpose_independence boolean DEFAULT false,
  ADD COLUMN purpose_rent_to_own boolean DEFAULT false,
  ADD COLUMN purpose_debt_consolidation boolean DEFAULT false,
  ADD COLUMN reason_price boolean DEFAULT false, ADD COLUMN reason_location boolean DEFAULT false,
  ADD COLUMN reason_promotion boolean DEFAULT false, ADD COLUMN reason_design boolean DEFAULT false,
  ADD COLUMN reason_house_type boolean DEFAULT false, ADD COLUMN reason_other text,
  ADD COLUMN source_facebook boolean DEFAULT false, ADD COLUMN source_tiktok boolean DEFAULT false,
  ADD COLUMN source_youtube boolean DEFAULT false, ADD COLUMN source_billboard boolean DEFAULT false,
  ADD COLUMN source_other text,
  ADD COLUMN score_knowledge integer, ADD COLUMN score_problem_solving integer,
  ADD COLUMN score_service_mind integer, ADD COLUMN score_appearance integer,
  ADD COLUMN score_cleanliness integer, ADD COLUMN score_house_design integer,
  ADD COLUMN score_price integer, ADD COLUMN score_location integer, ADD COLUMN score_average numeric(4,2),
  ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
-- Earlier synthetic suites used an id-only facade; label ONLY those fake rows.
UPDATE public.customer_voices SET customer_name='Synthetic earlier-suite voice' WHERE customer_name IS NULL;
ALTER TABLE public.customer_voices ALTER COLUMN customer_name SET NOT NULL;
