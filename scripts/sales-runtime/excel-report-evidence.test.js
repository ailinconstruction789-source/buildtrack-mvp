// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { assertLocalDatabaseTarget, assertPlainSql, cleanProcessEnvironment, localConnectionArgs, verifyClusterIdentity } from './safety.mjs';

const sql = readFileSync('sql/sales/excel_report_evidence_draft.sql', 'utf8');
const body = sql.split('AS $evidence$')[1].split('$evidence$;')[0];
describe('bounded Excel evidence SQL contract', () => {
    it('retains the non-deployable draft guard and separates private definer from exposed invoker', () => {
        expect(sql).toContain("RAISE EXCEPTION 'DESIGN ONLY: Excel evidence");
        expect(sql.trim()).toMatch(/ROLLBACK;$/);
        expect(sql.match(/CREATE FUNCTION/g)).toHaveLength(2);
        expect(sql).toContain('CREATE SCHEMA crm_excel_private;');
        expect(sql).toContain('REVOKE ALL ON SCHEMA crm_excel_private FROM PUBLIC,anon;');
        expect(sql).toContain('CREATE FUNCTION crm_excel_private.evidence(p_project_name text)');
        expect(sql).toContain('RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog');
        expect(sql).toContain('SELECT crm_excel_private.evidence(p_project_name);');
        expect(sql).not.toMatch(/CREATE OR REPLACE|CREATE TABLE|ALTER TABLE|DROP |TRUNCATE /i);
    });
    it('checks trusted identity and the existing project booking capability', () => {
        for (const term of ['auth.uid()', 'public.crm_v2_role()', "COALESCE(actor_role,'') NOT IN ('sales','admin','owner')",
            'public.crm_v2_project_sales_capabilities()', 'crm_external_private.booking_writer_ready()']) expect(body).toContain(term);
        expect(sql).toContain('STABLE SECURITY DEFINER');
        expect(sql).toContain('SET search_path=pg_catalog');
        expect(sql).toContain('FROM PUBLIC,anon');
        expect(sql).toContain('TO authenticated');
    });
    it('only returns day evidence, ids and counts without customer cells', () => {
        expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|EXECUTE|LOCK)\b/i);
        expect(body).not.toMatch(/rawValues|customer_name|phone|income|crm_answers|RAISE (?:LOG|NOTICE)/i);
        for (const term of ['excel_evidence_v1', 'legacyVisits', 'forecasts', 'completedVisits', 'pendingLegacyRows', 'unknownLegacyDates']) expect(body).toContain(term);
    });
    it('uses A for both historical days and Q only as forecast', () => {
        expect(body).toContain("s.payload->'reviewedHistory'->>'visitHistoryDate'");
        expect(body).toContain("'visitDate',day_value,'leadDate',day_value");
        expect(body).toContain("s.payload->'reviewedHistory'->>'expectedTransferDate'");
        expect(body).toContain("'saleId',item.id,'expectedTransferDate',day_value");
        expect(body).not.toContain('transferred_at');
        expect(body).toContain("pg_input_is_valid(day_value,'date')");
    });
    it('binds source rows to exact public identity and released unrolled-back batch', () => {
        for (const term of ['ic.entity_key=i.external_interest_key', 'c.external_customer_key=ic.customer_key',
            "ic.payload->'sourceRows' @> jsonb_build_array(s.source_row)", "s.disposition='mapped_for_review'",
            's.source_row BETWEEN 2 AND 966', 'b.plan_digest=w.plan_digest', 'sales_rollback_receipts',
            "item.batch_id::text||':'||item.source_row::text", 'c.merged_into_customer_id IS NULL']) expect(body).toContain(term);
    });
    it('requires completed voice evidence, Bangkok check-in day and hard collection bounds', () => {
        for (const term of ["v.status='completed'", 'v.completed_voice_id IS NOT NULL', 'v.completed_at IS NOT NULL',
            "AT TIME ZONE 'Asia/Bangkok'", 'CRM_EXCEL_EVIDENCE_LIMIT']) expect(body).toContain(term);
        expect(body.match(/LIMIT 10001/g)).toHaveLength(5);
        expect(body.match(/IF n>10000 OR item.bounded_count>10000/g)).toHaveLength(4);
        expect(body).toContain('voice.id=v.completed_voice_id AND voice.visit_id=v.id');
        expect(body).toContain('pendingLegacyKeys');
        expect(body).toContain("s.payload->'reviewedHistory'->'projectLabels'='[]'::jsonb");
        expect(body).toContain('NOT EXISTS(SELECT 1 FROM crm_external_private.interest_candidates ic');
        expect(body).toContain('unassignedLegacyVisits');
        expect(body).toContain('unknownUnassignedLegacyDates');
    });
});

