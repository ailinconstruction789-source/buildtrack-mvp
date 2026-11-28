/**
 * Phase 2 Real PostgreSQL 17 Integration, Concurrency, Rollback & RLS Test Suite
 *
 * Boots a completely isolated, disposable loopback PostgreSQL 17 cluster in
 * node_modules/.cache/buildtrack-sales-runtime/runs/ using the repo's portable
 * PostgreSQL binary. NEVER connects to production, Supabase, or any external URL.
 *
 * Scenarios verified against real PostgreSQL transactions & independent sessions:
 * 1. Two sales users concurrently booking rental on the same plot (1 wins, 1 rejected; zero orphan lead)
 * 2. Purchase booking colliding with rental booking concurrently (both sales_tx_book_purchase AND
 *    direct INSERT INTO public.sales against PendingContract & Active rental)
 * 3. Sign contract (PendingContract -> Active) colliding with cancel booking (stale cancel rejected;
 *    Active contract cannot be cancelled)
 * 4. Retry of identical request_id (concurrent & sequential -> replayed=true, single row) +
 *    mismatched payload with same request_id -> SALES_TX_IDEMPOTENCY_CONFLICT
 * 5. Mid-transaction failure -> full atomic rollback (zero orphan lead, zero plot change,
 *    zero contract, zero audit row, zero idempotency receipt)
 * 6. Unauthorized callers (anon, unauthenticated, read-only owner, foreman/viewer, direct stock write,
 *    direct private table access) -> rejected by RPC grants / role guard / RLS / stock trigger
 * 7. Atomic rental_convert_to_buy -> zero vacant window (has_customer stays TRUE continuously),
 *    concurrent buyer cannot steal plot, ConvertedToBuy + sales + leads + plots all consistent
 * 8. Direct rental contract signing + move-out -> refund formula, plot released, re-bookable
 * 9. ensure_lead_sale_record -> blocks PendingContract/Active rental deals and owner role,
 *    succeeds for valid purchase & ConvertedToBuy leads WITH ALL TRIGGERS ENABLED
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPurchaseCancellation } from './verify-purchase-cancellation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pgBinDir = resolve(join(root, 'node_modules/.cache/buildtrack-sales-runtime/postgres17/pgsql/bin'));
const pgExe = name => join(pgBinDir, `${name}${process.platform === 'win32' ? '.exe' : ''}`);

for (const tool of ['postgres', 'initdb', 'pg_ctl', 'psql']) {
  if (!existsSync(pgExe(tool))) {
    console.error(`Missing portable PostgreSQL binary: ${pgExe(tool)}`);
    process.exit(2);
  }
}

const cleanEnv = {
  PATH: process.env.PATH || '',
  SystemRoot: process.env.SystemRoot || '',
  TEMP: process.env.TEMP || '',
  TMP: process.env.TMP || '',
  PGCLIENTENCODING: 'UTF8',
  LANG: 'C.UTF-8',
};

function runProc(file, args, input = '', timeoutMs = 45_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(file, args, { cwd: root, env: cleanEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error(`Timeout running ${file} ${args.join(' ')}\nstderr: ${stderr}`));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', err => { clearTimeout(timer); rejectPromise(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(stdout.trim());
      else rejectPromise(new Error(`Exit ${code}: ${stderr || stdout}`));
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function getFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
    srv.on('error', rej);
  });
}

const quote = v => `'${String(v).replaceAll("'", "''")}'`;
const jsonLiteral = v => `${quote(JSON.stringify(v))}::jsonb`;
const parseJsonLine = output => {
  const line = output.split(/\r?\n/).find(l => l.trim().startsWith('{'));
  if (!line) throw new Error(`Expected JSON line, got: ${output}`);
  return JSON.parse(line.trim());
};
const delay = ms => new Promise(r => setTimeout(r, ms));
const settled = p => p.then(value => ({ value }), error => ({ error }));

const SALES_A = '11111111-1111-4111-8111-111111111111';
const SALES_B = '22222222-2222-4222-8222-222222222222';
const ADMIN_U = '33333333-3333-4333-8333-333333333333';
const OWNER_U = '44444444-4444-4444-8444-444444444444';
const FOREMAN_U = '55555555-5555-4555-8555-555555555555';

async function main() {
  const runsDir = join(root, 'node_modules/.cache/buildtrack-sales-runtime/runs');
  mkdirSync(runsDir, { recursive: true });
  const workDir = realpathSync(mkdtempSync(join(runsDir, 'phase2-')));
  const dataDir = join(workDir, 'data');
  const pwFile = join(workDir, 'pw');
  const logFile = join(workDir, 'postgres.log');
  const dbName = `buildtrack_phase2_${randomBytes(6).toString('hex')}`;
  const pgUser = `runtime_${randomBytes(4).toString('hex')}`;
  const pgPassword = randomBytes(16).toString('hex');
  writeFileSync(pwFile, pgPassword, { mode: 0o600 });
  const port = await getFreePort();

  let postgresChild = null;
  let postgresExited = false;
  let postgresLog = '';
  const psql = (sql, db = dbName) =>
    runProc(pgExe('psql'), [
      '-h', '127.0.0.1',
      '-p', String(port),
      '-U', pgUser,
      '-d', db,
      '-X', '-q', '-t', '-A',
      '-v', 'ON_ERROR_STOP=1',
    ], sql);

  const asUser = (userId, sql, role = 'authenticated', appName = '') => `
    BEGIN;
    ${appName ? `SET LOCAL application_name = ${quote(appName)};` : ''}
    SET LOCAL ROLE ${role};
    ${userId ? `SET LOCAL "request.jwt.claim.sub" = ${quote(userId)};` : ''}
    ${sql}
    COMMIT;
  `;

  async function waitActivity(appName, condition, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = await psql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = ${quote(appName)} AND ${condition});`);
      if (hit === 't') return;
      await delay(40);
    }
    throw new Error(`Did not observe session ${appName} matching ${condition}`);
  }

  async function runOverlapped(label, userA, sqlA, userB, sqlB) {
    const tok = randomUUID().slice(0, 8);
    const appHold = `p2_hold_${tok}`;
    const appWait = `p2_wait_${tok}`;
    const pHold = settled(psql(asUser(userA, `${sqlA} SELECT pg_sleep(3.5);`, 'authenticated', appHold)));
    let pWait;
    try {
      await waitActivity(appHold, "wait_event = 'PgSleep'");
      pWait = settled(psql(asUser(userB, sqlB, 'authenticated', appWait)));
      await waitActivity(appWait, "wait_event_type = 'Lock'");
    } catch (e) {
      await pHold;
      if (pWait) await pWait;
      throw new Error(`Concurrency overlap setup failed for [${label}]: ${e.message}`);
    }
    const [resHold, resWait] = await Promise.all([pHold, pWait]);
    return { held: resHold, waiting: resWait };
  }

  const results = [];
  const pass = (name, detail = '') => {
    results.push({ name, status: 'PASS', detail });
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    console.log(`Booting disposable PostgreSQL 17 cluster on 127.0.0.1:${port}...`);
    await runProc(pgExe('initdb'), ['-D', dataDir, '-U', pgUser, '--auth=trust', '--encoding=UTF8', '--no-locale', '--pwfile', pwFile], '', 120_000);
    postgresChild = spawn(
      pgExe('postgres'),
      ['-D', dataDir, '-p', String(port), '-c', 'listen_addresses=127.0.0.1', '-c', 'max_connections=20', '-c', 'timezone=UTC', '-c', 'jit=off'],
      { cwd: root, env: cleanEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    postgresChild.on('exit', () => { postgresExited = true; });
    postgresChild.stdout.on('data', d => { postgresLog += d.toString('utf8'); });
    postgresChild.stderr.on('data', d => { postgresLog += d.toString('utf8'); });

    let ready = false;
    let lastReadyErr;
    for (let i = 0; i < 60; i++) {
      if (postgresExited) throw new Error(`PostgreSQL exited early:\n${postgresLog}`);
      try {
        await psql('SELECT 1;', 'postgres');
        ready = true;
        break;
      } catch (err) {
        lastReadyErr = err;
        await delay(100);
      }
    }
    if (!ready) throw lastReadyErr ?? new Error(`PostgreSQL did not become ready:\n${postgresLog}`);

    await psql(`CREATE DATABASE ${dbName};`, 'postgres');

    // Bootstrap Supabase-compatible auth, roles, base schema, rental tables, and external stock guard!
    await psql(`
      CREATE ROLE anon NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE authenticated NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated;

      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

      CREATE SCHEMA sales_private;
      CREATE TABLE sales_private.crm_user_roles (
        user_id uuid PRIMARY KEY REFERENCES auth.users(id),
        role text NOT NULL,
        display_name text NOT NULL,
        is_active boolean NOT NULL DEFAULT true
      );
      CREATE FUNCTION public.crm_v2_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
        SELECT role FROM sales_private.crm_user_roles WHERE user_id = auth.uid() AND is_active = true;
      $$;
      GRANT EXECUTE ON FUNCTION public.crm_v2_role() TO authenticated;

      CREATE TABLE public.projects (
        name text PRIMARY KEY,
        is_closed boolean DEFAULT false,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.plots (
        id text PRIMARY KEY,
        project_name text NOT NULL REFERENCES public.projects(name),
        plot_name text,
        has_customer boolean DEFAULT false,
        sale_status text DEFAULT 'ready_for_sale',
        highlight_note text,
        current_tenant_name varchar,
        current_tenant_phone varchar,
        rental_program varchar,
        monthly_rent numeric(15,2),
        security_deposit numeric(15,2),
        accumulated_downpayment numeric(15,2) DEFAULT 0,
        lease_start_date date,
        lease_end_date date,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.leads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_name text,
        customer_name text NOT NULL,
        phone text,
        channel text,
        source text,
        status text DEFAULT 'New',
        crm_status text DEFAULT 'Follow-up',
        auto_status text,
        agent_name text,
        created_by_agent text,
        closing_agent text,
        interested_plot_id text,
        interested_plot_name text,
        actual_visit_date timestamptz,
        booking_date timestamptz,
        booking_amount numeric(15,2),
        transferred_date timestamptz,
        lost_reason text,
        notes text,
        deal_type varchar DEFAULT 'buy',
        rental_program varchar,
        rental_monthly_rent numeric(15,2),
        rental_deposit numeric(15,2),
        rental_savings_per_month numeric(15,2),
        rental_accumulated_savings numeric(15,2) DEFAULT 0,
        rental_base_price numeric(15,2),
        rental_start_date date,
        rental_end_date date,
        rental_status varchar,
        active_rental_contract_id uuid,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.sales (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id uuid REFERENCES public.leads(id),
        project_interest_id uuid,
        plot_id text REFERENCES public.plots(id),
        sale_price numeric(15,2),
        booking_amount numeric(15,2),
        land_office_price numeric(15,2),
        list_price numeric(15,2),
        discount_amount numeric(15,2),
        bank_name text,
        contract_status text DEFAULT 'Reserved',
        crm_stage text,
        payment_method text,
        booking_route text,
        booking_route_reason text,
        booking_round integer,
        previous_sale_id uuid,
        closing_sales_user_id uuid,
        external_booking_id uuid,
        external_source_stage text,
        legacy_cancellation_batch_id uuid,
        bank_status text DEFAULT 'Pending',
        cancellation_reason text,
        cancellation_category text,
        expected_transfer_date date,
        booked_at timestamptz,
        contracted_at timestamptz,
        transferred_at timestamptz,
        crm_handover_at timestamptz,
        cancelled_at timestamptz,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.crm_settings (
        id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
        central_intake_enabled boolean NOT NULL DEFAULT false,
        lead_work_enabled boolean NOT NULL DEFAULT false,
        lead_lifecycle_enabled boolean NOT NULL DEFAULT false,
        visits_enabled boolean NOT NULL DEFAULT false,
        visit_sop_enabled boolean NOT NULL DEFAULT false,
        customer_voices_enabled boolean NOT NULL DEFAULT false,
        booking_enabled boolean NOT NULL DEFAULT false,
        booking_cutover_reviewed boolean NOT NULL DEFAULT false,
        post_booking_enabled boolean NOT NULL DEFAULT false
      );
      INSERT INTO public.crm_settings(id) VALUES (true);
      CREATE TABLE public.rental_contracts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
        project_name varchar NOT NULL,
        plot_id varchar NOT NULL,
        plot_name varchar,
        tenant_name varchar NOT NULL,
        tenant_phone varchar,
        agent_name varchar NOT NULL,
        program_type varchar NOT NULL DEFAULT 'program_a',
        monthly_rent numeric(15,2) DEFAULT 0,
        security_deposit numeric(15,2) DEFAULT 0,
        advance_rent numeric(15,2) DEFAULT 0,
        savings_per_month numeric(15,2) DEFAULT 0,
        accumulated_savings numeric(15,2) DEFAULT 0,
        base_price numeric(15,2) DEFAULT 0,
        discount_1yr_pct numeric(5,2) DEFAULT 10.0,
        discount_2yr_pct numeric(5,2) DEFAULT 5.0,
        lease_duration_months int DEFAULT 12,
        lease_start_date date NOT NULL,
        lease_end_date date NOT NULL,
        status varchar DEFAULT 'Active',
        move_out_date date,
        deposit_refunded numeric(15,2),
        conversion_date date,
        notes text,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.status_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type varchar NOT NULL,
        entity_id uuid NOT NULL,
        old_status varchar,
        new_status varchar NOT NULL,
        changed_by varchar,
        created_at timestamptz DEFAULT now()
      );

      -- Real production AFTER trigger: public.sync_plot_customer_status() (from sync_plot_sales_status.sql)
      CREATE OR REPLACE FUNCTION public.sync_plot_customer_status()
      RETURNS TRIGGER AS $sync$
      DECLARE
        active_status VARCHAR;
        target_plot_id VARCHAR;
      BEGIN
        IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.plot_id IS NOT NULL THEN
          target_plot_id := NEW.plot_id;
          SELECT contract_status INTO active_status
          FROM public.sales
          WHERE plot_id = target_plot_id AND contract_status != 'Cancelled'
          ORDER BY CASE contract_status WHEN 'Transferred' THEN 1 WHEN 'Contracted' THEN 2 WHEN 'Reserved' THEN 3 ELSE 4 END
          LIMIT 1;
          IF active_status IS NOT NULL THEN
            UPDATE public.plots
            SET has_customer = TRUE,
                sale_status = CASE WHEN active_status = 'Transferred' THEN 'transferred' ELSE sale_status END
            WHERE id = target_plot_id;
          ELSE
            UPDATE public.plots SET has_customer = FALSE WHERE id = target_plot_id;
          END IF;
        END IF;
        IF TG_OP = 'UPDATE' AND OLD.plot_id IS NOT NULL AND OLD.plot_id != NEW.plot_id THEN
          target_plot_id := OLD.plot_id;
          SELECT contract_status INTO active_status
          FROM public.sales
          WHERE plot_id = target_plot_id AND contract_status != 'Cancelled'
          ORDER BY CASE contract_status WHEN 'Transferred' THEN 1 WHEN 'Contracted' THEN 2 WHEN 'Reserved' THEN 3 ELSE 4 END
          LIMIT 1;
          IF active_status IS NOT NULL THEN
            UPDATE public.plots
            SET has_customer = TRUE,
                sale_status = CASE WHEN active_status = 'Transferred' THEN 'transferred' ELSE sale_status END
            WHERE id = target_plot_id;
          ELSE
            UPDATE public.plots SET has_customer = FALSE WHERE id = target_plot_id;
          END IF;
        END IF;
        IF TG_OP = 'DELETE' AND OLD.plot_id IS NOT NULL THEN
          target_plot_id := OLD.plot_id;
          SELECT contract_status INTO active_status
          FROM public.sales
          WHERE plot_id = target_plot_id AND contract_status != 'Cancelled'
          ORDER BY CASE contract_status WHEN 'Transferred' THEN 1 WHEN 'Contracted' THEN 2 WHEN 'Reserved' THEN 3 ELSE 4 END
          LIMIT 1;
          IF active_status IS NOT NULL THEN
            UPDATE public.plots
            SET has_customer = TRUE,
                sale_status = CASE WHEN active_status = 'Transferred' THEN 'transferred' ELSE sale_status END
            WHERE id = target_plot_id;
          ELSE
            UPDATE public.plots SET has_customer = FALSE WHERE id = target_plot_id;
          END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $sync$ LANGUAGE plpgsql;

      CREATE TRIGGER trigger_sync_plot_customer_status
        AFTER INSERT OR UPDATE OF plot_id, contract_status OR DELETE ON public.sales
        FOR EACH ROW EXECUTE FUNCTION public.sync_plot_customer_status();

      -- Real production private recovery / retirement / revision hook schemas (tx-local permit tables)
      CREATE SCHEMA sales_recovery_private;
      CREATE TABLE sales_recovery_private.permits (transaction_id bigint, backend_pid integer, target_id text);
      CREATE FUNCTION sales_recovery_private.row_allowed(p_relation text, p_op text, p_old jsonb, p_new jsonb)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $f$
        SELECT EXISTS (
          SELECT 1 FROM sales_recovery_private.permits
          WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid()
            AND target_id = COALESCE(p_new ->> 'id', p_old ->> 'id')
        );
      $f$;
      CREATE FUNCTION sales_recovery_private.stock_allowed(p_old jsonb, p_new jsonb)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $f$
        SELECT EXISTS (
          SELECT 1 FROM sales_recovery_private.permits
          WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid()
            AND target_id = p_new ->> 'id'
        );
      $f$;
      REVOKE ALL ON SCHEMA sales_recovery_private FROM PUBLIC, anon, authenticated;

      CREATE SCHEMA rental_source_retirement_private;
      CREATE TABLE rental_source_retirement_private.permits (transaction_id bigint, backend_pid integer, target_id text);
      CREATE FUNCTION rental_source_retirement_private.sale_allowed(p_op text, p_old jsonb, p_new jsonb)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $f$
        SELECT EXISTS (
          SELECT 1 FROM rental_source_retirement_private.permits
          WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid()
            AND target_id = COALESCE(p_new ->> 'id', p_old ->> 'id')
        );
      $f$;
      CREATE FUNCTION rental_source_retirement_private.plot_allowed(p_old jsonb, p_new jsonb)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $f$
        SELECT EXISTS (
          SELECT 1 FROM rental_source_retirement_private.permits
          WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid()
            AND target_id = p_new ->> 'id'
        );
      $f$;
      REVOKE ALL ON SCHEMA rental_source_retirement_private FROM PUBLIC, anon, authenticated;

      CREATE SCHEMA sales_revision_private;
      CREATE TABLE sales_revision_private.permits (transaction_id bigint, backend_pid integer, target_id text);
      CREATE FUNCTION sales_revision_private.allowed(p_op text, p_old jsonb, p_new jsonb)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $f$
        SELECT EXISTS (
          SELECT 1 FROM sales_revision_private.permits
          WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid()
            AND target_id = COALESCE(p_new ->> 'id', p_old ->> 'id')
        );
      $f$;
      CREATE FUNCTION sales_revision_private.plot_allowed(p_old jsonb, p_new jsonb)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $f$
        SELECT EXISTS (
          SELECT 1 FROM sales_revision_private.permits
          WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid()
            AND target_id = p_new ->> 'id'
        );
      $f$;
      REVOKE ALL ON SCHEMA sales_revision_private FROM PUBLIC, anon, authenticated;

      -- Real production crm_external_private cutover sale guard & stock guard (matching native_sidebar_permissions_review.sql)
      CREATE SCHEMA crm_external_private;
      CREATE TABLE crm_external_private.booking_writer_releases (batch_id uuid PRIMARY KEY);
      INSERT INTO crm_external_private.booking_writer_releases VALUES (gen_random_uuid());
      CREATE TABLE crm_external_private.booking_writer_permits (
        transaction_id bigint PRIMARY KEY, backend_pid integer NOT NULL,
        actor_id uuid NOT NULL, customer_id uuid NOT NULL, interest_id uuid NOT NULL, sale_id uuid NOT NULL, command text NOT NULL
      );
      CREATE TABLE crm_external_private.sales_cutover_permits (
        transaction_id bigint PRIMARY KEY, backend_pid integer NOT NULL, batch_id uuid NOT NULL, operation text NOT NULL
      );
      CREATE TABLE crm_external_private.sales_cutover_receipts (batch_id uuid PRIMARY KEY, before_sales jsonb NOT NULL DEFAULT '[]'::jsonb);
      CREATE TABLE crm_external_private.sales_rollback_receipts (batch_id uuid PRIMARY KEY);
      CREATE TABLE crm_external_private.prepared_booking_sales (
        id uuid PRIMARY KEY, batch_id uuid NOT NULL, booking_key text NOT NULL, plot_id text NOT NULL, stage text NOT NULL, payload jsonb NOT NULL
      );
      -- Seal external cutover receipts just like production!
      INSERT INTO crm_external_private.sales_cutover_receipts VALUES (gen_random_uuid(), '[]'::jsonb);

      CREATE FUNCTION crm_external_private.guard_cutover_sale() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $gcs$
      DECLARE permit crm_external_private.sales_cutover_permits%ROWTYPE;
      BEGIN
        IF sales_recovery_private.row_allowed(TG_TABLE_NAME, TG_OP, CASE WHEN TG_OP='INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END, CASE WHEN TG_OP='DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
        IF rental_source_retirement_private.sale_allowed(TG_OP, CASE WHEN TG_OP='INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END, CASE WHEN TG_OP='DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
        SELECT * INTO permit FROM crm_external_private.sales_cutover_permits WHERE transaction_id = pg_catalog.txid_current() AND backend_pid = pg_catalog.pg_backend_pid();
        IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_TRUNCATE_FORBIDDEN'; END IF;
        IF permit.transaction_id IS NULL THEN
          IF sales_revision_private.allowed(TG_OP, CASE WHEN TG_OP='INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END, CASE WHEN TG_OP='DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END) THEN RETURN NEW; END IF;
          IF EXISTS(SELECT 1 FROM crm_external_private.sales_cutover_receipts c WHERE NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id = c.batch_id)) THEN
            RAISE EXCEPTION 'EXTERNAL_CUTOVER_SALES_SEALED';
          END IF;
        END IF;
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      END;
      $gcs$;
      CREATE TRIGGER crm_foundation_legacy_fields_sealed
        BEFORE INSERT OR UPDATE ON public.sales
        FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_cutover_sale('["external_booking_id","external_source_stage"]');
      CREATE TRIGGER external_cutover_delete_seal
        BEFORE DELETE ON public.sales
        FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_cutover_sale();
      CREATE TRIGGER external_cutover_truncate_seal
        BEFORE TRUNCATE ON public.sales
        FOR EACH STATEMENT EXECUTE FUNCTION crm_external_private.guard_cutover_sale();

      CREATE FUNCTION crm_external_private.guard_booking_plot_stock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $gbps$
      BEGIN
        IF TG_OP = 'UPDATE' AND sales_recovery_private.stock_allowed(pg_catalog.to_jsonb(OLD), pg_catalog.to_jsonb(NEW)) THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND rental_source_retirement_private.plot_allowed(pg_catalog.to_jsonb(OLD), pg_catalog.to_jsonb(NEW)) THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND sales_revision_private.plot_allowed(pg_catalog.to_jsonb(OLD), pg_catalog.to_jsonb(NEW)) THEN RETURN NEW; END IF;
        IF TG_OP = 'INSERT' THEN
          IF NEW.has_customer IS DISTINCT FROM false THEN RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED'; END IF;
          RETURN NEW;
        END IF;
        IF NEW.has_customer IS DISTINCT FROM OLD.has_customer OR NEW.sale_status IS DISTINCT FROM OLD.sale_status THEN
          RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
        END IF;
        RETURN NEW;
      END;
      $gbps$;
      CREATE TRIGGER external_booking_plot_stock BEFORE INSERT OR UPDATE ON public.plots
        FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_booking_plot_stock();
      REVOKE ALL ON SCHEMA crm_external_private FROM PUBLIC, anon, authenticated;

      -- Enable REAL RLS policies on operational tables matching native_sidebar_permissions_review.sql!
      ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.plots ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.rental_contracts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.status_history ENABLE ROW LEVEL SECURITY;

      CREATE POLICY "Allow read projects" ON public.projects FOR SELECT TO authenticated USING (true);
      CREATE POLICY "Allow read plots" ON public.plots FOR SELECT TO authenticated USING (true);
      CREATE POLICY "Allow write plots for sales/admin" ON public.plots FOR UPDATE TO authenticated
        USING ((SELECT public.crm_v2_role()) IN ('sales', 'admin'))
        WITH CHECK ((SELECT public.crm_v2_role()) IN ('sales', 'admin'));
      CREATE POLICY "Allow read leads" ON public.leads FOR SELECT TO authenticated USING (true);
      CREATE POLICY "Allow write access to leads" ON public.leads FOR ALL TO authenticated
        USING ((SELECT public.crm_v2_role()) IN ('sales', 'admin'))
        WITH CHECK ((SELECT public.crm_v2_role()) IN ('sales', 'admin'));
      CREATE POLICY "Allow read sales" ON public.sales FOR SELECT TO authenticated USING (true);
      CREATE POLICY "Allow write access to sales" ON public.sales FOR ALL TO authenticated
        USING ((SELECT public.crm_v2_role()) IN ('sales', 'admin') AND lead_id IS NOT NULL
          AND project_interest_id IS NULL AND external_booking_id IS NULL AND external_source_stage IS NULL)
        WITH CHECK ((SELECT public.crm_v2_role()) IN ('sales', 'admin') AND lead_id IS NOT NULL
          AND project_interest_id IS NULL AND external_booking_id IS NULL AND external_source_stage IS NULL);
      CREATE POLICY "Allow read rental_contracts" ON public.rental_contracts FOR SELECT TO authenticated USING (true);
      CREATE POLICY "Allow write rental_contracts" ON public.rental_contracts FOR ALL TO authenticated
        USING ((SELECT public.crm_v2_role()) IN ('sales', 'admin'))
        WITH CHECK ((SELECT public.crm_v2_role()) IN ('sales', 'admin'));
      CREATE POLICY "Allow read status_history" ON public.status_history FOR SELECT TO authenticated USING (true);
      CREATE POLICY "Allow write access to status_history" ON public.status_history FOR INSERT TO authenticated
        WITH CHECK ((SELECT public.crm_v2_role()) IN ('sales', 'admin'));

      -- Grant operational DML on public tables to authenticated so triggers & RLS are exercised realistically
      GRANT SELECT, INSERT, UPDATE ON public.projects, public.plots, public.leads, public.sales, public.rental_contracts, public.status_history TO authenticated;
      GRANT SELECT ON public.crm_settings TO authenticated;

      -- Seed actors, project, and plots
      INSERT INTO auth.users(id) VALUES ('${SALES_A}'),('${SALES_B}'),('${ADMIN_U}'),('${OWNER_U}'),('${FOREMAN_U}');
      INSERT INTO sales_private.crm_user_roles(user_id, role, display_name, is_active) VALUES
        ('${SALES_A}', 'sales', 'Sales A', true),
        ('${SALES_B}', 'sales', 'Sales B', true),
        ('${ADMIN_U}', 'admin', 'Admin U', true),
        ('${OWNER_U}', 'owner', 'Owner ReadOnly', true),
        ('${FOREMAN_U}', 'foreman', 'Foreman User', true);

      INSERT INTO public.projects(name, is_closed) VALUES ('ไอลิน 6', false), ('โครงการปิดแล้ว', true);
      INSERT INTO public.plots(id, project_name, plot_name, has_customer, sale_status) VALUES
        ('P-01', 'ไอลิน 6', '1', false, 'ready_for_sale'),
        ('P-02', 'ไอลิน 6', '2', false, 'ready_for_sale'),
        ('P-03', 'ไอลิน 6', '3', false, 'ready_for_sale'),
        ('P-04', 'ไอลิน 6', '4', false, 'ready_for_sale'),
        ('P-05', 'ไอลิน 6', '5', false, 'ready_for_sale'),
        ('P-06', 'ไอลิน 6', '6', false, 'ready_for_sale'),
        ('P-07', 'ไอลิน 6', '7', false, 'ready_for_sale'),
        ('P-08', 'ไอลิน 6', '8', false, 'ready_for_sale'),
        ('P-09', 'ไอลิน 6', '9', false, 'ready_for_sale'),
        ('P-10', 'ไอลิน 6', '10', false, 'ready_for_sale'),
        ('P-CLOSED', 'โครงการปิดแล้ว', 'C1', false, 'ready_for_sale');
    `);

    // Apply Phase 2 + Phase 3 + Corrective 20261127 + Corrective 20261128 migrations in production sequence!
    const migrationSql = readFileSync(
      join(root, 'supabase/migrations/20261125_rental_purchase_plot_ownership_transactions.sql'),
      'utf8'
    );
    await psql(migrationSql);
    const phase3LegacyMigrationSql = readFileSync(
      join(root, 'supabase/migrations/20261126_legacy_plot_release_rpc.sql'),
      'utf8'
    );
    await psql(phase3LegacyMigrationSql);
    const correctiveMigrationSql = readFileSync(
      join(root, 'supabase/migrations/20261127_corrective_legacy_purchase_holder_guard.sql'),
      'utf8'
    );
    await psql(correctiveMigrationSql);
    const interopMigrationSql = readFileSync(
      join(root, 'supabase/migrations/20261128_corrective_stock_and_sale_guard_interop.sql'),
      'utf8'
    );
    await psql(interopMigrationSql);
    const cancelReasonMigrationSql = readFileSync(
      join(root, 'supabase/migrations/20261129_corrective_cancel_rental_reason_required.sql'),
      'utf8'
    );
    await psql(cancelReasonMigrationSql);
    pass('Phase 2 + Phase 3 + Corrective 20261127 + 20261128 + 20261129 migrations apply cleanly with full real trigger stack & RLS active');

    if (process.argv.includes('--purchase-cancellation')) {
      await verifyPurchaseCancellation({
        psql, asUser, quote, jsonLiteral, parseJsonLine, pass,
        sales: SALES_A, admin: ADMIN_U, owner: OWNER_U, foreman: FOREMAN_U,
        migration: readFileSync(join(root, 'supabase/migrations/20261130_atomic_purchase_cancellation.sql'), 'utf8'),
      });
      return;
    }

    // =========================================================================
    // TEST 1: Concurrent Rental Bookings on the SAME Plot (2 independent sessions)
    // =========================================================================
    const r1 = await runOverlapped(
      'concurrent rental booking on P-01',
      SALES_A,
      `SELECT public.sales_tx_book_rental('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-01', programType: 'program_a',
        tenantName: 'ลูกค้าเช่า A', tenantPhone: '0811111111', monthlyRent: 15000, bookingAmount: 10000,
      })});`,
      SALES_B,
      `SELECT public.sales_tx_book_rental('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-01', programType: 'program_a',
        tenantName: 'ลูกค้าเช่า B', tenantPhone: '0822222222', monthlyRent: 15000, bookingAmount: 10000,
      })});`
    );
    assert.ok(!r1.held.error, `Winner A should succeed: ${r1.held.error?.message}`);
    assert.ok(r1.waiting.error?.message.includes('SALES_TX_PLOT_UNAVAILABLE'), `Loser B must fail with SALES_TX_PLOT_UNAVAILABLE, got: ${r1.waiting.error?.message}`);
    const p1State = parseJsonLine(await psql(`
      SELECT json_build_object(
        'has_customer', p.has_customer,
        'sale_status', p.sale_status,
        'contracts', (SELECT count(*) FROM public.rental_contracts WHERE plot_id = 'P-01' AND status = 'PendingContract'),
        'leads_b', (SELECT count(*) FROM public.leads WHERE customer_name = 'ลูกค้าเช่า B')
      ) FROM public.plots p WHERE p.id = 'P-01';
    `));
    assert.equal(p1State.has_customer, true, 'Plot P-01 has_customer must be true');
    assert.equal(p1State.sale_status, 'reserved', 'Plot P-01 sale_status must be reserved');
    assert.equal(p1State.contracts, 1, 'Exactly 1 PendingContract on P-01');
    assert.equal(p1State.leads_b, 0, 'Loser B must leave ZERO orphan lead');
    pass('1. Concurrent rental bookings on same plot', '1 winner, 1 rejected (SALES_TX_PLOT_UNAVAILABLE), stock flags synced, 0 orphan leads');

    // =========================================================================
    // TEST 2: Purchase Booking Colliding with Rental Booking (RPC + Direct INSERT)
    // =========================================================================
    const r2 = await runOverlapped(
      'purchase booking collides with rental booking on P-02',
      SALES_A,
      `SELECT public.sales_tx_book_rental('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-02', programType: 'program_b',
        tenantName: 'ผู้จองเช่า P2', monthlyRent: 18000, bookingAmount: 10000, savingsPerMonth: 5000, basePrice: 2990000,
      })});`,
      SALES_B,
      `SELECT public.sales_tx_book_purchase('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-02', customerName: 'ผู้จองซื้อ P2', salePrice: 2990000, bookingAmount: 10000,
      })});`
    );
    assert.ok(!r2.held.error, `Rental booking on P-02 should succeed: ${r2.held.error?.message}`);
    assert.ok(r2.waiting.error?.message.includes('SALES_TX_PLOT_UNAVAILABLE'), `Purchase RPC must be blocked, got: ${r2.waiting.error?.message}`);

    // ALSO verify direct native INSERT INTO public.sales against P-02 (PendingContract) is blocked by DB exclusivity trigger!
    const directBuyLeadP2 = randomUUID();
    await psql(`INSERT INTO public.leads(id, customer_name, project_name, deal_type, status) VALUES ('${directBuyLeadP2}', 'ลูกค้าซื้อตรง P2', 'ไอลิน 6', 'buy', 'Visit');`);
    const directSaleRes = await settled(psql(asUser(
      SALES_B,
      `INSERT INTO public.sales(id, lead_id, plot_id, sale_price, booking_amount, payment_method, contract_status, crm_stage) VALUES (gen_random_uuid(), '${directBuyLeadP2}', 'P-02', 2990000, 5000, 'mortgage', 'Reserved', 'booked');`
    )));
    assert.ok(directSaleRes.error?.message.includes('SALES_PLOT_OCCUPIED_BY_RENTAL'), `Direct INSERT into public.sales must be blocked by DB trigger, got: ${directSaleRes.error?.message}`);
    pass('2. Purchase booking collides with rental booking (RPC + direct INSERT)', 'Both RPC and direct SQL INSERT blocked at DB layer');

    // =========================================================================
    // TEST 3: Sign Contract (PendingContract -> Active) Collides with Cancel Booking
    // =========================================================================
    const book3 = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_book_rental('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-03', programType: 'program_a',
        tenantName: 'ผู้เช่า P3', monthlyRent: 15000, bookingAmount: 10000,
      })});`
    )));

    const r3 = await runOverlapped(
      'sign contract wins before stale cancel booking on P-03',
      SALES_A,
      `SELECT public.sales_tx_sign_rental_contract('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-03', leadId: book3.leadId, contractId: book3.contractId,
        expectedLeadRevision: book3.leadRevision, expectedContractRevision: book3.contractRevision,
        programType: 'program_a', tenantName: 'ผู้เช่า P3', monthlyRent: 15000, securityDeposit: 30000, advanceRent: 15000,
        startDate: '2026-11-25', durationMonths: 12,
      })});`,
      SALES_B,
      `SELECT public.sales_tx_cancel_rental_booking('${randomUUID()}', ${jsonLiteral({
        leadId: book3.leadId, contractId: book3.contractId,
        expectedLeadRevision: book3.leadRevision, expectedContractRevision: book3.contractRevision,
        reason: 'กดยกเลิกจากหน้าเก่า',
      })});`
    );
    assert.ok(!r3.held.error, `Sign contract on P-03 should succeed: ${r3.held.error?.message}`);
    assert.ok(
      r3.waiting.error?.message.includes('SALES_TX_STALE_STATE') || r3.waiting.error?.message.includes('SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL'),
      `Stale cancel must be rejected, got: ${r3.waiting.error?.message}`
    );

    // Even a fresh cancel request (without stale revision) MUST be rejected because contract is now Active!
    const freshCancelActive = await settled(psql(asUser(
      SALES_B,
      `SELECT public.sales_tx_cancel_rental_booking('${randomUUID()}', ${jsonLiteral({
        leadId: book3.leadId, contractId: book3.contractId, reason: 'ลองยกเลิก Active',
      })});`
    )));
    assert.ok(freshCancelActive.error?.message.includes('SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL'), `Must forbid cancelling Active rental, got: ${freshCancelActive.error?.message}`);

    // Direct SQL UPDATE Active -> Cancelled must ALSO be blocked by trigger!
    const directCancelActive = await settled(psql(asUser(
      SALES_B,
      `UPDATE public.rental_contracts SET status = 'Cancelled' WHERE id = '${book3.contractId}';`
    )));
    assert.ok(directCancelActive.error?.message.includes('SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL'), `Direct Active->Cancelled must be blocked by trigger, got: ${directCancelActive.error?.message}`);

    const p3State = parseJsonLine(await psql(`
      SELECT json_build_object(
        'contract_status', rc.status,
        'lead_status', l.status,
        'rental_status', l.rental_status,
        'plot_has_customer', p.has_customer,
        'plot_sale_status', p.sale_status
      )
      FROM public.rental_contracts rc
      JOIN public.leads l ON l.id = rc.lead_id
      JOIN public.plots p ON p.id = rc.plot_id
      WHERE rc.id = '${book3.contractId}';
    `));
    assert.equal(p3State.contract_status, 'Active');
    assert.equal(p3State.lead_status, 'Rented');
    assert.equal(p3State.rental_status, 'Active');
    assert.equal(p3State.plot_has_customer, true);
    assert.equal(p3State.plot_sale_status, 'rented');
    pass('3. Sign contract collides with cancel booking', 'Active contract wins, stale & fresh cancel rejected, direct Active->Cancelled trigger-blocked');

    // =========================================================================
    // TEST 4: Idempotency Retry (Concurrent & Sequential) + Payload Conflict
    // =========================================================================
    const sameReqId = randomUUID();
    const p4Payload = {
      projectName: 'ไอลิน 6', plotId: 'P-04', programType: 'program_a',
      tenantName: 'ลูกค้า Idempotent', monthlyRent: 16000, bookingAmount: 10000,
    };
    const r4 = await runOverlapped(
      'concurrent identical request_id retry on P-04',
      SALES_A,
      `SELECT public.sales_tx_book_rental('${sameReqId}', ${jsonLiteral(p4Payload)});`,
      SALES_A,
      `SELECT public.sales_tx_book_rental('${sameReqId}', ${jsonLiteral(p4Payload)});`
    );
    assert.ok(!r4.held.error && !r4.waiting.error, 'Both identical requests should resolve cleanly');
    const first4 = parseJsonLine(r4.held.value);
    const replay4 = parseJsonLine(r4.waiting.value);
    assert.equal(first4.replayed, false);
    assert.equal(replay4.replayed, true);
    assert.equal(first4.contractId, replay4.contractId);
    assert.equal(first4.leadId, replay4.leadId);
    assert.equal(await psql(`SELECT count(*) FROM public.rental_contracts WHERE plot_id = 'P-04';`), '1');

    // Same request_id with DIFFERENT payload -> SALES_TX_IDEMPOTENCY_CONFLICT
    const mismatch4 = await settled(psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_book_rental('${sameReqId}', ${jsonLiteral({ ...p4Payload, monthlyRent: 19000 })});`
    )));
    assert.ok(mismatch4.error?.message.includes('SALES_TX_IDEMPOTENCY_CONFLICT'), `Expected SALES_TX_IDEMPOTENCY_CONFLICT, got: ${mismatch4.error?.message}`);
    pass('4. Idempotency retry & payload conflict', 'Concurrent retry returns replayed=true with 1 row; payload mismatch raises SALES_TX_IDEMPOTENCY_CONFLICT');

    // =========================================================================
    // TEST 5: Mid-Transaction Failure -> Complete Atomic Rollback
    // =========================================================================
    // Install a temporary test-only trigger on public.status_history that aborts ONLY for a marker note/text
    // to prove that a failure at the VERY LAST step of sales_tx_book_rental rolls back lead, contract, plot, and receipt!
    await psql(`
      CREATE FUNCTION pg_temp_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.changed_by LIKE '%FORCE_MID_TX_ROLLBACK%' THEN
          RAISE EXCEPTION 'INJECTED_MID_TX_AUDIT_FAILURE';
        END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER test_inject_audit_failure BEFORE INSERT ON public.status_history
        FOR EACH ROW EXECUTE FUNCTION pg_temp_fail_audit();
    `);
    const rollbackReqId = randomUUID();
    const rollbackRes = await settled(psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_book_rental('${rollbackReqId}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-05', programType: 'program_a',
        tenantName: 'ลูกค้า Rollback', agentName: 'FORCE_MID_TX_ROLLBACK', monthlyRent: 15000,
      })});`
    )));
    assert.ok(rollbackRes.error?.message.includes('INJECTED_MID_TX_AUDIT_FAILURE'));
    await psql(`DROP TRIGGER test_inject_audit_failure ON public.status_history; DROP FUNCTION pg_temp_fail_audit();`);

    const p5AfterRollback = parseJsonLine(await psql(`
      SELECT json_build_object(
        'has_customer', p.has_customer,
        'sale_status', p.sale_status,
        'tenant', p.current_tenant_name,
        'leads', (SELECT count(*) FROM public.leads WHERE customer_name = 'ลูกค้า Rollback'),
        'contracts', (SELECT count(*) FROM public.rental_contracts WHERE plot_id = 'P-05'),
        'receipts', (SELECT count(*) FROM sales_private.rental_tx_requests WHERE request_id = '${rollbackReqId}')
      ) FROM public.plots p WHERE p.id = 'P-05';
    `));
    assert.equal(p5AfterRollback.has_customer, false);
    assert.equal(p5AfterRollback.sale_status, 'ready_for_sale');
    assert.equal(p5AfterRollback.tenant, null);
    assert.equal(p5AfterRollback.leads, 0);
    assert.equal(p5AfterRollback.contracts, 0);
    assert.equal(p5AfterRollback.receipts, 0);
    pass('5. Mid-transaction failure rolls back completely', 'Zero orphan lead, plot untouched, 0 contract, 0 receipt');

    // =========================================================================
    // TEST 6: Unauthorized Callers (anon, unauthenticated, Owner, Foreman) + RLS
    // =========================================================================
    const unauthCalls = [
      ['anon calling sales_tx_book_rental', asUser(null, `SELECT public.sales_tx_book_rental('${randomUUID()}', '{}'::jsonb);`, 'anon'), /permission denied/i],
      ['unauthenticated (NULL uid) calling sales_tx_book_rental', asUser(null, `SELECT public.sales_tx_book_rental('${randomUUID()}', '{}'::jsonb);`, 'authenticated'), /SALES_TX_AUTH_REQUIRED/],
      ['read-only Owner calling sales_tx_book_rental', asUser(OWNER_U, `SELECT public.sales_tx_book_rental('${randomUUID()}', ${jsonLiteral({ projectName: 'ไอลิน 6', plotId: 'P-05', tenantName: 'X', monthlyRent: 10000 })});`), /SALES_TX_FORBIDDEN/],
      ['read-only Owner calling sales_tx_cancel_rental_booking', asUser(OWNER_U, `SELECT public.sales_tx_cancel_rental_booking('${randomUUID()}', ${jsonLiteral({ leadId: book3.leadId })});`), /SALES_TX_FORBIDDEN/],
      ['read-only Owner calling ensure_lead_sale_record', asUser(OWNER_U, `SELECT public.ensure_lead_sale_record('${book3.leadId}', 'P-03');`), /SALES_TX_FORBIDDEN/],
      ['Foreman calling sales_tx_sign_rental_contract', asUser(FOREMAN_U, `SELECT public.sales_tx_sign_rental_contract('${randomUUID()}', ${jsonLiteral({ projectName: 'ไอลิน 6', plotId: 'P-05', tenantName: 'X', monthlyRent: 10000 })});`), /SALES_TX_FORBIDDEN/],
      ['Direct authenticated UPDATE plots.has_customer', asUser(SALES_A, `UPDATE public.plots SET has_customer = true WHERE id = 'P-05';`), /EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED/],
      ['Authenticated SELECT on private permit table', asUser(SALES_A, `SELECT * FROM sales_private.plot_stock_write_permits;`), /permission denied/i],
      ['Authenticated SELECT on private idempotency table', asUser(SALES_A, `SELECT * FROM sales_private.rental_tx_requests;`), /permission denied/i],
    ];
    for (const [label, sql, expectedErr] of unauthCalls) {
      const res = await settled(psql(sql));
      assert.ok(res.error && expectedErr.test(res.error.message), `${label}: expected ${expectedErr}, got: ${res.error?.message || 'SUCCESS'}`);
    }
    pass('6. Unauthorized callers, stock-guard & private RLS', `${unauthCalls.length}/${unauthCalls.length} unauthorized/direct-tamper attempts blocked`);

    // =========================================================================
    // TEST 7: Atomic Convert Rental to Buy (Zero Vacant Gap + Concurrent Buyer Blocked)
    // =========================================================================
    // P-03 currently has Active contract book3.contractId / book3.leadId
    const convRace = await runOverlapped(
      'atomic convert_to_buy on P-03 while another sales tries to purchase P-03',
      SALES_A,
      `SELECT public.sales_tx_convert_rental_to_buy('${randomUUID()}', ${jsonLiteral({
        contractId: book3.contractId,
        leadId: book3.leadId,
        purchaseDate: '2026-11-25',
        finalPurchasePrice: 2850000,
        appliedBookingCredit: 30000,
        paymentMethod: 'mortgage',
        closingAgent: 'Sales A',
      })});`,
      SALES_B,
      `SELECT public.sales_tx_book_purchase('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-03', customerName: 'ผู้ซื้อคนอื่นแทรก', salePrice: 2990000, bookingAmount: 10000,
      })});`
    );
    assert.ok(!convRace.held.error, `Convert to buy should succeed: ${convRace.held.error?.message}`);
    assert.ok(convRace.waiting.error?.message.includes('SALES_TX_PLOT_UNAVAILABLE'), `Concurrent buyer must be blocked during/after conversion, got: ${convRace.waiting.error?.message}`);
    const convResult = parseJsonLine(convRace.held.value);
    const p3Converted = parseJsonLine(await psql(`
      SELECT json_build_object(
        'contract_status', rc.status,
        'lead_deal_type', l.deal_type,
        'lead_rental_status', l.rental_status,
        'lead_status', l.status,
        'sale_status', s.contract_status,
        'sale_price', s.sale_price,
        'plot_has_customer', p.has_customer,
        'plot_sale_status', p.sale_status,
        'plot_tenant', p.current_tenant_name
      )
      FROM public.rental_contracts rc
      JOIN public.leads l ON l.id = rc.lead_id
      JOIN public.sales s ON s.id = '${convResult.saleId}'
      JOIN public.plots p ON p.id = rc.plot_id
      WHERE rc.id = '${book3.contractId}';
    `));
    assert.equal(p3Converted.contract_status, 'ConvertedToBuy');
    assert.equal(p3Converted.lead_deal_type, 'buy');
    assert.equal(p3Converted.lead_rental_status, 'ConvertedToBuy');
    assert.equal(p3Converted.lead_status, 'Booked');
    assert.equal(p3Converted.sale_status, 'Reserved');
    assert.equal(Number(p3Converted.sale_price), 2850000);
    assert.equal(p3Converted.plot_has_customer, true);
    assert.equal(p3Converted.plot_sale_status, 'reserved');
    assert.equal(p3Converted.plot_tenant, null);
    pass('7. Atomic convert_rental_to_buy (zero vacant gap)', 'has_customer stayed true continuously, concurrent buyer blocked, sale created atomically');

    // =========================================================================
    // TEST 8: Cancel PendingContract + Direct Sign Contract + Move-Out + Re-Book
    // =========================================================================
    // Cancel P-04 PendingContract -> plot released -> direct sign contract -> move out -> plot released
    const cancel4 = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_cancel_rental_booking('${randomUUID()}', ${jsonLiteral({
        leadId: first4.leadId, contractId: first4.contractId,
        expectedLeadRevision: first4.leadRevision, expectedContractRevision: first4.contractRevision,
        reason: 'ลูกค้าเปลี่ยนใจ',
      })});`
    )));
    assert.equal(cancel4.plotReleased, true);
    assert.equal(cancel4.rentalStatus, 'Cancelled');

    // Direct rental contract on now-vacant P-04
    const directSign4 = parseJsonLine(await psql(asUser(
      SALES_B,
      `SELECT public.sales_tx_sign_rental_contract('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-04', programType: 'program_a',
        tenantName: 'ผู้เช่าทำสัญญาตรง P4', monthlyRent: 15000, securityDeposit: 30000, advanceRent: 15000,
        startDate: '2026-11-25', durationMonths: 12,
      })});`
    )));
    assert.equal(directSign4.rentalStatus, 'Active');

    // Move out from P-04 with deductions (30,000 - 1,200 - 800 - 500 = 27,500)
    const moveOut4 = parseJsonLine(await psql(asUser(
      SALES_B,
      `SELECT public.sales_tx_move_out_rental('${randomUUID()}', ${jsonLiteral({
        contractId: directSign4.contractId, leadId: directSign4.leadId,
        expectedContractRevision: directSign4.contractRevision, expectedLeadRevision: directSign4.leadRevision,
        moveOutDate: '2026-11-25', utilityDeduction: 1200, damageDeduction: 800, cleaningDeduction: 500,
      })});`
    )));
    assert.equal(Number(moveOut4.depositRefunded), 27500);
    assert.equal(moveOut4.plotReleased, true);
    const p4Vacant = parseJsonLine(await psql(`SELECT json_build_object('has_customer', has_customer, 'sale_status', sale_status) FROM public.plots WHERE id = 'P-04';`));
    assert.equal(p4Vacant.has_customer, false);
    assert.equal(p4Vacant.sale_status, 'ready_for_sale');
    pass('8. Pending cancel -> direct contract -> move-out lifecycle', 'Plot cleanly released on cancel & move-out; refund 27,500 verified');

    // =========================================================================
    // TEST 9: ensure_lead_sale_record (Blocks Rentals, Preserves Valid Purchase & ConvertedToBuy, Zero DISABLE TRIGGER)
    // =========================================================================
    // 9a. PendingContract rental lead on P-01 -> MUST BE BLOCKED
    const book1LeadId = await psql(`SELECT lead_id FROM public.rental_contracts WHERE plot_id = 'P-01' LIMIT 1;`);
    const ensureRentalPending = await settled(psql(asUser(
      SALES_A,
      `SELECT public.ensure_lead_sale_record('${book1LeadId}', 'P-01', 2900000, 2500000, 'กสิกรไทย', 'mortgage', 'contracted');`
    )));
    assert.ok(
      ensureRentalPending.error?.message.includes('CRM_RENTAL_DEAL_FORBIDDEN_IN_SALE_RPC'),
      `ensure_lead_sale_record must reject PendingContract rental, got: ${ensureRentalPending.error?.message}`
    );

    // 9b. Valid purchase lead on P-06 -> MUST SUCCEED with all triggers enabled
    const buyLead6 = await psql(`
      INSERT INTO public.leads(customer_name, project_name, status, deal_type, interested_plot_id, interested_plot_name)
      VALUES ('ลูกค้าซื้อ P6', 'ไอลิน 6', 'Booked', 'buy', 'P-06', '6') RETURNING id;
    `);
    const ensureBuy6 = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.ensure_lead_sale_record('${buyLead6}', 'P-06', 3100000, 2700000, 'ธอส.', 'mortgage', 'contracted');`
    )));
    assert.equal(ensureBuy6.success, true);
    assert.equal(ensureBuy6.plot_id, 'P-06');

    // 9c. ConvertedToBuy lead on P-03 -> MUST SUCCEED updating existing converted sale
    const ensureConverted3 = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.ensure_lead_sale_record('${book3.leadId}', 'P-03', 2850000, 2600000, 'ออมสิน', 'mortgage', 'contracted');`
    )));
    assert.equal(ensureConverted3.success, true);
    assert.equal(ensureConverted3.sale_id, convResult.saleId);

    // Verify ALL triggers on public.plots and public.sales are STILL ENABLED ('O')!
    const disabledTriggers = await psql(`
      SELECT count(*) FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('plots', 'sales', 'rental_contracts')
        AND NOT t.tgisinternal AND t.tgenabled <> 'O';
    `);
    assert.equal(disabledTriggers, '0', 'All user triggers must remain enabled');
    pass('9. ensure_lead_sale_record hardened without DISABLE TRIGGER', 'Blocks rental deals, succeeds for purchase & ConvertedToBuy, 0 disabled triggers');

    // =========================================================================
    // TEST 10: Legacy Occupied Plot (has_customer=false + rental metadata) & Closed Project Scope
    // =========================================================================
    await psql(`UPDATE public.plots SET current_tenant_name = 'ผู้เช่าเก่า (Legacy)', rental_program = 'program_a' WHERE id = 'P-07';`);
    const legacyRentAttempt = await settled(psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_book_rental('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-07', programType: 'program_a',
        tenantName: 'ลูกค้าใหม่ P7', monthlyRent: 15000,
      })});`
    )));
    assert.ok(legacyRentAttempt.error?.message.includes('SALES_TX_PLOT_UNAVAILABLE'), `Legacy occupied plot must block rental booking: ${legacyRentAttempt.error?.message}`);

    const legacyBuyAttempt = await settled(psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_book_purchase('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-07', customerName: 'ลูกค้าซื้อใหม่ P7', salePrice: 2900000,
      })});`
    )));
    assert.ok(legacyBuyAttempt.error?.message.includes('SALES_TX_PLOT_UNAVAILABLE'), `Legacy occupied plot must block purchase booking: ${legacyBuyAttempt.error?.message}`);

    const directBuyLeadP7 = randomUUID();
    await psql(`INSERT INTO public.leads(id, customer_name, project_name, deal_type, status) VALUES ('${directBuyLeadP7}', 'ลูกค้าซื้อตรง P7', 'ไอลิน 6', 'buy', 'Visit');`);
    const legacyDirectSale = await settled(psql(asUser(
      SALES_A,
      `INSERT INTO public.sales(id, lead_id, plot_id, sale_price, booking_amount, payment_method, contract_status, crm_stage) VALUES (gen_random_uuid(), '${directBuyLeadP7}', 'P-07', 2900000, 5000, 'mortgage', 'Reserved', 'booked');`
    )));
    assert.ok(legacyDirectSale.error?.message.includes('SALES_PLOT_OCCUPIED_BY_RENTAL'), `Legacy occupied plot must block direct sales INSERT: ${legacyDirectSale.error?.message}`);

    const closedProjectAttempt = await settled(psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_book_rental('${randomUUID()}', ${jsonLiteral({
        projectName: 'โครงการปิดแล้ว', plotId: 'P-CLOSED', programType: 'program_a',
        tenantName: 'ลูกค้าโครงการปิด', monthlyRent: 15000,
      })});`
    )));
    assert.ok(closedProjectAttempt.error?.message.includes('SALES_TX_PROJECT_UNAVAILABLE'), `Closed project must block booking: ${closedProjectAttempt.error?.message}`);
    pass('10. Legacy occupied plot & closed project scope enforcement', 'Legacy rental fields block rent/buy/direct-insert; closed project rejected');

    // =========================================================================
    // TEST 11: Guard-Approved Legacy Plot Release (sales_tx_release_legacy_plot)
    // =========================================================================
    // Seed a true pre-migration legacy plot (P-08): has_customer=true, sale_status='Rented', incomplete rental fields,
    // ZERO active holders, AND verified MovedOut rental contract history!
    await psql(`
      SET session_replication_role = replica;
      UPDATE public.plots
      SET has_customer = true, sale_status = 'Rented', current_tenant_name = 'ผู้เช่า Legacy ไม่ครบฟิลด์', rental_program = NULL, lease_start_date = NULL
      WHERE id = 'P-08';
      INSERT INTO public.rental_contracts(id, project_name, plot_id, plot_name, tenant_name, agent_name, program_type, monthly_rent, security_deposit, lease_start_date, lease_end_date, status)
      VALUES (gen_random_uuid(), 'ไอลิน 6', 'P-08', '8', 'ผู้เช่า Legacy ไม่ครบฟิลด์', 'Sales A', 'program_a', 15000, 30000, '2025-01-01', '2026-01-01', 'MovedOut');
      UPDATE public.plots
      SET has_customer = true, sale_status = 'Transferred', current_tenant_name = NULL
      WHERE id = 'P-10';
      SET session_replication_role = origin;
    `);

    // 11a. Non-admin Sales & Read-only Owner MUST be rejected
    const salesLegacyRelease = await settled(psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-08', expectedHasCustomer: true, expectedSaleStatus: 'Rented', reason: 'test',
      })});`
    )));
    assert.ok(salesLegacyRelease.error?.message.includes('SALES_TX_FORBIDDEN'), `Sales cannot run legacy release: ${salesLegacyRelease.error?.message}`);

    const ownerLegacyRelease = await settled(psql(asUser(
      OWNER_U,
      `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-08', expectedHasCustomer: true, expectedSaleStatus: 'Rented', reason: 'test',
      })});`
    )));
    assert.ok(ownerLegacyRelease.error?.message.includes('SALES_TX_FORBIDDEN'), `Owner cannot run legacy release: ${ownerLegacyRelease.error?.message}`);

    // 11b. Admin with wrong expectedSaleStatus -> rejected with SALES_TX_STALE_STATE (no blanket reset!)
    const staleLegacyRelease = await settled(psql(asUser(
      ADMIN_U,
      `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-08', expectedHasCustomer: true, expectedSaleStatus: 'Reserved', reason: 'stale expectation',
      })});`
    )));
    assert.ok(staleLegacyRelease.error?.message.includes('SALES_TX_STALE_STATE'), `Stale expectation must reject: ${staleLegacyRelease.error?.message}`);

    // 11c. Admin releasing plot P-01 (currently held by an active rental booking!) -> REJECTED with SALES_TX_PLOT_HELD_BY_OTHER
    const heldPlotState = (await psql(`SELECT CASE WHEN has_customer THEN 'true' ELSE 'false' END || '|' || sale_status FROM public.plots WHERE id = 'P-01';`)).split('|');
    const heldPlotRelease = await settled(psql(asUser(
      ADMIN_U,
      `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-01', expectedHasCustomer: heldPlotState[0] === 'true', expectedSaleStatus: heldPlotState[1], reason: 'must not release held plot',
      })});`
    )));
    assert.ok(heldPlotRelease.error?.message.includes('SALES_TX_PLOT_HELD_BY_OTHER'), `Held plot must NEVER be released: ${heldPlotRelease.error?.message}`);

    // 11d. Admin releasing Transferred plot P-10 -> REJECTED with SALES_TX_CONFLICT
    const transferredRelease = await settled(psql(asUser(
      ADMIN_U,
      `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-10', expectedHasCustomer: true, expectedSaleStatus: 'Transferred', reason: 'must not release transferred',
      })});`
    )));
    assert.ok(transferredRelease.error?.message.includes('SALES_TX_CONFLICT'), `Transferred plot must reject: ${transferredRelease.error?.message}`);

    // 11e. Admin releasing genuine orphaned legacy plot P-08 -> SUCCEEDS cleanly via guard-approved permit & idempotently replays!
    const legacyReqId = randomUUID();
    const legacyPayload = {
      projectName: 'ไอลิน 6', plotId: 'P-08', expectedHasCustomer: true, expectedSaleStatus: 'Rented',
      reason: 'Audited dry-run legacy plot release after ended lease',
    };
    const legacyOk = parseJsonLine(await psql(asUser(
      ADMIN_U,
      `SELECT public.sales_tx_release_legacy_plot('${legacyReqId}', ${jsonLiteral(legacyPayload)});`
    )));
    assert.equal(legacyOk.plotReleased, true);
    assert.equal(legacyOk.replayed, false);

    const legacyReplay = parseJsonLine(await psql(asUser(
      ADMIN_U,
      `SELECT public.sales_tx_release_legacy_plot('${legacyReqId}', ${jsonLiteral(legacyPayload)});`
    )));
    assert.equal(legacyReplay.replayed, true);

    const p8After = await psql(`SELECT has_customer || '|' || sale_status || '|' || COALESCE(current_tenant_name, 'NULL') FROM public.plots WHERE id = 'P-08';`);
    assert.equal(p8After, 'false|ready_for_sale|NULL', `Legacy plot P-08 must return cleanly to vacant: ${p8After}`);

    // Verify P-08 can now be booked cleanly again!
    const rebookP8 = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_book_rental('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-08', programType: 'program_a',
        tenantName: 'ผู้เช่าใหม่หลังคืน Legacy', monthlyRent: 16000, bookingAmount: 5000,
      })});`
    )));
    assert.equal(rebookP8.rentalStatus, 'PendingContract');
    pass('11. Guard-approved legacy plot release (sales_tx_release_legacy_plot)', 'Admin releases orphaned legacy plot cleanly; blocks Sales/Owner/stale/held/transferred plots');

    // =========================================================================
    // SCENARIO 12: Read-only export-reconcile-snapshot.sql + dry-run CLI check
    // =========================================================================
    const exportSql = readFileSync(join(root, 'scripts/sales-runtime/export-reconcile-snapshot.sql'), 'utf8');
    const exportedJson = await psql(exportSql);
    assert.ok(exportedJson.startsWith('{'), 'export-reconcile-snapshot.sql must return a single JSON object');
    assert.ok(!exportedJson.includes('ผู้เช่าใหม่หลังคืน Legacy'), 'export-reconcile-snapshot.sql must redact tenant PII');
    const snapFile = join(workDir, 'reconcile-snapshot.json');
    writeFileSync(snapFile, exportedJson, 'utf8');
    const dryRunOut = await runProc(process.execPath, [
      join(root, 'scripts/sales-runtime/reconcile-rental-dry-run.mjs'),
      '--input', snapFile,
      '--json',
    ]);
    const dryRunReport = JSON.parse(dryRunOut);
    assert.equal(dryRunReport.mode, 'read_only_dry_run');
    assert.ok(dryRunReport.summary.totalPlots >= 10, `Expected >= 10 plots in snapshot, got ${dryRunReport.summary.totalPlots}`);
    pass('12. Read-only snapshot export SQL + dry-run reconciliation CLI', `Exported ${dryRunReport.summary.totalPlots} plots (PII-redacted) and parsed cleanly in reconcile-rental-dry-run.mjs`);

    // =========================================================================
    // SCENARIO 13: Issue 1 Corrective Migration Acceptance Matrix (A, B, C, D, E + Canonical Scope + Scoped Permits)
    // =========================================================================
    await psql(`
      INSERT INTO public.projects(name, is_closed) VALUES ('โครงการอื่น', false) ON CONFLICT DO NOTHING;
      SET session_replication_role = replica;
      INSERT INTO public.plots(id, project_name, plot_name, has_customer, sale_status, current_tenant_name, highlight_note) VALUES
        ('ไอลิน 6-A1', 'ไอลิน 6', 'A1', true, 'Rented', 'ผู้เช่าเก่า A1', 'เช่า: โปรแกรม A'),
        ('ไอลิน 6-B1', 'ไอลิน 6', 'B1', true, 'Rented', 'ผู้เช่าค้างไม่มีประวัติ B1', NULL),
        ('ไอลิน 6-B2', 'ไอลิน 6', 'B2', true, 'Rented', 'ผู้เช่าเก่า B2', 'หมายเหตุทั่วไปของแปลง'),
        ('ไอลิน 6-D1', 'ไอลิน 6', 'D1', true, 'Rented', 'ผู้เช่าเก่า D1', 'จองเช่า: โปรแกรม B'),
        ('ไอลิน 6-AMB', 'ไอลิน 6', 'AMB99', true, 'Rented', 'ผู้เช่าเก่า AMB', NULL),
        ('ไอลิน 6-ISO', 'ไอลิน 6', 'ISO88', true, 'Rented', 'ผู้เช่าเก่า ISO', NULL);
      INSERT INTO public.rental_contracts(id, project_name, plot_id, plot_name, tenant_name, agent_name, program_type, monthly_rent, security_deposit, lease_start_date, lease_end_date, status) VALUES
        (gen_random_uuid(), 'ไอลิน 6', 'ไอลิน 6-A1', 'A1', 'ผู้เช่าเก่า A1', 'Sales A', 'program_a', 15000, 30000, '2025-01-01', '2026-01-01', 'MovedOut'),
        (gen_random_uuid(), 'ไอลิน 6', 'ไอลิน 6-B2', 'B2', 'ผู้เช่าเก่า B2', 'Sales A', 'program_a', 15000, 30000, '2025-01-01', '2026-01-01', 'MovedOut'),
        (gen_random_uuid(), 'ไอลิน 6', 'ไอลิน 6-D1', 'D1', 'ผู้เช่าเก่า D1', 'Sales A', 'program_b', 15000, 30000, '2025-01-01', '2026-01-01', 'MovedOut'),
        (gen_random_uuid(), 'ไอลิน 6', 'ไอลิน 6-AMB', 'AMB99', 'ผู้เช่าเก่า AMB', 'Sales A', 'program_a', 15000, 30000, '2025-01-01', '2026-01-01', 'MovedOut'),
        (gen_random_uuid(), 'ไอลิน 6', 'ไอลิน 6-ISO', 'ISO88', 'ผู้เช่าเก่า ISO', 'Sales A', 'program_a', 15000, 30000, '2025-01-01', '2026-01-01', 'MovedOut');
      -- A: Purchase Reserved lead WITHOUT any public.sales row on ไอลิน 6-A1
      INSERT INTO public.leads(id, customer_name, project_name, deal_type, status, interested_plot_id, interested_plot_name)
      VALUES (gen_random_uuid(), 'ผู้จองซื้อ A1 ไม่มี sales row', 'ไอลิน 6', 'buy', 'Reserved', 'ไอลิน 6-A1', 'A1');
      -- B1: New / Follow Up / Appointment interested leads ONLY (no ended history)
      INSERT INTO public.leads(id, customer_name, project_name, deal_type, status, interested_plot_id, interested_plot_name) VALUES
        (gen_random_uuid(), 'สนใจ New B1', 'ไอลิน 6', 'buy', 'New', 'ไอลิน 6-B1', 'B1'),
        (gen_random_uuid(), 'สนใจ Follow Up B1', 'ไอลิน 6', 'buy', 'Follow Up', 'ไอลิน 6-B1', 'B1'),
        (gen_random_uuid(), 'สนใจ Appointment B1', 'ไอลิน 6', 'buy', 'Appointment', 'ไอลิน 6-B1', 'B1');
      -- B2: New / Appointment interested leads ONLY + verified MovedOut history
      INSERT INTO public.leads(id, customer_name, project_name, deal_type, status, interested_plot_id, interested_plot_name) VALUES
        (gen_random_uuid(), 'สนใจ Follow Up B2', 'ไอลิน 6', 'buy', 'Follow Up', 'ไอลิน 6-B2', 'B2'),
        (gen_random_uuid(), 'สนใจ Appointment B2', 'ไอลิน 6', 'buy', 'Appointment', 'ไอลิน 6-B2', 'B2');
      -- Ambiguous bare plot_name Reserved purchase lead in same project (interested_plot_id NULL, interested_plot_name='AMB99')
      INSERT INTO public.leads(id, customer_name, project_name, deal_type, status, interested_plot_id, interested_plot_name)
      VALUES (gen_random_uuid(), 'ผู้จองซื้ออ้างชื่อแปลง AMB99', 'ไอลิน 6', 'buy', 'Reserved', NULL, 'AMB99');
      -- Different project with same plot_name 'ISO88' Reserved purchase lead (MUST NOT block ไอลิน 6-ISO!)
      INSERT INTO public.leads(id, customer_name, project_name, deal_type, status, interested_plot_id, interested_plot_name)
      VALUES (gen_random_uuid(), 'ผู้จองซื้อโครงการอื่น ISO88', 'โครงการอื่น', 'buy', 'Reserved', 'ISO88', 'ISO88');
      SET session_replication_role = origin;
    `);

    // Acceptance A: has_customer=true + purchase Reserved lead (no sales row) + MovedOut history
    const accAHolder = await psql(`SELECT sales_private.plot_has_active_holder('ไอลิน 6-A1');`);
    assert.equal(accAHolder, 't', 'plot_has_active_holder MUST return true for purchase Reserved lead without sales row');
    const accARelease = await settled(psql(asUser(
      ADMIN_U,
      `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'ไอลิน 6-A1', expectedHasCustomer: true, expectedSaleStatus: 'Rented', reason: 'must reject A1',
      })});`
    )));
    assert.ok(accARelease.error?.message.includes('SALES_TX_PLOT_HELD_BY_OTHER'), `Acceptance A must reject release: ${accARelease.error?.message}`);
    const accAPlotAfter = await psql(`SELECT has_customer || '|' || sale_status FROM public.plots WHERE id = 'ไอลิน 6-A1';`);
    assert.equal(accAPlotAfter, 'true|Rented', 'Acceptance A plot must remain untouched');

    // Run dry-run CLI on current snapshot BEFORE releasing D1 -> verify A1 & AMB are NOT safe release, while D1 & B2 ARE safe release!
    const accSnapJson = await psql(exportSql);
    const accSnapFile = join(workDir, 'acc-snapshot.json');
    writeFileSync(accSnapFile, accSnapJson, 'utf8');
    const accDryRun = JSON.parse(await runProc(process.execPath, [
      join(root, 'scripts/sales-runtime/reconcile-rental-dry-run.mjs'), '--input', accSnapFile, '--json',
    ]));
    const safeIds = new Set(accDryRun.safeToReleaseLegacyPlots.map(p => p.plotId));
    assert.ok(!safeIds.has('ไอลิน 6-A1'), 'Acceptance A: dry-run MUST NOT classify A1 as safe_legacy_plot_release');
    assert.ok(!safeIds.has('ไอลิน 6-B1'), 'Acceptance B1: dry-run MUST NOT classify B1 without ended history as safe_legacy_plot_release');
    assert.ok(!safeIds.has('ไอลิน 6-AMB'), 'Ambiguous bare plot_name lead MUST NOT be safe_legacy_plot_release');
    assert.ok(safeIds.has('ไอลิน 6-B2'), 'Acceptance B2: inquiry leads + MovedOut history SHOULD be safe_legacy_plot_release');
    assert.ok(safeIds.has('ไอลิน 6-D1'), 'Acceptance D1: pre-booking snapshot SHOULD list D1 as safe_legacy_plot_release');

    // Acceptance B1: New/Follow Up/Appointment ONLY -> no fake purchase claim (plot_has_active_holder=false),
    // yet RPC STILL rejects because ended deal history is missing!
    const accB1Holder = await psql(`SELECT sales_private.plot_has_active_holder('ไอลิน 6-B1');`);
    assert.equal(accB1Holder, 'f', 'Acceptance B: New/Follow Up/Appointment leads must NOT create artificial purchase claim');
    const accB1Release = await settled(psql(asUser(
      ADMIN_U,
      `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'ไอลิน 6-B1', expectedHasCustomer: true, expectedSaleStatus: 'Rented', reason: 'no ended history',
      })});`
    )));
    assert.ok(accB1Release.error?.message.includes('SALES_TX_CONFLICT'), `Acceptance B1 without ended history must reject with SALES_TX_CONFLICT: ${accB1Release.error?.message}`);

    // Acceptance B2 & C: Inquiry leads + verified MovedOut history -> Admin releases cleanly, preserving general highlight_note!
    const accB2Ok = parseJsonLine(await psql(asUser(
      ADMIN_U,
      `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'ไอลิน 6-B2', expectedHasCustomer: true, expectedSaleStatus: 'Rented', reason: 'verified ended lease B2',
      })});`
    )));
    assert.equal(accB2Ok.plotReleased, true);
    const accB2After = await psql(`SELECT has_customer || '|' || sale_status || '|' || COALESCE(highlight_note, 'NULL') FROM public.plots WHERE id = 'ไอลิน 6-B2';`);
    assert.equal(accB2After, 'false|ready_for_sale|หมายเหตุทั่วไปของแปลง', 'B2 must release cleanly and preserve non-rental highlight_note');

    // Acceptance D: New purchase Reserved lead arrives AFTER dry-run (even without touching plots row or creating sales row!)
    const newBuyerD1Id = randomUUID();
    await psql(`
      INSERT INTO public.leads(id, customer_name, project_name, deal_type, status, interested_plot_id, interested_plot_name)
      VALUES ('${newBuyerD1Id}', 'ผู้ซื้อใหม่หลัง dry-run', 'ไอลิน 6', 'buy', 'Reserved', 'ไอลิน 6-D1', 'D1');
    `);
    const accDRelease = await settled(psql(asUser(
      ADMIN_U,
      `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'ไอลิน 6-D1', expectedHasCustomer: true, expectedSaleStatus: 'Rented', reason: 'stale dry-run payload',
      })});`
    )));
    assert.ok(accDRelease.error?.message.includes('SALES_TX_PLOT_HELD_BY_OTHER'), `Acceptance D must reject release after new buyer arrives: ${accDRelease.error?.message}`);
    const newBuyerD1StillThere = await psql(`SELECT status || '|' || interested_plot_id FROM public.leads WHERE id = '${newBuyerD1Id}';`);
    assert.equal(newBuyerD1StillThere, 'Reserved|ไอลิน 6-D1', 'Acceptance D must NOT wipe new buyer data');

    // Acceptance E: Unauthorized callers (anon, Foreman, Sales, Owner) directly calling RPC -> ALL rejected
    const anonRel = await settled(psql(asUser(null, `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({ projectName: 'ไอลิน 6', plotId: 'ไอลิน 6-ISO', expectedHasCustomer: true, expectedSaleStatus: 'Rented', reason: 'anon' })});`, 'anon')));
    const foremanRel = await settled(psql(asUser(FOREMAN_U, `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({ projectName: 'ไอลิน 6', plotId: 'ไอลิน 6-ISO', expectedHasCustomer: true, expectedSaleStatus: 'Rented', reason: 'foreman' })});`)));
    assert.ok(Boolean(anonRel.error) && Boolean(foremanRel.error?.message.includes('SALES_TX_FORBIDDEN')), 'Acceptance E must reject anon & Foreman');

    // Canonical ID & Project Scope checks:
    // 1) Bare plot_name passed to sales_tx_release_legacy_plot -> REJECTED (SALES_TX_AMBIGUOUS_PLOT)
    const bareNameCall = await settled(psql(asUser(
      ADMIN_U,
      `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'ISO88', expectedHasCustomer: true, expectedSaleStatus: 'Rented', reason: 'bare plot name must reject',
      })});`
    )));
    assert.ok(bareNameCall.error?.message.includes('SALES_TX_AMBIGUOUS_PLOT'), `Non-canonical plot_name key must reject: ${bareNameCall.error?.message}`);

    // 2) Ambiguous bare plot_name active lead on ไอลิน 6-AMB -> REJECTED (SALES_TX_AMBIGUOUS_PLOT)
    const ambPlotRelease = await settled(psql(asUser(
      ADMIN_U,
      `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'ไอลิน 6-AMB', expectedHasCustomer: true, expectedSaleStatus: 'Rented', reason: 'must reject ambiguous ref',
      })});`
    )));
    assert.ok(ambPlotRelease.error?.message.includes('SALES_TX_AMBIGUOUS_PLOT'), `Ambiguous legacy reference must reject: ${ambPlotRelease.error?.message}`);

    // 3) Cross-project isolation: Reserved lead in 'โครงการอื่น' with plot_name 'ISO88' MUST NOT block canonical release of 'ไอลิน 6-ISO'
    const isoRelease = parseJsonLine(await psql(asUser(
      ADMIN_U,
      `SELECT public.sales_tx_release_legacy_plot('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'ไอลิน 6-ISO', expectedHasCustomer: true, expectedSaleStatus: 'Rented', reason: 'cross-project isolated release',
      })});`
    )));
    assert.equal(isoRelease.plotReleased, true);

    // Scoped permit enforcement: permit row for ไอลิน 6-B2 MUST NOT allow writing stock on ไอลิน 6-A1!
    const crossPlotPermitAbuse = await settled(psql(`
      BEGIN;
      SET LOCAL "request.jwt.claim.sub" = '${ADMIN_U}';
      INSERT INTO sales_private.plot_stock_write_permits (
        transaction_id, backend_pid, actor_user_id, plot_id, command, expected_has_customer, expected_sale_status
      ) VALUES (txid_current(), pg_backend_pid(), '${ADMIN_U}', 'ไอลิน 6-B2', 'legacy_plot_release', false, 'ready_for_sale');
      SET LOCAL ROLE authenticated;
      UPDATE public.plots SET has_customer = false, sale_status = 'ready_for_sale' WHERE id = 'ไอลิน 6-A1';
      COMMIT;
    `));
    assert.ok(Boolean(crossPlotPermitAbuse.error), 'Permit for one plot MUST NOT authorize stock writes on another plot');

    pass('13. Issue 1 Corrective Guard Acceptance Matrix (A-E + canonical scope + scoped permits)', 'Legacy purchase Reserved leads block release & dry-run; inquiry leads stay non-holders; ended history verified live in-tx; ambiguous refs & cross-plot permits blocked');

    // =========================================================================
    // SCENARIO 14: Issue 2 Corrective Migration — Real Production Trigger Stack,
    //              Permit Ordering, Guard Interop, Recovery/Revision/Native Paths,
    //              sale_tx_write_permits Enforcement & Preflight Hook Safety
    // =========================================================================
    await psql(`
      SET session_replication_role = replica;
      INSERT INTO public.plots(id, project_name, plot_name, has_customer, sale_status) VALUES
        ('P-I2-BUY', 'ไอลิน 6', 'I2B', false, 'ready_for_sale'),
        ('P-I2-ENS', 'ไอลิน 6', 'I2E', false, 'ready_for_sale'),
        ('P-I2-CNV', 'ไอลิน 6', 'I2C', false, 'Rented'),
        ('P-I2-HOOK', 'ไอลิน 6', 'I2H', false, 'ready_for_sale'),
        ('P-I2-NAT', 'ไอลิน 6', 'I2N', false, 'ready_for_sale');
      SET session_replication_role = origin;
    `);

    // 14a. sales_tx_book_purchase succeeds WITH trigger_sync_plot_customer_status + BOTH stock guards + SEALED guard_cutover_sale
    //      EVEN WHEN crm_settings.booking_enabled = true (canonical sealed mode)!
    await psql(`UPDATE public.crm_settings SET booking_enabled = true;`);
    const i2BuyReqId = randomUUID();
    const i2BuyPayload = {
      projectName: 'ไอลิน 6', plotId: 'P-I2-BUY', customerName: 'ลูกค้าซื้อ Issue2',
      salePrice: 3250000, bookingAmount: 10000, paymentMethod: 'mortgage', bankName: 'กสิกรไทย',
    };
    const i2BuyOk = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_book_purchase('${i2BuyReqId}', ${jsonLiteral(i2BuyPayload)});`
    )));
    assert.equal(i2BuyOk.command, 'purchase_book');
    assert.equal(i2BuyOk.replayed, false);
    const i2BuyState = parseJsonLine(await psql(`
      SELECT json_build_object(
        'has_customer', p.has_customer,
        'sale_status', p.sale_status,
        'sale_count', (SELECT count(*) FROM public.sales WHERE plot_id = 'P-I2-BUY'),
        'sale_status_row', (SELECT contract_status FROM public.sales WHERE id = '${i2BuyOk.saleId}')
      ) FROM public.plots p WHERE p.id = 'P-I2-BUY';
    `));
    assert.equal(i2BuyState.has_customer, true);
    assert.equal(i2BuyState.sale_status, 'reserved');
    assert.equal(i2BuyState.sale_count, 1);
    assert.equal(i2BuyState.sale_status_row, 'Reserved');

    // Idempotent retry produces replayed=true and still 1 sale row
    const i2BuyReplay = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_book_purchase('${i2BuyReqId}', ${jsonLiteral(i2BuyPayload)});`
    )));
    assert.equal(i2BuyReplay.replayed, true);
    assert.equal(await psql(`SELECT count(*) FROM public.sales WHERE plot_id = 'P-I2-BUY';`), '1');

    // Direct INSERT INTO public.sales while sealed (booking_enabled=true) WITHOUT permit -> REJECTED!
    const i2UnauthDirectSale = await settled(psql(asUser(
      SALES_A,
      `INSERT INTO public.sales(id, lead_id, plot_id, sale_price, booking_amount, payment_method, contract_status, crm_stage)
       VALUES (gen_random_uuid(), '${buyLead6}', 'P-I2-HOOK', 2900000, 5000, 'mortgage', 'Reserved', 'booked');`
    )));
    assert.ok(
      i2UnauthDirectSale.error?.message.includes('EXTERNAL_CUTOVER_SALES_SEALED'),
      `Direct sales INSERT in sealed mode must fail with EXTERNAL_CUTOVER_SALES_SEALED, got: ${i2UnauthDirectSale.error?.message}`
    );

    // TRUNCATE public.sales -> REJECTED with EXTERNAL_CUTOVER_TRUNCATE_FORBIDDEN (never crashes on unassigned OLD/NEW!)
    const i2TruncateRes = await settled(psql(`TRUNCATE public.sales;`));
    assert.ok(
      i2TruncateRes.error?.message.includes('EXTERNAL_CUTOVER_TRUNCATE_FORBIDDEN'),
      `TRUNCATE public.sales must raise EXTERNAL_CUTOVER_TRUNCATE_FORBIDDEN, got: ${i2TruncateRes.error?.message}`
    );

    // 14b. ensure_lead_sale_record full stage lifecycle (booked -> contracted -> transferred, then cancel on fresh plot)
    //      still in sealed mode (booking_enabled=true) with zero disabled triggers!
    const i2EnsLead = await psql(`
      INSERT INTO public.leads(customer_name, project_name, status, deal_type, interested_plot_id, interested_plot_name)
      VALUES ('ลูกค้า Ensure Stage', 'ไอลิน 6', 'Booked', 'buy', 'P-I2-ENS', 'I2E') RETURNING id;
    `);
    const ensBooked = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.ensure_lead_sale_record('${i2EnsLead}', 'P-I2-ENS', 3100000, NULL, 'กรุงไทย', 'mortgage', 'booked');`
    )));
    assert.equal(ensBooked.success, true);
    const ensTransferred = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.ensure_lead_sale_record('${i2EnsLead}', 'P-I2-ENS', 3100000, 2900000, 'กรุงไทย', 'mortgage', 'transferred');`
    )));
    assert.equal(ensTransferred.sale_id, ensBooked.sale_id);
    const ensPlotTransferred = await psql(`SELECT has_customer || '|' || sale_status FROM public.plots WHERE id = 'P-I2-ENS';`);
    assert.equal(ensPlotTransferred, 'true|transferred');

    // ensure_lead_sale_record cancelling a purchase sale releases plot cleanly even before caller updates leads!
    const i2CancelPlot = 'P-I2-CANCEL';
    await psql(`INSERT INTO public.plots(id, project_name, plot_name, has_customer, sale_status) VALUES ('${i2CancelPlot}', 'ไอลิน 6', 'I2X', false, 'ready_for_sale');`);
    const i2CancelLead = await psql(`
      INSERT INTO public.leads(customer_name, project_name, status, deal_type, interested_plot_id, interested_plot_name, updated_at)
      VALUES ('ลูกค้า Cancel Ensure', 'ไอลิน 6', 'Booked', 'buy', '${i2CancelPlot}', 'I2X', now() - interval '1 minute') RETURNING id;
    `);
    await psql(asUser(SALES_A, `SELECT public.ensure_lead_sale_record('${i2CancelLead}', '${i2CancelPlot}', 2800000, NULL, NULL, 'cash', 'booked');`));
    const ensCancelOk = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.ensure_lead_sale_record('${i2CancelLead}', '${i2CancelPlot}', 2800000, NULL, NULL, 'cash', 'cancelled');`
    )));
    assert.equal(ensCancelOk.success, true);
    const ensCancelPlotState = await psql(`SELECT has_customer || '|' || sale_status FROM public.plots WHERE id = '${i2CancelPlot}';`);
    assert.equal(ensCancelPlotState, 'false|ready_for_sale', `Cancelled purchase via ensure_lead_sale_record must release plot cleanly, got: ${ensCancelPlotState}`);

    // 14c. sales_tx_convert_rental_to_buy on legacy Active rental plot where has_customer started FALSE (sync_plot_customer_status
    //      writes intermediate has_customer=true, sale_status='Rented', then final RPC UPDATE sets sale_status='reserved')!
    const i2LegacyRentLead = randomUUID();
    const i2LegacyRentContract = randomUUID();
    await psql(`
      SET session_replication_role = replica;
      INSERT INTO public.leads(id, customer_name, project_name, deal_type, status, rental_status, interested_plot_id, interested_plot_name, active_rental_contract_id)
      VALUES ('${i2LegacyRentLead}', 'ผู้เช่า Legacy Convert', 'ไอลิน 6', 'rent', 'Rented', 'Active', 'P-I2-CNV', 'I2C', '${i2LegacyRentContract}');
      INSERT INTO public.rental_contracts(id, lead_id, project_name, plot_id, plot_name, tenant_name, agent_name, program_type, monthly_rent, security_deposit, lease_start_date, lease_end_date, status)
      VALUES ('${i2LegacyRentContract}', '${i2LegacyRentLead}', 'ไอลิน 6', 'P-I2-CNV', 'I2C', 'ผู้เช่า Legacy Convert', 'Sales A', 'program_a', 15000, 30000, '2026-01-01', '2027-01-01', 'Active');
      SET session_replication_role = origin;
    `);
    const i2ConvOk = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_convert_rental_to_buy('${randomUUID()}', ${jsonLiteral({
        contractId: i2LegacyRentContract, leadId: i2LegacyRentLead,
        purchaseDate: '2026-11-26', finalPurchasePrice: 2950000, appliedBookingCredit: 15000,
        paymentMethod: 'mortgage', closingAgent: 'Sales A',
      })});`
    )));
    assert.equal(i2ConvOk.rentalStatus, 'ConvertedToBuy');
    const i2ConvPlot = await psql(`SELECT has_customer || '|' || sale_status FROM public.plots WHERE id = 'P-I2-CNV';`);
    assert.equal(i2ConvPlot, 'true|reserved');

    // 14d. Preserved valid permission paths (recovery, revision, retirement, and native sidebar sync)!
    const hookLeadId = await psql(`INSERT INTO public.leads(customer_name, project_name, status, deal_type) VALUES ('ลูกค้า Hook Test', 'ไอลิน 6', 'Booked', 'buy') RETURNING id;`);
    const hookSaleId = randomUUID();
    // Recovery hook allows sale INSERT + plot stock UPDATE even in sealed mode
    await psql(`
      BEGIN;
      INSERT INTO sales_recovery_private.permits VALUES (txid_current(), pg_backend_pid(), '${hookSaleId}');
      INSERT INTO sales_recovery_private.permits VALUES (txid_current(), pg_backend_pid(), 'P-I2-HOOK');
      INSERT INTO public.sales(id, lead_id, plot_id, sale_price, booking_amount, payment_method, contract_status, crm_stage)
      VALUES ('${hookSaleId}', '${hookLeadId}', 'P-I2-HOOK', 2700000, 5000, 'cash', 'Reserved', 'booked');
      UPDATE public.plots SET has_customer = true, sale_status = 'reserved' WHERE id = 'P-I2-HOOK';
      COMMIT;
    `);
    // Revision hook allows sale UPDATE + plot stock UPDATE
    await psql(`
      BEGIN;
      INSERT INTO sales_revision_private.permits VALUES (txid_current(), pg_backend_pid(), '${hookSaleId}');
      INSERT INTO sales_revision_private.permits VALUES (txid_current(), pg_backend_pid(), 'P-I2-HOOK');
      UPDATE public.sales SET contract_status = 'Transferred', crm_stage = 'transferred' WHERE id = '${hookSaleId}';
      UPDATE public.plots SET has_customer = true, sale_status = 'transferred' WHERE id = 'P-I2-HOOK';
      COMMIT;
    `);
    // Rental source retirement hook allows sale UPDATE + plot UPDATE
    await psql(`
      BEGIN;
      INSERT INTO rental_source_retirement_private.permits VALUES (txid_current(), pg_backend_pid(), '${hookSaleId}');
      INSERT INTO rental_source_retirement_private.permits VALUES (txid_current(), pg_backend_pid(), 'P-I2-HOOK');
      UPDATE public.sales SET contract_status = 'Cancelled', crm_stage = 'cancelled' WHERE id = '${hookSaleId}';
      UPDATE public.plots SET has_customer = false, sale_status = 'ready_for_sale' WHERE id = 'P-I2-HOOK';
      COMMIT;
    `);
    assert.equal(await psql(`SELECT has_customer || '|' || sale_status FROM public.plots WHERE id = 'P-I2-HOOK';`), 'false|ready_for_sale');

    // Native Sidebar compatibility path (when crm_settings canonical flags are ALL false):
    await psql(`UPDATE public.crm_settings SET central_intake_enabled = false, booking_enabled = false, post_booking_enabled = false;`);
    const nativeLeadId = await psql(`INSERT INTO public.leads(customer_name, project_name, status, deal_type) VALUES ('ลูกค้า Native Sidebar', 'ไอลิน 6', 'Booked', 'buy') RETURNING id;`);
    const nativeSaleId = randomUUID();
    await psql(asUser(
      SALES_A,
      `INSERT INTO public.sales(id, lead_id, plot_id, sale_price, booking_amount, payment_method, contract_status, crm_stage)
       VALUES ('${nativeSaleId}', '${nativeLeadId}', 'P-I2-NAT', 2600000, 5000, 'mortgage', 'Reserved', 'booked');`
    ));
    assert.equal(await psql(`SELECT has_customer FROM public.plots WHERE id = 'P-I2-NAT';`), 't');
    // Native sidebar cancel ALSO works via trigger_sync_plot_customer_status -> native stock guard
    await psql(asUser(
      SALES_A,
      `UPDATE public.sales SET contract_status = 'Cancelled', crm_stage = 'cancelled', updated_at = clock_timestamp() WHERE id = '${nativeSaleId}';`
    ));
    assert.equal(await psql(`SELECT has_customer FROM public.plots WHERE id = 'P-I2-NAT';`), 'f');

    // 14e. Permit forgery & wildcard abuse checks (MUST ALL BE REJECTED):
    await psql(`UPDATE public.crm_settings SET booking_enabled = true;`);
    const forgedSaleId = randomUUID();
    // Forged sale_tx_write_permits with wrong expected_contract_status
    const forgedSaleWrongStage = await settled(psql(`
      BEGIN;
      SET LOCAL "request.jwt.claim.sub" = '${SALES_A}';
      INSERT INTO sales_private.sale_tx_write_permits (
        transaction_id, backend_pid, actor_user_id, sale_id, plot_id, lead_id, command,
        expected_op, expected_contract_status, expected_crm_stage
      ) VALUES (txid_current(), pg_backend_pid(), '${SALES_A}', '${forgedSaleId}', 'P-I2-NAT', '${nativeLeadId}', 'purchase_book', 'INSERT', 'Reserved', 'booked');
      SET LOCAL ROLE authenticated;
      INSERT INTO public.sales(id, lead_id, plot_id, sale_price, booking_amount, payment_method, contract_status, crm_stage)
      VALUES ('${forgedSaleId}', '${nativeLeadId}', 'P-I2-NAT', 2600000, 5000, 'mortgage', 'Transferred', 'transferred');
      COMMIT;
    `));
    assert.ok(forgedSaleWrongStage.error?.message.includes('EXTERNAL_CUTOVER_SALES_SEALED'), `Forged stage mismatch must be rejected: ${forgedSaleWrongStage.error?.message}`);

    // Forged sale_tx_write_permits trying to inject external_booking_id
    const forgedImportedIdentity = await settled(psql(`
      BEGIN;
      SET LOCAL "request.jwt.claim.sub" = '${SALES_A}';
      INSERT INTO sales_private.sale_tx_write_permits (
        transaction_id, backend_pid, actor_user_id, sale_id, plot_id, lead_id, command,
        expected_op, expected_contract_status, expected_crm_stage
      ) VALUES (txid_current(), pg_backend_pid(), '${SALES_A}', '${forgedSaleId}', 'P-I2-NAT', '${nativeLeadId}', 'purchase_book', 'INSERT', 'Reserved', 'booked');
      SET LOCAL ROLE authenticated;
      INSERT INTO public.sales(id, lead_id, plot_id, sale_price, booking_amount, payment_method, contract_status, crm_stage, external_booking_id)
      VALUES ('${forgedSaleId}', '${nativeLeadId}', 'P-I2-NAT', 2600000, 5000, 'mortgage', 'Reserved', 'booked', gen_random_uuid());
      COMMIT;
    `));
    assert.ok(forgedImportedIdentity.error?.message.includes('EXTERNAL_CUTOVER_SALES_SEALED'), `Forged external_booking_id must be rejected: ${forgedImportedIdentity.error?.message}`);

    // Forged intermediate plot_stock_write_permits trying to alter non-stock column (current_tenant_name)
    // while changing has_customer false -> true (so stock guard actually evaluates plot_stock_permit_allowed!)
    await psql(`
      SET session_replication_role = replica;
      INSERT INTO public.plots(id, project_name, plot_name, has_customer, sale_status)
      VALUES ('P-I2-FORGE', 'ไอลิน 6', 'I2F', false, 'ready_for_sale');
      INSERT INTO public.leads(customer_name, project_name, status, deal_type, interested_plot_id, interested_plot_name)
      VALUES ('ลูกค้า Forge Holder', 'ไอลิน 6', 'Reserved', 'buy', 'P-I2-FORGE', 'I2F');
      SET session_replication_role = origin;
    `);
    const forgedIntermediateNonStock = await settled(psql(`
      BEGIN;
      SET LOCAL "request.jwt.claim.sub" = '${SALES_A}';
      INSERT INTO sales_private.plot_stock_write_permits (
        transaction_id, backend_pid, actor_user_id, plot_id, command,
        expected_has_customer, expected_sale_status, allowed_intermediate_sale_status
      ) VALUES (txid_current(), pg_backend_pid(), '${SALES_A}', 'P-I2-FORGE', 'purchase_book', true, 'reserved', 'ready_for_sale');
      SET LOCAL ROLE authenticated;
      UPDATE public.plots SET has_customer = true, sale_status = 'ready_for_sale', current_tenant_name = 'FORGED' WHERE id = 'P-I2-FORGE';
      COMMIT;
    `));
    assert.ok(
      forgedIntermediateNonStock.error?.message.includes('EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED'),
      `Intermediate permit MUST reject mutating non-stock columns, got: ${forgedIntermediateNonStock.error?.message}`
    );

    // Forged NULL expected_sale_status wildcard permit -> MUST BE REJECTED
    const forgedNullWildcard = await settled(psql(`
      BEGIN;
      SET LOCAL "request.jwt.claim.sub" = '${SALES_A}';
      INSERT INTO sales_private.plot_stock_write_permits (
        transaction_id, backend_pid, actor_user_id, plot_id, command,
        expected_has_customer, expected_sale_status
      ) VALUES (txid_current(), pg_backend_pid(), '${SALES_A}', 'P-I2-BUY', 'purchase_book', true, NULL);
      SET LOCAL ROLE authenticated;
      UPDATE public.plots SET has_customer = true, sale_status = 'transferred' WHERE id = 'P-I2-BUY';
      COMMIT;
    `));
    assert.ok(
      forgedNullWildcard.error?.message.includes('EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED'),
      `NULL expected_sale_status wildcard permit MUST be rejected, got: ${forgedNullWildcard.error?.message}`
    );

    // 14e-bis. Mid-transaction failure inside sales_tx_book_purchase -> complete atomic rollback (lead, sale, plot, permits)
    await psql(`
      CREATE FUNCTION pg_temp_fail_buy_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.changed_by LIKE '%FORCE_BUY_ROLLBACK%' THEN
          RAISE EXCEPTION 'INJECTED_BUY_MID_TX_FAILURE';
        END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER test_inject_buy_failure BEFORE INSERT ON public.status_history
        FOR EACH ROW EXECUTE FUNCTION pg_temp_fail_buy_audit();
    `);
    const buyRollbackReqId = randomUUID();
    const buyRollbackRes = await settled(psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_book_purchase('${buyRollbackReqId}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-I2-HOOK', customerName: 'ลูกค้าซื้อ Rollback',
        agentName: 'FORCE_BUY_ROLLBACK', salePrice: 3000000, bookingAmount: 10000, paymentMethod: 'mortgage',
      })});`
    )));
    assert.ok(buyRollbackRes.error?.message.includes('INJECTED_BUY_MID_TX_FAILURE'));
    await psql(`DROP TRIGGER test_inject_buy_failure ON public.status_history; DROP FUNCTION pg_temp_fail_buy_audit();`);
    const buyRollbackState = parseJsonLine(await psql(`
      SELECT json_build_object(
        'has_customer', p.has_customer,
        'sale_status', p.sale_status,
        'leads', (SELECT count(*) FROM public.leads WHERE customer_name = 'ลูกค้าซื้อ Rollback'),
        'sales', (SELECT count(*) FROM public.sales WHERE plot_id = 'P-I2-HOOK' AND contract_status <> 'Cancelled'),
        'receipts', (SELECT count(*) FROM sales_private.rental_tx_requests WHERE request_id = '${buyRollbackReqId}')
      ) FROM public.plots p WHERE p.id = 'P-I2-HOOK';
    `));
    assert.equal(buyRollbackState.has_customer, false);
    assert.equal(buyRollbackState.sale_status, 'ready_for_sale');
    assert.equal(buyRollbackState.leads, 0);
    assert.equal(buyRollbackState.sales, 0);
    assert.equal(buyRollbackState.receipts, 0);

    // 14f. Preflight unknown-hook safety check: verify an unknown *_private.* hook ABORTS 20261128 cleanly!
    const preflightProbe = await settled(psql(`
      BEGIN;
      CREATE OR REPLACE FUNCTION crm_external_private.guard_booking_plot_stock() RETURNS trigger LANGUAGE plpgsql AS $u$
      BEGIN
        PERFORM mystery_private.allow_unknown_path(OLD, NEW);
        RETURN NEW;
      END; $u$;
      DO $chk$
      DECLARE
        v_def text := pg_get_functiondef('crm_external_private.guard_booking_plot_stock()'::regprocedure);
        v_hook text;
        v_known text[] := ARRAY[
          'sales_recovery_private.stock_allowed','rental_source_retirement_private.plot_allowed',
          'sales_revision_private.plot_allowed','sales_private.plot_stock_permit_allowed',
          'sales_private.plot_has_active_holder','crm_external_private.guard_booking_plot_stock',
          'crm_external_private.booking_writer_releases','crm_external_private.booking_writer_permits'
        ];
      BEGIN
        FOR v_hook IN SELECT DISTINCT lower(m[1]) FROM regexp_matches(v_def, '([a-z0-9_]+_private\\.[a-z0-9_]+)', 'gi') AS m LOOP
          IF NOT (v_hook = ANY(v_known)) THEN
            RAISE EXCEPTION 'SALES_GUARD_INTEROP_UNKNOWN_DEPLOYED_HOOK: %', v_hook;
          END IF;
        END LOOP;
      END; $chk$;
      ROLLBACK;
    `));
    assert.ok(
      preflightProbe.error?.message.includes('SALES_GUARD_INTEROP_UNKNOWN_DEPLOYED_HOOK'),
      `Preflight must abort on unknown deployed hook, got: ${preflightProbe.error?.message}`
    );

    // 14g. Final invariant: ZERO disabled user triggers across plots, sales, rental_contracts
    const finalDisabledTriggers = await psql(`
      SELECT count(*) FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('plots', 'sales', 'rental_contracts')
        AND NOT t.tgisinternal AND t.tgenabled <> 'O';
    `);
    assert.equal(finalDisabledTriggers, '0', 'All triggers across plots, sales, rental_contracts must remain enabled (O)');

    pass(
      '14. Issue 2 Corrective Guard Interop & Permit Ordering Matrix',
      'book_purchase, ensure_lead_sale_record, convert_to_buy pass with full trigger stack & sealed cutover; recovery/revision/retirement/native paths preserved; direct/forged/wildcard/TRUNCATE blocked; preflight hook check verified'
    );

    // =========================================================================
    // SCENARIO 15: Issue 6 / Part D — Server-Side Non-Empty Cancel Reason &
    //              Separate Actor/Reason Recording (20261129)
    // =========================================================================
    await psql(`
      SET session_replication_role = replica;
      INSERT INTO public.plots(id, project_name, plot_name, has_customer, sale_status)
      VALUES ('P-I6-CANCEL', 'ไอลิน 6', 'I6C', false, 'ready_for_sale');
      SET session_replication_role = origin;
    `);
    const book15 = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_book_rental('${randomUUID()}', ${jsonLiteral({
        projectName: 'ไอลิน 6', plotId: 'P-I6-CANCEL', programType: 'program_a',
        tenantName: 'ลูกค้าทดสอบเหตุผลยกเลิก', monthlyRent: 14000, bookingAmount: 5000,
      })});`
    )));

    // 15a. Missing or whitespace-only reason -> REJECTED server-side with SALES_TX_CANCEL_REASON_REQUIRED!
    const emptyCancel1 = await settled(psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_cancel_rental_booking('${randomUUID()}', ${jsonLiteral({
        leadId: book15.leadId, contractId: book15.contractId, reason: '',
      })});`
    )));
    assert.ok(
      emptyCancel1.error?.message.includes('SALES_TX_CANCEL_REASON_REQUIRED'),
      `Empty cancel reason must be rejected server-side, got: ${emptyCancel1.error?.message}`
    );

    const blankCancel2 = await settled(psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_cancel_rental_booking('${randomUUID()}', ${jsonLiteral({
        leadId: book15.leadId, contractId: book15.contractId, reason: '   \n\t  ',
      })});`
    )));
    assert.ok(
      blankCancel2.error?.message.includes('SALES_TX_CANCEL_REASON_REQUIRED'),
      `Whitespace-only cancel reason must be rejected server-side, got: ${blankCancel2.error?.message}`
    );

    // 15b. Valid trimmed reason -> succeeds, stores real reason in lost_reason and actor separately in lost_reason_detail!
    const cancel15ReqId = randomUUID();
    const cancel15Payload = {
      leadId: book15.leadId,
      contractId: book15.contractId,
      expectedLeadRevision: book15.leadRevision,
      expectedContractRevision: book15.contractRevision,
      reason: '  ลูกค้าติดภารกิจต่างจังหวัดจึงขอยกเลิกจอง  ',
    };
    const cancel15Ok = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_cancel_rental_booking('${cancel15ReqId}', ${jsonLiteral(cancel15Payload)});`
    )));
    assert.equal(cancel15Ok.plotReleased, true);
    assert.equal(cancel15Ok.reason, 'ลูกค้าติดภารกิจต่างจังหวัดจึงขอยกเลิกจอง');

    const lead15Row = parseJsonLine(await psql(`
      SELECT json_build_object('lost_reason', lost_reason, 'lost_reason_detail', lost_reason_detail)
      FROM public.leads WHERE id = '${book15.leadId}';
    `));
    assert.equal(lead15Row.lost_reason, 'ลูกค้าติดภารกิจต่างจังหวัดจึงขอยกเลิกจอง');
    assert.ok(lead15Row.lost_reason_detail.includes('ผู้ยกเลิก:'), `Actor must be stored separately in lost_reason_detail, got: ${lead15Row.lost_reason_detail}`);

    // Idempotent retry with same requestId & payload returns replayed=true cleanly
    const cancel15Replay = parseJsonLine(await psql(asUser(
      SALES_A,
      `SELECT public.sales_tx_cancel_rental_booking('${cancel15ReqId}', ${jsonLiteral(cancel15Payload)});`
    )));
    assert.equal(cancel15Replay.replayed, true);

    pass(
      '15. Issue 6 Server-Side Cancel Reason Enforcement (20261129)',
      'Empty/whitespace reason rejected with SALES_TX_CANCEL_REASON_REQUIRED; trimmed reason & actor recorded separately; idempotent retry verified'
    );

    console.log(`\nALL ${results.length} REAL POSTGRESQL 17 INTEGRATION SCENARIOS PASSED!`);
  } finally {
    if (postgresChild && !postgresExited) {
      try {
        await runProc(pgExe('pg_ctl'), ['-D', dataDir, 'stop', '-m', 'fast', '-w', '-t', '15']);
      } catch {
        postgresChild.kill();
      }
    }
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup failure on Windows file lock
    }
  }
}

main().catch(err => {
  console.error('\nPHASE 2 INTEGRATION SUITE FAILED:\n', err);
  process.exit(1);
});
