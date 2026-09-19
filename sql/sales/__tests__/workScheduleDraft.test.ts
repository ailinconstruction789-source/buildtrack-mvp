// @vitest-environment node
// STATIC design checks only: never execute SQL or claim PostgreSQL/RLS correctness.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'sql/sales/06_work_schedule_draft.sql'), 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const publish = code.split('AS $publish$')[1].split('$publish$;')[0];
const snapshot = code.split('AS $snapshot$')[1].split('$snapshot$;')[0];
const capability = code.split('AS $capabilities$')[1].split('$capabilities$;')[0];
const afterClock = publish.split('server_now:=clock_timestamp();')[1];
const beforeClock = publish.split('server_now:=clock_timestamp();')[0];
const position = (value: string) => {
    const result = publish.indexOf(value);
    expect(result, value).toBeGreaterThanOrEqual(0);
    return result;
};

describe('work schedule design safety and privacy (static only)', () => {
    it('aborts before any DDL and ends with rollback, never enablement', () => {
        expect(code.trim()).toMatch(/^BEGIN;/);
        expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('ALTER TABLE'));
        expect(code.trim()).toMatch(/ROLLBACK;$/);
        expect(code).toContain('ADD COLUMN work_schedule_enabled boolean NOT NULL DEFAULT false');
        expect(code).not.toMatch(/\b(?:COMMIT|TRUNCATE|DROP|COPY|CALL)\b|\bDELETE\s+FROM\b|work_schedule_enabled\s*=\s*true/i);
    });
    it('requires all four DB gates for capability/read/write, including direct RPC calls', () => {
        const gates = 'central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND work_schedule_enabled';
        expect(code.match(new RegExp(gates, 'g'))).toHaveLength(3);
        expect(capability).toContain("'contract_version','work_schedule_v1'");
        expect(capability).toContain("public.crm_v2_role()='admin'");
        expect(publish).toContain('FROM public.crm_settings WHERE id FOR SHARE');
        expect(position('CRM_SCHEDULE_SETUP_REQUIRED')).toBeLessThan(position('PERFORM pg_advisory_xact_lock'));
        expect(snapshot.indexOf('CRM_SCHEDULE_SETUP_REQUIRED')).toBeLessThan(snapshot.indexOf('WITH recent AS'));
    });
    it('pins definer search paths and permits only authenticated function invocation', () => {
        expect(code.match(/SECURITY DEFINER SET search_path = pg_catalog/g)).toHaveLength(3);
        for (const name of ['crm_v2_work_schedule_capabilities()', 'crm_v2_work_schedule_snapshot(uuid)', 'crm_v2_publish_work_schedule(uuid,jsonb)']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION public.${name} FROM PUBLIC, anon;`);
            expect(code).toContain(`GRANT EXECUTE ON FUNCTION public.${name} TO authenticated;`);
        }
        expect(code).not.toMatch(/GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)|CREATE POLICY/i);
    });
    it('keeps calendar versions private and closes the original broad period read grant', () => {
        for (const table of ['sales_private.crm_work_calendars', 'sales_private.crm_work_calendar_versions']) {
            expect(code).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
            expect(code).toContain(`REVOKE ALL ON ${table} FROM PUBLIC, anon, authenticated;`);
        }
        expect(code).toContain('REVOKE ALL ON public.crm_work_periods FROM PUBLIC, anon, authenticated;');
        expect(source).toContain('base global CRM read policy is too broad');
        expect(code).not.toContain('GRANT USAGE ON SCHEMA sales_private');
    });
    it('reuses work periods, adds only version linkage, and never backfills unknown history', () => {
        expect(code).not.toMatch(/CREATE TABLE public\.crm_work_periods/);
        expect(code).toContain('ADD COLUMN calendar_version_id uuid,');
        expect(code).not.toMatch(/calendar_version_id uuid NOT NULL|calendar_version_id uuid DEFAULT/);
        expect(code).not.toMatch(/UPDATE public\.crm_work_periods|DELETE FROM public\.crm_work_periods/);
        expect(snapshot).toContain('WHERE calendar_version_id=version_row.id AND sales_user_id=p_sales_user_id');
        expect(snapshot).not.toMatch(/calendar_version_id IS NULL|COALESCE\(calendar_version_id/);
    });
    it('does not mutate leads, current obligations, evaluation snapshots or notifications', () => {
        expect(code).not.toMatch(/(?:INSERT INTO|UPDATE|ALTER TABLE) public\.(?:leads|sales|plots|sales_customers|lead_project_interests|crm_sla_tasks|crm_notifications|crm_next_actions|lead_activities)\b/);
        expect(code).not.toMatch(/staff_due_at\s*=|notify_at\s*=|service_due_at\s*=|evaluation_snapshot\s*=|withdrawn_at\s*=/);
        expect(code).not.toMatch(/cron\.|net\.|dblink|http_|user_metadata|app_metadata/);
    });
});

describe('immutable whole-coverage snapshots and existing receipt reuse (static)', () => {
    it('has one stable head per Sales and a version receipt without a duplicate request ledger', () => {
        expect(code.match(/CREATE TABLE/g)).toHaveLength(2);
        expect(code).toContain('sales_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id)');
        expect(code).toContain('UNIQUE (published_by_user_id,request_id)');
        expect(code).toContain('request_payload jsonb NOT NULL');
        expect(code).not.toMatch(/CREATE TABLE[^;]*(?:requests|receipts)|lead_work_command_requests/);
        const headUpdate = afterClock.split('UPDATE sales_private.crm_work_calendars')[1].split(';')[0];
        expect(headUpdate).toBe(' SET current_version_id=next_version WHERE id=calendar_id_value');
    });
    it('binds current and previous versions to their own calendar and period owner', () => {
        expect(code).toContain('FOREIGN KEY (current_version_id,id)');
        expect(code).toContain('REFERENCES sales_private.crm_work_calendar_versions(id,calendar_id)');
        expect(code).toContain('DEFERRABLE INITIALLY DEFERRED');
        expect(code).toContain('current_version_id uuid NOT NULL');
        expect(code).toContain('FOREIGN KEY (previous_version_id,calendar_id)');
        expect(code).toContain('FOREIGN KEY (calendar_id,sales_user_id) REFERENCES sales_private.crm_work_calendars(id,sales_user_id)');
        expect(code).toContain('FOREIGN KEY (calendar_version_id,sales_user_id)');
        expect(code).toContain('REFERENCES sales_private.crm_work_calendar_versions(id,sales_user_id)');
    });
    it('prevents updating/deleting versions or versioned periods and attaching old rows', () => {
        expect(code).toContain('CREATE TRIGGER crm_work_versions_immutable BEFORE UPDATE OR DELETE ON sales_private.crm_work_calendar_versions');
        expect(code).toContain('CREATE TRIGGER crm_work_versioned_periods_immutable BEFORE UPDATE OR DELETE ON public.crm_work_periods');
        expect(code).toContain("IF OLD.calendar_version_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'");
        expect(code).toContain("IF NEW.calendar_version_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'");
        for (const name of ['crm_work_version_immutable()', 'crm_work_versioned_period_immutable()']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION sales_private.${name} FROM PUBLIC, anon, authenticated;`);
        }
    });
    it('stores positive completeness and finite coverage bounded to 366 actual days', () => {
        expect(code).toContain('coverage_complete boolean NOT NULL CHECK (coverage_complete)');
        expect(code).toContain('isfinite(coverage_starts_at) AND isfinite(coverage_ends_at)');
        expect(code).toContain("coverage_ends_at-coverage_starts_at<=interval '31622400 seconds'");
        expect(publish).toContain("coverage_through-coverage_from>interval '31622400 seconds'");
        expect(publish).not.toMatch(/interval '366 days'|date_trunc\(|AT TIME ZONE 'Asia\/Bangkok'/);
    });
    it('appends a whole replacement and leaves prior rows/deadlines unchanged', () => {
        expect(afterClock).toContain('INSERT INTO sales_private.crm_work_calendar_versions');
        expect(afterClock).toContain('CASE WHEN head_exists THEN head_row.current_version_id ELSE NULL END');
        expect(afterClock).toContain('INSERT INTO public.crm_work_periods');
        expect(afterClock).not.toMatch(/UPDATE sales_private\.crm_work_calendar_versions|UPDATE public\.crm_work_periods|DELETE FROM/);
        expect(afterClock).toContain('coverage_from,coverage_through,true,server_now,actor_id,reason_value,p_request_id,p_payload');
        expect(afterClock).toContain('SELECT target_id,p.period_type,p.starts_at,p.ends_at,NULL,actor_id,server_now,next_version');
    });
});