// Explicit opt-in native execution: no database URL, existing cluster, dotenv,
// Supabase connection, copied real data or remote fallback is accepted.
// Minimal fixtures test this new projection; guarded-role integration remains
// supplied by the already-tested existing crm_v2_role function in production.
describe.skipIf(process.env.BUILDTRACK_EXCEL_NATIVE_TEST !== '1')('Excel evidence native PostgreSQL synthetic integration', () => {
    it('compiles and verifies authorization, provenance, dates, counts and no writes', async () => {
        const root = resolve('.');
        const bin = join(root, 'node_modules/.cache/buildtrack-sales-runtime/postgres17/pgsql/bin');
        const executable = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
        for (const name of ['initdb', 'postgres', 'pg_ctl', 'psql']) expect(existsSync(executable(name))).toBe(true);
        const cache = join(root, 'node_modules/.cache/buildtrack-sales-runtime/runs');
        mkdirSync(cache, { recursive: true });
        const directory = realpathSync(mkdtempSync(join(cache, 'excel-evidence-')));
        const data = join(directory, 'data'), nonce = randomBytes(12).toString('hex');
        const user = `runtime_${nonce}`, database = `buildtrack_sales_runtime_${nonce}`;
        const password = randomBytes(32).toString('hex'), passwordFile = join(directory, 'init-password');
        const environment = cleanProcessEnvironment(process.env);
        const report = { mode: 'excel-evidence-minimal-synthetic', directory, status: 'running', stopped: false, cases: [] };
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
        const visit = '55555555-5555-4555-8555-555555555555', actor = '66666666-6666-4666-8666-666666666666';
        const request = (role = 'sales', project = 'P', changes = '') => `BEGIN; ${changes}
          SET LOCAL ROLE authenticated; SET LOCAL test.actor='${actor}'; SET LOCAL test.crm_role='${role}';
          SELECT public.crm_v2_excel_evidence('${project}'); ROLLBACK;`;
        const pass = label => report.cases.push(label);
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
              CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
              CREATE FUNCTION public.crm_v2_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('test.crm_role',true) $$;
              CREATE FUNCTION public.crm_v2_project_sales_capabilities() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('enabled',coalesce(current_setting('test.enabled',true),'true')='true') $$;
              CREATE FUNCTION crm_external_private.booking_writer_ready() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.ready',true),'true')='true' $$;
              CREATE TABLE public.projects(name text PRIMARY KEY);
              CREATE TABLE public.sales_customers(id uuid PRIMARY KEY,external_snapshot_batch_id uuid,external_customer_key text,merged_into_customer_id uuid);
              CREATE TABLE public.lead_project_interests(id uuid PRIMARY KEY,customer_id uuid,project_name text,external_snapshot_batch_id uuid,external_interest_key text);
              CREATE TABLE public.sales(id uuid PRIMARY KEY,project_interest_id uuid,external_booking_id uuid,crm_stage text);
              CREATE TABLE public.lead_visits(id uuid PRIMARY KEY,project_interest_id uuid,status text,completed_voice_id uuid,completed_at timestamptz,checked_in_at timestamptz);
              CREATE TABLE public.customer_voices(id uuid PRIMARY KEY,visit_id uuid,crm_submission_state text,crm_form_version text,crm_submitted_by_customer boolean,crm_submitted_at timestamptz,crm_validated_at timestamptz);
              CREATE TABLE crm_external_private.snapshot_batches(id uuid PRIMARY KEY,plan_digest text,feed text);
              CREATE TABLE crm_external_private.booking_writer_releases(batch_id uuid PRIMARY KEY,plan_digest text);
              CREATE TABLE crm_external_private.sales_rollback_receipts(batch_id uuid PRIMARY KEY);
              CREATE TABLE crm_external_private.interest_candidates(batch_id uuid,entity_key text,customer_key text,project_label text,payload jsonb);
              CREATE TABLE crm_external_private.source_records(batch_id uuid,source_row integer,customer_key text,disposition text,payload jsonb,PRIMARY KEY(batch_id,source_row));
              CREATE TABLE crm_external_private.prepared_booking_sales(id uuid PRIMARY KEY,batch_id uuid,payload jsonb);
              INSERT INTO public.projects VALUES('P'),('OTHER'),('ไอลิน6');
              INSERT INTO crm_external_private.snapshot_batches VALUES('${batch}','digest','customer-sheet');
              INSERT INTO crm_external_private.booking_writer_releases VALUES('${batch}','digest');
              INSERT INTO public.sales_customers VALUES('${customer}','${batch}','customer',NULL);
              INSERT INTO public.lead_project_interests VALUES('${interest}','${customer}','P','${batch}','interest');
              INSERT INTO crm_external_private.interest_candidates VALUES('${batch}','interest','customer','P','{"sourceRows":[2,2,3,4,5,966,967]}');
              INSERT INTO crm_external_private.source_records VALUES
                ('${batch}',2,'customer','mapped_for_review','{"reviewedHistory":{"visitHistoryDate":"2026-09-01","expectedTransferDate":"2027-01-02"}}'),
                ('${batch}',3,'customer','mapped_for_review','{"reviewedHistory":{"visitHistoryDate":"2026-09-02"}}'),
                ('${batch}',4,'customer','admin_review','{"reviewedHistory":{"visitHistoryDate":"2026-09-03"}}'),
                ('${batch}',5,'customer','mapped_for_review','{"reviewedHistory":{"visitHistoryDate":null}}'),
                ('${batch}',966,'customer','mapped_for_review','{"reviewedHistory":{"visitHistoryDate":"2026-09-04"}}'),
                ('${batch}',967,'customer','mapped_for_review','{"reviewedHistory":{"visitHistoryDate":"2026-09-05"}}'),
                ('${batch}',6,'customer','mapped_for_review','{"reviewedHistory":{"projectLabels":[],"visitHistoryDate":"2026-09-06"}}'),
                ('${batch}',7,'customer','mapped_for_review','{"reviewedHistory":{"projectLabels":[],"visitHistoryDate":null}}'),
                ('${batch}',8,'customer','mapped_for_review','{"reviewedHistory":{"projectLabels":["P"],"visitHistoryDate":"2026-09-08"}}'),
                ('${batch}',9,'customer','mapped_for_review','{"reviewedHistory":{"visitHistoryDate":"2026-09-09"}}'),
                ('${batch}',680,NULL,'admin_review','{"reviewedHistory":{"projectLabels":["AL6"],"visitHistoryDate":"2026-09-06"}}');
              INSERT INTO crm_external_private.prepared_booking_sales VALUES('${sale}','${batch}',
                '{"source_row":2,"customer_id":"${customer}","interest_id":"${interest}","project_name":"P"}');
              INSERT INTO public.sales VALUES('${sale}','${interest}','${sale}','booked');
              INSERT INTO public.lead_visits VALUES('${visit}','${interest}','completed','${visit}','2026-09-30T19:00:00Z','2026-09-30T18:00:00Z');
              INSERT INTO public.customer_voices VALUES('${visit}','${visit}','submitted','customer_voices_v1',true,'2026-09-30T19:00:00Z','2026-09-30T19:00:00Z');
              REVOKE ALL ON ALL TABLES IN SCHEMA public,crm_external_private FROM PUBLIC,anon,authenticated;
              REVOKE ALL ON SCHEMA crm_external_private FROM PUBLIC,anon,authenticated;`);
            await expect(query(sql)).rejects.toThrow('DESIGN ONLY: Excel evidence'); pass('draft guard rejects verbatim execution');
            const wrapper = /BEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: Excel evidence requires isolated verification and deployment review';\s*END;\s*\$draft_only\$;/;
            expect(sql.match(wrapper)).not.toBeNull();
            await query(sql.replace(wrapper, 'BEGIN;').replace(/ROLLBACK;\s*$/, 'COMMIT;'));
            const baseline = JSON.parse(await query(request()));
            expect(baseline.legacyVisits).toHaveLength(3); expect(baseline.pendingLegacyRows).toBe(1); expect(baseline.unknownLegacyDates).toBe(1);
            expect(baseline.pendingLegacyKeys).toEqual([`${batch}:4`]);
            expect(baseline.legacyVisits.map(r => r.key)).toEqual([`${batch}:2`, `${batch}:3`, `${batch}:966`]);
            expect(baseline.legacyVisits.every(r => r.leadDate === r.visitDate && r.customerId === customer)).toBe(true);
            expect(baseline.forecasts).toEqual([{ saleId: sale, expectedTransferDate: '2027-01-02' }]);
            expect(baseline.completedVisits).toEqual([{ key: `visit:${visit}`, customerId: customer, visitDate: '2026-10-01' }]);
            expect(baseline.unassignedLegacyVisits).toEqual([{ key: `${batch}:6`, customerId: customer, visitDate: '2026-09-06', leadDate: '2026-09-06' }]);
            expect(baseline.unknownUnassignedLegacyDates).toBe(1);
            expect(JSON.parse(await query(request('sales','OTHER'))).unassignedLegacyVisits).toEqual(baseline.unassignedLegacyVisits);
            const nowAssigned = JSON.parse(await query(request('sales','P',`UPDATE crm_external_private.interest_candidates SET payload='{"sourceRows":[2,2,3,4,5,6,966,967]}';`)));
            expect(nowAssigned.unassignedLegacyVisits).toEqual([]);
            expect(nowAssigned.legacyVisits.some(row => row.key === `${batch}:6`)).toBe(true);
            await expect(query(request('sales','P',`UPDATE crm_external_private.source_records SET payload=jsonb_set(payload,'{reviewedHistory,visitHistoryDate}','"2026-02-30"') WHERE source_row=6;`))).rejects.toThrow('CRM_EXCEL_EVIDENCE_DATE_INVALID');
            pass('unassigned visits retained globally only empty project arrays and no membership without guessed project');
            pass('exact membership dedup cutoff A=lead Q forecast Bangkok date pending unknown');
            for (const role of ['sales','admin','owner']) expect(JSON.parse(await query(request(role))).actor.role).toBe(role);
            for (const role of ['foreman','', 'Sales']) await expect(query(request(role))).rejects.toThrow('CRM_EXCEL_EVIDENCE_FORBIDDEN');
            await expect(query(`SET ROLE anon; SELECT public.crm_v2_excel_evidence('P');`)).rejects.toThrow('permission denied');
            await expect(query("SET ROLE authenticated; SELECT public.crm_v2_excel_evidence('P');")).rejects.toThrow('CRM_EXCEL_EVIDENCE_FORBIDDEN');
            await expect(query(request('sales','P',"SET LOCAL test.enabled='false';"))).rejects.toThrow('CRM_EXCEL_EVIDENCE_SETUP_REQUIRED');
            await expect(query(request('sales','P',"SET LOCAL test.ready='false';"))).rejects.toThrow('CRM_EXCEL_EVIDENCE_SETUP_REQUIRED');
            await expect(query(request('sales','MISSING'))).rejects.toThrow('CRM_EXCEL_EVIDENCE_NOT_FOUND');
            expect(JSON.parse(await query(request('sales','OTHER'))).legacyVisits).toEqual([]);
            const unnamed = JSON.parse(await query(request('sales','ไอลิน6')));
            expect(unnamed.pendingLegacyRows).toBe(1); expect(unnamed.pendingLegacyKeys).toEqual([`${batch}:680`]);
            expect(unnamed.legacyVisits).toEqual([]);
            const multiPending = JSON.parse(await query(request('sales','OTHER',`INSERT INTO crm_external_private.interest_candidates VALUES('${batch}','other-interest','customer','OTHER','{"sourceRows":[4]}');`)));
            expect(multiPending.pendingLegacyKeys).toEqual(baseline.pendingLegacyKeys);
            pass('unnamed pending row attributed only through approved alias and cross-project pending keys deduplicate');
            pass('staff roles only authenticated capability and exact project gates');
            for (const badDate of ['2026-02-30','0000-01-01','2026-09-01T00:00:00','infinity']) {
                await expect(query(request('sales','P',`UPDATE crm_external_private.source_records SET payload=jsonb_set(payload,'{reviewedHistory,visitHistoryDate}','"${badDate}"') WHERE source_row=2;`))).rejects.toThrow('CRM_EXCEL_EVIDENCE_DATE_INVALID');
            }
            const missingQ = JSON.parse(await query(request('sales','P',"UPDATE crm_external_private.source_records SET payload=payload#-'{reviewedHistory,expectedTransferDate}' WHERE source_row=2;")));
            expect(missingQ.forecasts[0].expectedTransferDate).toBeNull();
            for (const stage of ['cancelled','transferred','handover']) {
                expect(JSON.parse(await query(request('sales','P',`UPDATE public.sales SET crm_stage='${stage}';`))).forecasts).toEqual([]);
            }
            for (const incomplete of ["status='checked_in'", 'completed_voice_id=NULL', 'completed_at=NULL']) {
                expect(JSON.parse(await query(request('sales','P',`UPDATE public.lead_visits SET ${incomplete};`))).completedVisits).toEqual([]);
            }
            for (const invalidVoice of ["crm_submission_state='draft'", `visit_id='${actor}'`, 'crm_submitted_by_customer=false', 'crm_validated_at=NULL']) {
                expect(JSON.parse(await query(request('sales','P',`UPDATE public.customer_voices SET ${invalidVoice};`))).completedVisits).toEqual([]);
            }
            pass('invalid dates rejected absent Q unknown cancelled and transferred forecasts omitted incomplete visits omitted');
            await expect(query(request('sales','P',`INSERT INTO crm_external_private.sales_rollback_receipts VALUES('${batch}');`))).rejects.toThrow('CRM_EXCEL_EVIDENCE_INTEGRITY_REQUIRED');
            await expect(query(request('sales','P',"UPDATE crm_external_private.booking_writer_releases SET plan_digest='wrong';"))).rejects.toThrow('CRM_EXCEL_EVIDENCE_INTEGRITY_REQUIRED');
            await expect(query(request('sales','P',"UPDATE crm_external_private.prepared_booking_sales SET payload=jsonb_set(payload,'{project_name}','\"OTHER\"');"))).rejects.toThrow('CRM_EXCEL_EVIDENCE_INTEGRITY_REQUIRED');
            const merged = JSON.parse(await query(request('sales','P',`UPDATE public.sales_customers SET merged_into_customer_id='${actor}';`)));
            expect(merged.legacyVisits).toEqual([]); expect(merged.forecasts).toEqual([]); expect(merged.completedVisits).toEqual([]);
            expect(merged.unassignedLegacyVisits).toEqual([]);
            pass('rollback digest corrupt project and merged identities cannot leak evidence');
            await expect(query(request('sales','P',`INSERT INTO public.lead_visits SELECT md5(n::text)::uuid,'${interest}','completed',md5(n::text)::uuid,now(),now() FROM generate_series(1,10001) n;
              INSERT INTO public.customer_voices SELECT md5(n::text)::uuid,md5(n::text)::uuid,'submitted','customer_voices_v1',true,now(),now() FROM generate_series(1,10001) n;`))).rejects.toThrow('CRM_EXCEL_EVIDENCE_LIMIT');
            pass('over-bound collection fails without partial response');
            expect(JSON.parse(await query(request()))).toEqual(baseline);
            const privileges = JSON.parse(await query("SELECT jsonb_build_object('public',EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.oid='public.crm_v2_excel_evidence(text)'::regprocedure AND a.grantee=0),'anon',has_function_privilege('anon','public.crm_v2_excel_evidence(text)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public.crm_v2_excel_evidence(text)','EXECUTE'),'stable',(SELECT provolatile='s' FROM pg_proc WHERE oid='public.crm_v2_excel_evidence(text)'::regprocedure));"));
            expect(privileges).toEqual({ public: false, anon: false, authenticated: true, stable: true });
            expect(await query("SELECT NOT prosecdef FROM pg_proc WHERE oid='public.crm_v2_excel_evidence(text)'::regprocedure;")).toBe('t');
            expect(await query("SELECT prosecdef AND provolatile='s' FROM pg_proc WHERE oid='crm_excel_private.evidence(text)'::regprocedure;")).toBe('t');
            await expect(query(`SET ROLE anon; SELECT crm_excel_private.evidence('P');`)).rejects.toThrow('permission denied');
            await expect(query(`SET ROLE authenticated; SELECT crm_excel_private.evidence('P');`)).rejects.toThrow('CRM_EXCEL_EVIDENCE_FORBIDDEN');
            pass('read-only baseline unchanged and narrow stable ACL confirmed');
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
            console.log(`Excel evidence native report: ${join(directory, 'report.json')}`);
        }
    }, 120000);
});
