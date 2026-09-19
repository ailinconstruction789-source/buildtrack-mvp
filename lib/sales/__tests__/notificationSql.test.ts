// @vitest-environment node
// Static design checks only. No SQL is executed; these are NOT PostgreSQL/RLS/concurrency tests.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'sql/sales/07_notifications_draft.sql'), 'utf8');
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
const body = (name: string) => code.split(`AS $${name}$`)[1].split(`$${name}$;`)[0];
const visible = body('visible');
const snapshot = body('snapshot');
const capability = body('capabilities');
const acknowledge = body('acknowledge');
const position = (value: string) => {
    const result = acknowledge.indexOf(value);
    expect(result, value).toBeGreaterThanOrEqual(0);
    return result;
};

describe('notification draft execution safety and reuse (static only)', () => {
    it('aborts before any DDL and ends with ROLLBACK, never deployment or enablement', () => {
        expect(code.trim()).toMatch(/^BEGIN;/);
        expect(code.indexOf("RAISE EXCEPTION 'DESIGN ONLY:")).toBeLessThan(code.indexOf('ALTER TABLE'));
        expect(code.trim()).toMatch(/ROLLBACK;$/);
        expect(code).toContain('ADD COLUMN notifications_enabled boolean NOT NULL DEFAULT false');
        expect(code).not.toMatch(/\b(?:COMMIT|TRUNCATE|DROP|COPY|CALL)\b|notifications_enabled\s*=\s*true/i);
    });
    it('reuses the notification ledger without receipts, inserts, backfill or ready fabrication', () => {
        // ON DELETE RESTRICT is an FK safeguard, not a data-deletion statement.
        expect(code).not.toMatch(/CREATE TABLE|\bINSERT\b|\bDELETE\s+FROM\b|\bMERGE\b|ON CONFLICT|gen_random_uuid|lead_work_command_requests/);
        expect(code).not.toMatch(/UPDATE public\.(?!crm_notifications\b)|UPDATE sales_private\.|evaluation_snapshot\s*=|staff_due_at\s*=|notify_at\s*=/);
        expect(code.match(/UPDATE public\.crm_notifications/g)).toHaveLength(1);
    });
    it('adds nullable notice provenance only, without inferred defaults or modifying old rows', () => {
        for (const column of ['lifecycle_revision uuid', 'calendar_id uuid', 'calendar_version_id uuid',
            'staff_due_at_snapshot timestamptz', 'service_due_at_snapshot timestamptz']) {
            expect(code).toContain(`ADD COLUMN ${column}`);
            expect(code).not.toContain(`ADD COLUMN ${column} NOT NULL`);
            expect(code).not.toContain(`ADD COLUMN ${column} DEFAULT`);
        }
        expect(code).toContain('FOREIGN KEY (calendar_version_id,calendar_id)');
        expect(code).toContain('REFERENCES sales_private.crm_work_calendar_versions(id,calendar_id)');
    });
    it('does not schedule, emit, import, change policy or complete work', () => {
        expect(code).not.toMatch(/cron\.|net\.|dblink|http_|last_seen|user_metadata|app_metadata|set_config\(|status\s*=\s*'done'/);
        expect(source).toContain('30 minutes (configurable later)');
        expect(source).toContain('this inbox neither calculates nor sends it');
        expect(source).toContain('Static tests do NOT validate PostgreSQL syntax, RLS or concurrent transactions');
    });
    it('requires all five DB gates independently on capability, read and acknowledgment', () => {
        for (const section of [capability, snapshot, acknowledge]) {
            for (const gate of ['central_intake_enabled', 'lead_work_enabled', 'lead_lifecycle_enabled',
                'work_schedule_enabled', 'notifications_enabled']) expect(section).toContain(gate);
        }
        expect(capability).toContain("'contract_version','notifications_v1'");
        expect(capability).toContain("public.crm_v2_role() IN ('sales','admin','owner')");
        expect(position('CRM_NOTIFICATION_SETUP_REQUIRED')).toBeLessThan(position('SELECT t.id,t.customer_id'));
        expect(snapshot.indexOf('CRM_NOTIFICATION_SETUP_REQUIRED')).toBeLessThan(snapshot.indexOf('WITH visible'));
    });
});

describe('own-recipient access and safe projection (static only)', () => {
    it('revokes direct table access so old RLS cannot expose stale or future notices', () => {
        expect(code).toContain('REVOKE ALL ON public.crm_notifications FROM PUBLIC, anon, authenticated;');
        expect(code).not.toMatch(/GRANT (?:ALL|SELECT|UPDATE|INSERT|DELETE)|CREATE POLICY/);
        expect(code).toContain('WHERE withdrawn_at IS NULL AND task_id IS NOT NULL');
    });
    it('pins all four definer functions and keeps the parameterized helper private', () => {
        expect(code.match(/SECURITY DEFINER SET search_path = pg_catalog/g)).toHaveLength(4);
        expect(code).toContain('REVOKE ALL ON FUNCTION sales_private.crm_visible_sla_notifications(uuid,timestamptz) FROM PUBLIC, anon, authenticated;');
        expect(code).not.toContain('GRANT EXECUTE ON FUNCTION sales_private.');
        for (const signature of ['crm_v2_notifications_capabilities()', 'crm_v2_notifications_snapshot(integer)',
            'crm_v2_mark_notification_read(uuid)']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon;`);
            expect(code).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated;`);
        }
    });
    it('binds public commands to auth.uid and never accepts recipient/role impersonation inputs', () => {
        expect(code).toContain('crm_v2_notifications_snapshot(p_page integer DEFAULT 0)');
        expect(code).toContain('crm_v2_mark_notification_read(p_notification_id uuid)');
        for (const section of [snapshot, acknowledge]) {
            expect(section).toContain('actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role()');
            expect(section).toContain("actor_role NOT IN ('sales','admin','owner')");
        }
        expect(code).not.toMatch(/p_recipient|p_actor_role|p_user_id|p_payload|current_setting|request\.jwt/);
        expect(visible).toContain('n.recipient_user_id=p_actor AND t.owner_user_id=p_actor');
        expect(visible).toContain("r.user_id=p_actor AND r.role='sales' AND r.is_active");
    });
    it('projects only approved minimal fields, never stored message, contact data, HR or evaluation JSON', () => {
        const projection = visible.split('FROM public.crm_notifications')[0];
        expect(projection).not.toMatch(/SELECT \*|n\.message|phone|income|personal_data|reason|evaluation_snapshot|to_jsonb/);
        expect(snapshot).not.toMatch(/to_jsonb|row_to_json|message|phone|income|personal_data|reason|evaluation_snapshot/);
        for (const field of ['id', 'taskId', 'customerId', 'interestId', 'customerName', 'projectName', 'taskType', 'type',
            'availableAt', 'createdAt', 'readAt', 'staffDueAt', 'serviceDueAt']) expect(snapshot).toContain(`'${field}'`);
        expect(acknowledge).toContain("RETURN jsonb_build_object('notificationId',p_notification_id,'readAt',acknowledged_at)");
    });
});

