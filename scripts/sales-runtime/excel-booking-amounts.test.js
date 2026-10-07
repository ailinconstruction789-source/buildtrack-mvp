// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { assertLocalDatabaseTarget, assertPlainSql, cleanProcessEnvironment, localConnectionArgs, verifyClusterIdentity } from './safety.mjs';

const sql = readFileSync('sql/sales/excel_booking_amounts_draft.sql', 'utf8');
const body = sql.split('AS $amounts$')[1].split('$amounts$;')[0];
describe('bounded Excel booking amounts SQL contract', () => {
    it('is a guarded draft adding exactly two functions without modifying existing schema or tables', () => {
        expect(sql).toContain("RAISE EXCEPTION 'DESIGN ONLY: Excel booking amounts");
        expect(sql.trim()).toMatch(/ROLLBACK;$/);
        expect(sql.match(/CREATE FUNCTION/g)).toHaveLength(2);
        expect(sql).not.toMatch(/CREATE OR REPLACE|CREATE TABLE|CREATE SCHEMA|ALTER TABLE|DROP |TRUNCATE /i);
        expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|EXECUTE|LOCK)\b/i);
    });
    it('has private stable definer and public stable invoker, both restricted to authenticated guarded staff', () => {
        for (const term of ['auth.uid()', 'public.crm_v2_role()', "COALESCE(actor_role,'') NOT IN ('sales','admin','owner')",
            'public.crm_v2_project_sales_capabilities()', 'crm_external_private.booking_writer_ready()',
            'STABLE SECURITY DEFINER', 'SET search_path=pg_catalog', 'STABLE SECURITY INVOKER',
            'FROM PUBLIC,anon', 'TO authenticated']) expect(sql).toContain(term);
        expect(sql).not.toMatch(/GRANT .* ON (?:TABLE|ALL TABLES|SCHEMA)/);
    });
    it('reads N only from exact released source provenance, all booking stages and bounded rows', () => {
        for (const term of ["s.payload->'rawValues'->13", "s.disposition='mapped_for_review'",
            's.source_row BETWEEN 2 AND 966', 'b.plan_digest=w.plan_digest', 'sales_rollback_receipts',
            'c.merged_into_customer_id IS NULL', 'item.prepared_interest IS DISTINCT FROM item.interest_id::text',
            'item.prepared_customer IS DISTINCT FROM item.customer_id::text', 'CRM_EXCEL_BOOKING_AMOUNTS_LIMIT',
            "'saleId',item.id,'tdPrice',td_price"]) expect(body).toContain(term);
        expect(body).not.toContain('sale.crm_stage');
        expect(body).not.toMatch(/phone|income|customer_name|RAISE (?:NOTICE|LOG)/i);
        expect(body).toContain('LIMIT 10001');
    });
    it('preserves unknown and rejects formula caches or malformed values without rounding', () => {
        expect(body).toContain('td_price:=NULL');
        expect(body).toContain('PRIMARY_INPUT_FORMULA_REVIEW');
        expect(body).toContain("'^[0-9]{1,13}(\\.[0-9]{1,2})?$'");
        expect(body).not.toMatch(/round\(|::numeric\(/i);
    });
});