describe('Admin-only schedule snapshot (static)', () => {
    it('is an independent read-only projection with current active Admin authorization', () => {
        expect(code).toContain('crm_v2_work_schedule_snapshot(p_sales_user_id uuid DEFAULT NULL)');
        expect(code).toContain('RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER');
        expect(snapshot).toContain('actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role()');
        expect(snapshot).toContain("actor_role IS DISTINCT FROM 'admin'");
        expect(snapshot).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|PERFORM|EXECUTE|CALL)\b|FOR SHARE|FOR UPDATE|pg_advisory|last_seen/);
        expect(snapshot).toContain('as_of:=clock_timestamp()');
        expect(code).toContain("STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'");
    });
    it('rejects unknown/inactive selected Sales and never auto-selects another user', () => {
        expect(snapshot).toContain("WHERE user_id=p_sales_user_id AND role='sales' AND is_active");
        expect(snapshot).toContain('CRM_SCHEDULE_NOT_FOUND');
        expect(snapshot).toContain('calendar_json jsonb:=NULL');
        expect(snapshot).toContain('IF p_sales_user_id IS NOT NULL THEN');
        expect(snapshot).toContain("'selectedSalesUserId',p_sales_user_id,'calendar',calendar_json");
        expect(snapshot).not.toMatch(/p_sales_user_id\s*:=|COALESCE\(p_sales_user_id/);
    });
    it('includes an explicit selected user in a bounded list with an honest omitted-candidates flag', () => {
        expect(snapshot).toContain("WHERE role='sales' AND is_active");
        expect(snapshot).toContain('ORDER BY (user_id=p_sales_user_id) DESC NULLS LAST,user_id LIMIT 201');
        expect(snapshot).toContain('row_number() OVER (ORDER BY (user_id=p_sales_user_id) DESC NULLS LAST,user_id)');
        expect(snapshot).toContain('FILTER (WHERE n.rn<=200)');
        expect(snapshot).toContain('count(*)>200');
        expect(snapshot).toContain("'userId',n.user_id,'displayName',n.display_name");
    });
    it('reads only the current version for that calendar and Sales, without legacy fallback', () => {
        expect(snapshot).toContain('WHERE sales_user_id=p_sales_user_id');
        expect(snapshot).toContain('WHERE id=head_row.current_version_id AND calendar_id=head_row.id AND sales_user_id=p_sales_user_id');
        expect(snapshot).toContain('WHERE calendar_version_id=version_row.id AND sales_user_id=p_sales_user_id');
        expect(snapshot).toContain('ORDER BY starts_at,id LIMIT 401');
        expect(snapshot).toContain("IF period_count>400 THEN RAISE EXCEPTION 'CRM_SCHEDULE_SETUP_REQUIRED'");
    });
    it('projects only schedule contract fields and Admin change reason, never raw HR reasons or receipts', () => {
        for (const field of ['raw', 'id', 'version', 'ownerUserId', 'coverage', 'startsAt', 'endsAt', 'complete', 'periods',
            'publishedAt', 'publishedByUserId', 'changeReason', 'actor', 'asOf', 'sales', 'salesHasMore', 'selectedSalesUserId', 'calendar']) {
            expect(snapshot).toContain(`'${field}'`);
        }
        expect(snapshot).toContain("'type',p.period_type,'startsAt',p.starts_at,'endsAt',p.ends_at");
        expect(snapshot).not.toMatch(/to_jsonb\(|row_to_json\(|p\.reason|request_payload|evaluation_snapshot|monthly_income|personal_data/);
    });
});

describe('publish validation and serialization (static)', () => {
    it('accepts exact keys with a bounded payload and explicit completeness', () => {
        expect(publish).toContain("ARRAY['salesUserId','expectedVersion','coverage','periods','confirmedComplete','reason']");
        expect(publish).toContain('jsonb_object_keys(p_payload)');
        expect(publish).toContain('octet_length(p_payload::text)>65536');
        expect(publish).toContain("(p_payload->'confirmedComplete') IS DISTINCT FROM 'true'::jsonb");
        expect(publish).toContain("jsonb_array_length(p_payload->'periods')>400");
        expect(publish).not.toMatch(/jsonb_array_length\(p_payload->'periods'\)\s*(?:=0|<1)/);
        expect(position("jsonb_typeof(p_payload->'periods') IS DISTINCT FROM 'array'")).toBeLessThan(position("jsonb_array_length(p_payload->'periods')"));
    });
    it('uses strict UUIDs and null initial revision, without accepting supplied authors or period IDs', () => {
        expect(publish).toContain('p_request_id IS NULL');
        for (const field of ['salesUserId', 'expectedVersion']) {
            expect(publish).toContain(`length(p_payload->>'${field}')<>36`);
            expect(publish).toContain(`(p_payload->>'${field}') !~ uuid_pattern`);
        }
        expect(publish).toContain("jsonb_typeof(p_payload->'expectedVersion') NOT IN ('string','null')");
        expect(publish).toContain("ARRAY['startsAt','endsAt']");
        expect(publish).toContain("ARRAY['type','startsAt','endsAt']");
        expect(publish).toContain("jsonb_object_keys(row_json) k WHERE k NOT IN ('type','startsAt','endsAt')");
        expect(publish).not.toMatch(/p_payload->>'(?:actor|createdBy|publishedBy|role|calendarId)'|row_json->>'(?:id|reason|salesUserId)'/);
    });
    it('reuses strict 04 text/time parsing and remaps only pre-write validation failures', () => {
        expect(publish).toContain("sales_private.crm_work_text(p_payload->>'reason',1000)");
        expect(publish.match(/sales_private\.crm_work_timestamp\(/g)).toHaveLength(4);
        expect(beforeClock.match(/EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_SCHEDULE_INVALID_INPUT'/g)).toHaveLength(2);
        expect(afterClock).not.toMatch(/EXCEPTION WHEN/);
        expect(publish).toContain("TIMESTAMPTZ '0001-01-01 00:00:00+00'");
        expect(publish).toContain("TIMESTAMPTZ '9999-12-31 23:59:59.999999+00'");
    });
    it('requires actual work inside coverage and rejects overlapping work at exact boundaries', () => {
        expect(publish).toContain("row_type='work' AND (row_from<coverage_from OR row_through>coverage_through)");
        expect(publish).toContain('row_from>=row_through');
        expect(publish).toContain("WHERE p.period_type='work'");
        expect(publish).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING');
        expect(publish).toContain('checked WHERE starts_at<prior_end');
        expect(publish).not.toContain('checked WHERE starts_at<=prior_end');
    });
    it('uses one consistent lock order for initial and replacement snapshots', () => {
        const order = ['FROM public.crm_settings WHERE id FOR SHARE',
            "hashtextextended('work-schedule-request:'", "hashtextextended('work-schedule-sales:'",
            'SELECT * INTO head_row', 'FOR role_row IN SELECT * FROM sales_private.crm_user_roles',
            'SELECT * INTO receipt_row', 'server_now:=clock_timestamp()'];
        const indices = order.map(position);
        expect(indices).toEqual([...indices].sort((a, b) => a - b));
        expect(publish).toContain('WHERE sales_user_id=target_id FOR UPDATE');
        expect(publish).toContain('ORDER BY user_id FOR SHARE');
    });
    it('derives current Admin and target Sales from actual ordered locked role rows', () => {
        expect(publish).toContain('target_active boolean:=false');
        expect(publish).toContain('actor_role:=NULL');
        expect(publish).toContain('WHERE user_id IN (actor_id,target_id) ORDER BY user_id FOR SHARE');
        expect(publish).toContain('IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role');
        expect(publish).toContain("IF role_row.user_id=target_id THEN target_active:=role_row.role='sales' AND role_row.is_active");
        expect(publish.match(/FROM sales_private\.crm_user_roles/g)).toHaveLength(1);
        expect(position("IF actor_role IS DISTINCT FROM 'admin'")).toBeLessThan(position('SELECT * INTO receipt_row'));
    });
    it('requires Admin authority before replay but replays before current state or target checks', () => {
        const replay = position("RETURN jsonb_build_object('calendarId',receipt_row.calendar_id");
        expect(position('actor_role:=role_row.role')).toBeLessThan(replay);
        expect(position('receipt_row.request_payload IS DISTINCT FROM p_payload')).toBeLessThan(replay);
        expect(replay).toBeLessThan(position('CRM_SCHEDULE_INACTIVE_TARGET'));
        expect(replay).toBeLessThan(position('CRM_SCHEDULE_STALE_VERSION'));
        expect(publish).toContain('WHERE published_by_user_id=actor_id AND request_id=p_request_id');
        expect(publish).toContain("'salesUserId',receipt_row.sales_user_id,'replayed',true");
    });
    it('uses CAS on the opaque head version including first-publication null semantics', () => {
        expect(publish).toContain('head_exists:=FOUND');
        expect(publish).toContain('head_exists AND head_row.current_version_id IS DISTINCT FROM expected_version');
        expect(publish).toContain('NOT head_exists AND expected_version IS NOT NULL');
        expect(publish).toContain('calendar_id_value:=CASE WHEN head_exists THEN head_row.id ELSE gen_random_uuid() END');
        expect(publish).not.toMatch(/expected_version\s*=\s*server_now|ON CONFLICT/);
    });
    it('writes all version evidence and periods in one transaction without partial-success suppression', () => {
        const order = ['INSERT INTO sales_private.crm_work_calendars', 'INSERT INTO sales_private.crm_work_calendar_versions',
            'INSERT INTO public.crm_work_periods', 'UPDATE sales_private.crm_work_calendars',
            "RETURN jsonb_build_object('calendarId',calendar_id_value"];
        const indices = order.map(position);
        expect(indices).toEqual([...indices].sort((a, b) => a - b));
        expect(afterClock).not.toMatch(/EXCEPTION WHEN|\bCOMMIT\b/);
        expect(afterClock).toContain("'version',next_version,'salesUserId',target_id,'replayed',false");
    });
});