describe('current, proven and deliverable SLA notices (static only)', () => {
    it('accepts only open ready SLA notices, not Voice/Checklist/escalation or withdrawn rows', () => {
        expect(visible).toContain("n.withdrawn_at IS NULL AND n.notification_type IN ('due_soon','overdue')");
        expect(visible).toContain('n.visit_id IS NULL AND n.checklist_run_id IS NULL');
        expect(visible).toContain("t.status='open' AND t.accountability_state='ready' AND t.task_type IN ('first_contact','follow_up')");
        expect(visible).not.toMatch(/voice_pending|checklist_pending|owner_missing/);
    });
    it('rejects merged/lost customers and mismatched or lost project interests', () => {
        expect(visible).toContain('i.id=t.project_interest_id AND i.customer_id=c.id');
        expect(visible).toContain("c.merged_into_customer_id IS NULL AND c.intake_status<>'lost'");
        expect(visible).toContain("t.project_interest_id IS NOT NULL AND i.id IS NOT NULL AND i.engagement_status<>'lost'");
    });
    it('binds the owner and opaque lifecycle revision separately to central or project scope', () => {
        expect(visible).toContain('t.project_interest_id IS NULL AND c.owner_user_id=p_actor AND n.lifecycle_revision=c.lifecycle_revision');
        expect(visible).toContain('i.owner_user_id=p_actor AND n.lifecycle_revision=i.lifecycle_revision');
        expect(visible).not.toMatch(/COALESCE\([^)]*owner_user_id|owner_assigned_at\s*=/);
    });
    it('requires explicit ready JSON proof with no unsafe UUID/timestamp casts or inferred defaults', () => {
        expect(visible).toContain("jsonb_typeof(t.evaluation_snapshot->'notificationBinding')='object'");
        expect(visible).toContain("t.evaluation_snapshot#>>'{notificationBinding,state}'='ready'");
        for (const [key, target] of [['ownerUserId', 'p_actor'], ['lifecycleRevision', 'n.lifecycle_revision'],
            ['calendarId', 'h.id'], ['calendarVersion', 'v.id']]) {
            expect(visible).toContain(`t.evaluation_snapshot#>>'{notificationBinding,${key}}'=${target}::text`);
        }
        expect(visible).toContain("(t.evaluation_snapshot#>>'{lifecycleReview,state}') IS DISTINCT FROM 'owner_change_pending_review'");
        expect(visible).not.toMatch(/::uuid|::timestamptz|COALESCE\(/);
    });
    it('requires the current calendar head, the correct Sales and complete version proof', () => {
        expect(visible).toContain('h.id=n.calendar_id AND h.sales_user_id=p_actor');
        expect(visible).toContain('h.current_version_id=n.calendar_version_id');
        expect(visible).toContain('v.id=n.calendar_version_id');
        expect(visible).toContain('v.calendar_id=h.id AND v.sales_user_id=p_actor');
        expect(visible).toContain('v.coverage_complete AND v.published_at<=n.created_at');
        expect(visible).not.toMatch(/calendar_version_id IS NULL|ORDER BY[^;]*published_at/);
    });
    it('binds notice deadlines to the current task instead of showing stale calculations', () => {
        expect(visible).toContain('n.staff_due_at_snapshot=t.staff_due_at AND n.service_due_at_snapshot=t.service_due_at');
        expect(visible).toContain('t.notify_at>=v.coverage_starts_at AND t.notify_at<v.coverage_ends_at');
        expect(visible).toContain('t.staff_due_at>=v.coverage_starts_at AND t.staff_due_at<=v.coverage_ends_at');
    });
    it('requires finite contract-safe timestamps and consistent availability/read order', () => {
        for (const field of ['n.available_at', 'n.created_at', 't.created_at', 't.staff_due_at', 't.service_due_at',
            't.notify_at', 'n.read_at']) expect(visible).toContain(`isfinite(${field})`);
        expect(visible).toContain("TIMESTAMPTZ '0001-01-01 00:00:00+00'");
        expect(visible).toContain("TIMESTAMPTZ '9999-12-31 23:59:59.999999+00'");
        expect(visible).toContain('n.available_at<=n.created_at AND n.created_at<=p_as_of');
        expect(visible).toContain('n.available_at>=t.notify_at AND n.created_at>=t.created_at');
        expect(visible).toContain('n.read_at>=n.created_at AND n.read_at<=p_as_of');
    });
    it('keeps exact-microsecond overdue semantics at notice creation time', () => {
        expect(visible).toContain("n.notification_type='due_soon' AND n.created_at<=t.staff_due_at");
        expect(visible).toContain("n.notification_type='overdue' AND n.created_at>t.staff_due_at");
        expect(visible).not.toMatch(/date_trunc|extract\(|AT TIME ZONE|interval /);
    });
    it('requires actual work at creation and excludes overlapping leave/break at half-open boundaries', () => {
        expect(visible).toContain('n.created_at>=v.coverage_starts_at AND n.created_at<v.coverage_ends_at');
        expect(visible).toContain("w.calendar_version_id=v.id AND w.sales_user_id=p_actor AND w.period_type='work'");
        expect(visible).toContain('w.starts_at<=n.created_at AND n.created_at<w.ends_at');
        expect(visible).toContain('AND NOT EXISTS (SELECT 1 FROM public.crm_work_periods x');
        expect(visible).toContain("x.calendar_version_id=v.id AND x.sales_user_id=p_actor AND x.period_type IN ('leave','break')");
        expect(visible).toContain('x.starts_at<=n.created_at AND n.created_at<x.ends_at');
    });
    it('does not prevent reading a previously delivered notice outside work or coverage hours', () => {
        const asOfLines = visible.split('\n').filter((line) => line.includes('p_as_of')).join('\n');
        expect(asOfLines).not.toMatch(/starts_at|ends_at|coverage_|period_type/);
        expect(visible).not.toMatch(/staff_due_at\s*[<>]=?\s*p_as_of|p_as_of\s*[<>]=?\s*.*staff_due_at/);
        expect(source).toContain('A valid already-delivered notice remains readable outside working hours');
    });
});

describe('consistent read-only inbox snapshot (static only)', () => {
    it('has bounded integer pagination and a stable materialized source for count and rows', () => {
        expect(snapshot).toContain('p_page IS NULL OR p_page<0 OR p_page>1000');
        expect(snapshot).toContain('WITH visible AS MATERIALIZED');
        expect(snapshot).toContain('sales_private.crm_visible_sla_notifications(actor_id,as_of)');
        expect(snapshot).toContain('ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET p_page*50');
        expect(snapshot).toContain('FILTER (WHERE n.rn<=50)');
        expect(snapshot).toContain('count(*)>50');
        expect(snapshot).toContain('(SELECT count(*) FROM visible WHERE read_at IS NULL)');
    });
    it('returns its own actor/page/asOf and all-current-own unread count, not current-page unread count', () => {
        for (const fragment of ["'actor',jsonb_build_object('userId',actor_id,'role',actor_role)",
            "'asOf',as_of,'page',p_page,'pageSize',50,'hasMore',has_more,'unreadCount',unread_count,'notifications',notice_json"]) {
            expect(snapshot).toContain(fragment);
        }
        expect(snapshot).toContain("'[]'::jsonb");
        expect(snapshot).not.toContain('FROM numbered WHERE read_at IS NULL');
    });
    it('does no mutation, locks or automatic acknowledgment on reading and uses UTC JSON dates', () => {
        expect(code).toContain("RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'");
        expect(snapshot).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|PERFORM|EXECUTE|CALL)\b|FOR SHARE|FOR UPDATE|pg_advisory|last_seen/);
        expect(snapshot).toContain('as_of:=clock_timestamp()');
    });
});