// Opt-in isolated PostgreSQL only. No existing cluster, database URL, secrets,
// dotenv, real customers or remote fallback. All test mutations are synthetic.
describe.skipIf(process.env.BUILDTRACK_EXCEL_AMOUNTS_NATIVE_TEST !== '1')('Excel amounts native PostgreSQL', () => {
    it('verifies read-only guards, ACL, strict N amounts and source integrity', async () => {
        const root = resolve('.');
        const bin = join(root, 'node_modules/.cache/buildtrack-sales-runtime/postgres17/pgsql/bin');
        const executable = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
        for (const name of ['initdb', 'postgres', 'pg_ctl', 'psql']) expect(existsSync(executable(name))).toBe(true);
        const cache = join(root, 'node_modules/.cache/buildtrack-sales-runtime/runs');
        mkdirSync(cache, { recursive: true });
        const directory = realpathSync(mkdtempSync(join(cache, 'excel-amounts-')));
        const data = join(directory, 'data'), nonce = randomBytes(12).toString('hex');
        const user = `runtime_${nonce}`, database = `buildtrack_sales_runtime_${nonce}`;
        const password = randomBytes(32).toString('hex'), passwordFile = join(directory, 'init-password');
        const environment = cleanProcessEnvironment(process.env);
        const report = { mode: 'excel-amounts-minimal-synthetic', directory, status: 'running', stopped: false, cases: [] };
        const command = (file, args, input = '', env = environment) => new Promise((accept, reject) => {
            const child = spawn(file, args, { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
            let out = '', error = '', timedOut = false;
            const timer = setTimeout(() => { timedOut = true; child.kill(); }, 45000);
            child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
            child.stdout.on('data', value => { out += value; }); child.stderr.on('data', value => { error += value; });
            child.stdin.on('error', () => {});
            child.on('error', e => { clearTimeout(timer); reject(e); });
            child.on('close', code => { clearTimeout(timer); code === 0 && !timedOut ? accept(out.trim()) : reject(new Error(`${code}: ${error}\n${out}`)); });
            child.stdin.end(input);
        });
        let postgres, port, verified = false, exited = false;
        const query = async (source, target = database) => {
            assertLocalDatabaseTarget(target, database); assertPlainSql(source);
            if (!verified && !source.startsWith('SELECT json_build_object(')) throw new Error('Identity not verified');
            const args = localConnectionArgs(port, database, user); args[args.indexOf('-d') + 1] = target;
            return command(executable('psql'), args, source, { ...environment, PGPASSWORD: password, PGCLIENTENCODING: 'UTF8',
                PGOPTIONS: '-c buildtrack.synthetic_runtime=on -c standard_conforming_strings=on -c statement_timeout=20000' });
        };
        const identity = async target => {
            const actual = JSON.parse(await query("SELECT json_build_object('address',host(inet_server_addr()),'port',inet_server_port(),'user',current_user,'database',current_database(),'data',current_setting('data_directory'),'listen',current_setting('listen_addresses'),'marker',current_setting('buildtrack.synthetic_runtime',true));", target));
            verifyClusterIdentity(actual, { port, user, database: target, data }); verified = true;
        };
        const batch = '11111111-1111-4111-8111-111111111111', customer = '22222222-2222-4222-8222-222222222222';
        const interest = '33333333-3333-4333-8333-333333333333', sale = '44444444-4444-4444-8444-444444444444';
        const actor = '66666666-6666-4666-8666-666666666666';
        const request = (role = 'sales', project = 'P', changes = '') => `BEGIN; ${changes}
          SET LOCAL ROLE authenticated; SET LOCAL test.actor='${actor}'; SET LOCAL test.crm_role='${role}';
          SELECT public.crm_v2_excel_booking_amounts('${project}'); ROLLBACK;`;
        const pass = label => report.cases.push(label);
        const setCell = value => `UPDATE crm_external_private.source_records SET payload=jsonb_set(payload,'{rawValues,13}','${JSON.stringify(value)}'::jsonb);`;
        try {
            writeFileSync(passwordFile, password, { mode: 0o600, flag: 'wx' });
            await command(executable('initdb'), ['-D', data, '-U', user, '--pwfile', passwordFile, '-A', 'scram-sha-256', '--encoding=UTF8', '--no-locale']);
            unlinkSync(passwordFile);
            const server = createServer();
            await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
            port = server.address().port; await new Promise(ok => server.close(ok));
            postgres = spawn(executable('postgres'), ['-D', data, '-p', String(port), '-c', 'listen_addresses=127.0.0.1',
                '-c', 'shared_buffers=16MB', '-c', 'max_connections=10'], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            postgres.stdout.resume(); postgres.stderr.resume(); postgres.on('exit', () => { exited = true; });
            let ready = false;
            for (let attempt = 0; attempt < 60 && !exited; attempt++) {
                try { await identity('postgres'); ready = true; break; } catch { await new Promise(ok => setTimeout(ok, 100)); }
            }
            if (!ready) throw new Error('Fresh synthetic PostgreSQL did not become ready');
            await query(`CREATE DATABASE ${database};`, 'postgres'); await identity(database);
            await query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA crm_external_private;
              CREATE SCHEMA crm_excel_private; REVOKE ALL ON SCHEMA crm_excel_private FROM PUBLIC,anon;
              GRANT USAGE ON SCHEMA crm_excel_private TO authenticated;
              CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
              CREATE FUNCTION public.crm_v2_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('test.crm_role',true) $$;
              CREATE FUNCTION public.crm_v2_project_sales_capabilities() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('enabled',coalesce(current_setting('test.enabled',true),'true')='true') $$;
              CREATE FUNCTION crm_external_private.booking_writer_ready() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.ready',true),'true')='true' $$;
              CREATE TABLE public.projects(name text PRIMARY KEY);
              CREATE TABLE public.sales_customers(id uuid PRIMARY KEY,external_snapshot_batch_id uuid,external_customer_key text,merged_into_customer_id uuid);
              CREATE TABLE public.lead_project_interests(id uuid PRIMARY KEY,customer_id uuid,project_name text);
              CREATE TABLE public.sales(id uuid PRIMARY KEY,project_interest_id uuid,external_booking_id uuid,crm_stage text);
              CREATE TABLE crm_external_private.snapshot_batches(id uuid PRIMARY KEY,plan_digest text,feed text);
              CREATE TABLE crm_external_private.booking_writer_releases(batch_id uuid PRIMARY KEY,plan_digest text);
              CREATE TABLE crm_external_private.sales_rollback_receipts(batch_id uuid PRIMARY KEY);
              CREATE TABLE crm_external_private.source_records(batch_id uuid,source_row integer,customer_key text,disposition text,payload jsonb,PRIMARY KEY(batch_id,source_row));
              CREATE TABLE crm_external_private.prepared_booking_sales(id uuid PRIMARY KEY,batch_id uuid,payload jsonb);
              INSERT INTO public.projects VALUES('P'),('OTHER');
              INSERT INTO crm_external_private.snapshot_batches VALUES('${batch}','digest','customer-sheet');
              INSERT INTO crm_external_private.booking_writer_releases VALUES('${batch}','digest');
              INSERT INTO public.sales_customers VALUES('${customer}','${batch}','customer',NULL);
              INSERT INTO public.lead_project_interests VALUES('${interest}','${customer}','P');
              INSERT INTO crm_external_private.source_records VALUES('${batch}',2,'customer','mapped_for_review',
                '{"rawValues":[null,null,null,null,null,null,null,null,null,null,null,null,null,2500000.12],"sourceIssues":[]}');
              INSERT INTO crm_external_private.prepared_booking_sales VALUES('${sale}','${batch}',
                '{"source_row":2,"customer_id":"${customer}","interest_id":"${interest}","project_name":"P"}');
              INSERT INTO public.sales VALUES('${sale}','${interest}','${sale}','booked');
              REVOKE ALL ON ALL TABLES IN SCHEMA public,crm_external_private FROM PUBLIC,anon,authenticated;
              REVOKE ALL ON SCHEMA crm_external_private FROM PUBLIC,anon,authenticated;`);
            await expect(query(sql)).rejects.toThrow('DESIGN ONLY: Excel booking amounts');
            const wrapper = /BEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: Excel booking amounts require isolated verification and deployment review';\s*END;\s*\$draft_only\$;/;
            expect(sql.match(wrapper)).not.toBeNull();
            await query(sql.replace(wrapper, 'BEGIN;').replace(/ROLLBACK;\s*$/, 'COMMIT;'));
            const baseline = JSON.parse(await query(request()));
            expect(baseline).toEqual({ contractVersion: 'excel_booking_amounts_v1', projectName: 'P',
                actor: { userId: actor, role: 'sales' }, rows: [{ saleId: sale, tdPrice: 2500000.12 }] });
            pass('draft guard and minimal bounded projection');
            for (const role of ['sales','admin','owner']) expect(JSON.parse(await query(request(role))).actor.role).toBe(role);
            for (const role of ['foreman','', 'Sales']) await expect(query(request(role))).rejects.toThrow('CRM_EXCEL_BOOKING_AMOUNTS_FORBIDDEN');
            await expect(query("SET ROLE anon; SELECT public.crm_v2_excel_booking_amounts('P');")).rejects.toThrow('permission denied');
            await expect(query("SET ROLE authenticated; SELECT public.crm_v2_excel_booking_amounts('P');")).rejects.toThrow('CRM_EXCEL_BOOKING_AMOUNTS_FORBIDDEN');
            for (const flag of ['enabled','ready']) await expect(query(request('sales','P',`SET LOCAL test.${flag}='false';`))).rejects.toThrow('CRM_EXCEL_BOOKING_AMOUNTS_SETUP_REQUIRED');
            await expect(query(request('sales','MISSING'))).rejects.toThrow('CRM_EXCEL_BOOKING_AMOUNTS_NOT_FOUND');
            for (const input of ['', ' '.repeat(2), 'x'.repeat(201), 'P\n']) await expect(query(request('sales',input))).rejects.toThrow('CRM_EXCEL_BOOKING_AMOUNTS_INVALID_INPUT');
            expect(JSON.parse(await query(request('sales','OTHER'))).rows).toEqual([]);
            pass('trusted staff only, identity capability and exact project guards');
            for (const stage of ['booked','cancelled','transferred','handover','loan_rejected']) {
                expect(JSON.parse(await query(request('sales','P',`UPDATE public.sales SET crm_stage='${stage}';`))).rows).toEqual(baseline.rows);
            }
            const repeated = JSON.parse(await query(request('sales','P',`INSERT INTO public.sales VALUES('${actor}','${interest}',NULL,'booked');`)));
            expect(repeated.rows).toHaveLength(2); expect(repeated.rows.find(r => r.saleId === actor).tdPrice).toBeNull();
            pass('cancelled and completed rounds retained; new bookings unknown without source evidence');
            for (const valid of [0, 2.5, '0', ' 123.40 ', '9999999999999.99']) {
                expect(JSON.parse(await query(request('sales','P',setCell(valid)))).rows[0].tdPrice).toBe(Number(valid));
            }
            for (const invalid of [null, '', ' ', '-1', -1, 'NaN', 'Infinity', '1e3', '+20', '1,000', '12.345', 12.345,
                '10000000000000', '1.', '.5', '=100', true, {}, []]) {
                expect(JSON.parse(await query(request('sales','P',setCell(invalid)))).rows[0].tdPrice).toBeNull();
            }
            for (const change of ["payload=payload-'rawValues'", "payload=payload-'sourceIssues'",
                "payload=jsonb_set(payload,'{sourceIssues}','[\"PRIMARY_INPUT_FORMULA_REVIEW\"]')",
                "payload=jsonb_set(payload,'{sourceIssues}','{}')"]) {
                expect(JSON.parse(await query(request('sales','P',`UPDATE crm_external_private.source_records SET ${change};`))).rows[0].tdPrice).toBeNull();
            }
            pass('explicit zero preserved; missing malformed formula negative nonfinite overprecision stay unknown');
            const invalidProvenance = [
                `INSERT INTO crm_external_private.sales_rollback_receipts VALUES('${batch}');`,
                "UPDATE crm_external_private.booking_writer_releases SET plan_digest='wrong';",
                "UPDATE crm_external_private.snapshot_batches SET feed='other';",
                "DELETE FROM crm_external_private.booking_writer_releases;",
                "DELETE FROM crm_external_private.prepared_booking_sales;",
                "UPDATE crm_external_private.source_records SET customer_key='other';",
                "UPDATE crm_external_private.source_records SET disposition='admin_review';",
                "UPDATE crm_external_private.source_records SET source_row=967; UPDATE crm_external_private.prepared_booking_sales SET payload=jsonb_set(payload,'{source_row}','967');",
                ...['project_name','interest_id','customer_id','source_row'].map(key => `UPDATE crm_external_private.prepared_booking_sales SET payload=jsonb_set(payload,'{${key}}','\"wrong\"');`),
            ];
            for (const change of invalidProvenance) await expect(query(request('sales','P',change))).rejects.toThrow('CRM_EXCEL_BOOKING_AMOUNTS_INTEGRITY_REQUIRED');
            const merged = JSON.parse(await query(request('sales','P',`UPDATE public.sales_customers SET merged_into_customer_id='${actor}';`)));
            expect(merged.rows).toEqual([]);
            const boundary = JSON.parse(await query(request('sales','P',"UPDATE crm_external_private.source_records SET source_row=966; UPDATE crm_external_private.prepared_booking_sales SET payload=jsonb_set(payload,'{source_row}','966');")));
            expect(boundary.rows).toEqual(baseline.rows);
            pass('exact source membership release digest feed cutoff identity and rollback integrity');
            await expect(query(request('sales','P',`INSERT INTO public.sales SELECT md5(n::text)::uuid,'${interest}',NULL,'booked' FROM generate_series(1,10001) n;`))).rejects.toThrow('CRM_EXCEL_BOOKING_AMOUNTS_LIMIT');
            expect(JSON.parse(await query(request()))).toEqual(baseline);
            const privileges = JSON.parse(await query("SELECT jsonb_build_object('public',EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.oid='public.crm_v2_excel_booking_amounts(text)'::regprocedure AND a.grantee=0),'anon',has_function_privilege('anon','public.crm_v2_excel_booking_amounts(text)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public.crm_v2_excel_booking_amounts(text)','EXECUTE'),'stable',(SELECT provolatile='s' FROM pg_proc WHERE oid='public.crm_v2_excel_booking_amounts(text)'::regprocedure));"));
            expect(privileges).toEqual({ public: false, anon: false, authenticated: true, stable: true });
            expect(await query("SELECT NOT prosecdef FROM pg_proc WHERE oid='public.crm_v2_excel_booking_amounts(text)'::regprocedure;")).toBe('t');
            expect(await query("SELECT prosecdef AND provolatile='s' FROM pg_proc WHERE oid='crm_excel_private.booking_amounts(text)'::regprocedure;")).toBe('t');
            await expect(query("SET ROLE anon; SELECT crm_excel_private.booking_amounts('P');")).rejects.toThrow('permission denied');
            await expect(query("SET ROLE authenticated; SELECT crm_excel_private.booking_amounts('P');")).rejects.toThrow('CRM_EXCEL_BOOKING_AMOUNTS_FORBIDDEN');
            await expect(query("SET ROLE authenticated; SELECT * FROM crm_external_private.source_records;")).rejects.toThrow('permission denied');
            pass('hard limit and narrow stable ACL, original source values unchanged');
            report.status = 'passed';
        } catch (error) { report.status = 'failed'; report.error = error.message; throw error; }
        finally {
            if (existsSync(passwordFile)) unlinkSync(passwordFile);
            if (postgres && !exited) {
                await command(executable('pg_ctl'), ['-D', data, 'stop', '-m', 'fast', '-w', '-t', '15']);
                for (let i = 0; i < 40 && !exited; i++) await new Promise(ok => setTimeout(ok, 50));
            }
            report.stopped = !postgres || exited;
            writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2));
            expect(report.stopped).toBe(true);
            console.log(`Excel booking amounts native report: ${join(directory, 'report.json')}`);
        }
    }, 120000);
});