describe('serialized own-notice acknowledgment (static only)', () => {
    it('accepts just a notification UUID and resolves own lock targets without disclosing existence', () => {
        expect(acknowledge).toContain('p_notification_id IS NULL');
        expect(acknowledge).toContain('WHERE n.id=p_notification_id AND n.recipient_user_id=actor_id');
        expect(acknowledge).toContain("IF NOT FOUND THEN RAISE EXCEPTION 'CRM_NOTIFICATION_NOT_AVAILABLE'");
        expect(acknowledge).not.toMatch(/CRM_NOTIFICATION_NOT_FOUND|p_request_id|p_recipient|p_read_at/);
    });
    it('uses settings/scope/calendar/role/task/notice lock order compatible with earlier commands', () => {
        const order = ['FROM public.crm_settings WHERE id FOR SHARE', 'SELECT * INTO customer_row',
            'SELECT * INTO interest_row', 'SELECT * INTO head_row', 'SELECT * INTO role_row',
            'SELECT * INTO task_row', 'SELECT * INTO notice_row', 'server_now:=clock_timestamp()',
            'sales_private.crm_visible_sla_notifications(actor_id,server_now)', 'UPDATE public.crm_notifications'];
        const positions = order.map(position);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(acknowledge).toContain('WHERE id=initial_customer_id FOR SHARE');
        expect(acknowledge).toContain('WHERE id=initial_interest_id AND customer_id=initial_customer_id FOR SHARE');
        expect(acknowledge).toContain('WHERE id=initial_calendar_id AND sales_user_id=actor_id FOR SHARE');
        expect(acknowledge).toContain('WHERE id=initial_task_id FOR SHARE');
        expect(acknowledge).toContain('WHERE id=p_notification_id FOR UPDATE');
    });
    it('derives current actor authority from the actually locked role before every result', () => {
        expect(acknowledge).toContain('actor_role:=NULL');
        expect(acknowledge).toContain('FROM sales_private.crm_user_roles WHERE user_id=actor_id FOR SHARE');
        expect(acknowledge).toContain('IF FOUND AND role_row.is_active THEN actor_role:=role_row.role');
        expect(position('actor_role:=role_row.role')).toBeLessThan(position('UPDATE public.crm_notifications'));
        expect(acknowledge.match(/RETURN jsonb_build_object/g)).toHaveLength(1);
    });
    it('rechecks locked scope/task/recipient/calendar against the initial lookup', () => {
        for (const fragment of ['task_row.customer_id IS DISTINCT FROM initial_customer_id',
            'task_row.project_interest_id IS DISTINCT FROM initial_interest_id',
            'notice_row.recipient_user_id IS DISTINCT FROM actor_id',
            'notice_row.task_id IS DISTINCT FROM initial_task_id',
            'notice_row.calendar_id IS DISTINCT FROM initial_calendar_id']) expect(acknowledge).toContain(fragment);
    });
    it('revalidates exact inbox visibility after waits before a monotonic update', () => {
        expect(code).toContain("RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'");
        expect(acknowledge).toContain('IF NOT EXISTS (SELECT 1 FROM sales_private.crm_visible_sla_notifications(actor_id,server_now)');
        expect(acknowledge).toContain("WHERE id=p_notification_id) THEN RAISE EXCEPTION 'CRM_NOTIFICATION_NOT_AVAILABLE'");
        expect(acknowledge).toContain('UPDATE public.crm_notifications n SET read_at=COALESCE(n.read_at,server_now)');
        expect(acknowledge).toContain('WHERE n.id=p_notification_id AND n.recipient_user_id=actor_id RETURNING n.read_at INTO acknowledged_at');
        expect(acknowledge).not.toMatch(/read_at\s*=\s*NULL|read_at\s*=\s*server_now|EXCEPTION WHEN|\bCOMMIT\b/);
    });
    it('mutates only read_at and never receipt ownership, work status, deadlines or another recipient', () => {
        const mutation = acknowledge.split('UPDATE public.crm_notifications')[1].split(';')[0];
        expect(mutation).toBe(' n SET read_at=COALESCE(n.read_at,server_now)\n    WHERE n.id=p_notification_id AND n.recipient_user_id=actor_id RETURNING n.read_at INTO acknowledged_at');
        expect(acknowledge).not.toMatch(/SET (?:recipient_user_id|owner_user_id|status|staff_due_at|withdrawn_at)|\bINSERT\b|\bDELETE\b/);
    });
});
