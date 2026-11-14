/** Isolated native PostgreSQL proof. No live URL, dotenv, credentials or data.
 * Uses the repository's real trusted actor function with synthetic users/sessions.
 * The disposable cluster is always stopped and retained in ignored cache.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPlainSql, cleanProcessEnvironment, localConnectionArgs, verifyClusterIdentity } from './sales-runtime/safety.mjs';

if (process.argv.length !== 2) throw Error('This test does not accept connection arguments.');
const root = resolve(dirname(fileURLToPath(import.meta.url))), nonce = randomBytes(12).toString('hex');
const cache = join(root, '../node_modules/.cache/buildtrack-demo-runtime');
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, 'run-')), data = join(directory, 'data');
const bin = resolve(root, '../node_modules/.cache/buildtrack-sales-runtime/postgres17/pgsql/bin');
const database = `buildtrack_sales_runtime_${nonce}`, user = `runtime_${nonce}`;
const password = randomBytes(32).toString('hex'), passwordFile = join(directory, 'password');
const environment = { ...cleanProcessEnvironment(process.env), PGPASSWORD: password };
const listener = createServer();
await new Promise((ok, fail) => { listener.once('error', fail); listener.listen(0, '127.0.0.1', ok); });
const port = listener.address().port;
await new Promise(ok => listener.close(ok));
const migration = 'supabase/migrations/20261114032346_admin_demo_projects.sql';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const quote = s => `'${String(s).replaceAll("'", "''")}'`;
const layout = { version: 1, cols: 24, rows: 16, cells: [{ id: 'road-1', x: 1, y: 2, kind: 'road' }] };
let started = false, checks = 0;

function command(name, args, input = '', expectFailure = false) {
  const result = spawnSync(join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`), args, {
    cwd: root, env: environment, windowsHide: true, input, encoding: 'utf8', timeout: 30000,
    stdio: name === 'pg_ctl' ? 'ignore' : 'pipe', maxBuffer: 4 * 1024 * 1024,
  });
  if (expectFailure) {
    assert.notEqual(result.status, 0, 'Expected SQL to reject operation');
    return result.stderr || '';
  }
  if (result.status !== 0) throw Error(`${name}: ${result.stderr || result.error?.message || result.status}`);
  return result.stdout?.trim() || '';
}
function query(sql, { bootstrap = false, fail = false } = {}) {
  assertPlainSql(sql);
  const args = localConnectionArgs(port, database, user);
  if (bootstrap) args[args.indexOf(database)] = 'postgres';
  return command('psql', args, sql, fail);
}
function asActor(n, sql, { fail = false, metadata = {}, session = uuid(100 + n) } = {}) {
  const claims = JSON.stringify({ sub: uuid(n), session_id: session, user_metadata: metadata });
  return query(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = ${quote(claims)}; ${sql}; COMMIT;`, { fail });
}
function test(name, action) { action(); checks++; console.log(`PASS ${name}`); }
const insert = (id, value = layout, name = 'Infrastructure Demo') =>
  `INSERT INTO public.admin_demo_projects(id,name,layout_data) VALUES (${quote(uuid(id))},${quote(name)},${quote(JSON.stringify(value))}::jsonb)`;

try {
  writeFileSync(passwordFile, password, { flag: 'wx' });
  command('initdb', ['-D', data, '-U', user, '--pwfile', passwordFile, '-A', 'scram-sha-256', '--encoding=UTF8', '--no-locale']);
  unlinkSync(passwordFile);
  command('pg_ctl', ['-D', data, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c buildtrack.synthetic_runtime=on`, 'start', '-w', '-t', '20']);
  started = true;
  query(`CREATE DATABASE ${database};`, { bootstrap: true });
  const identity = JSON.parse(query("SELECT json_build_object('address',host(inet_server_addr()),'port',inet_server_port(),'user',current_user,'database',current_database(),'data',current_setting('data_directory'),'listen',current_setting('listen_addresses'),'marker',current_setting('buildtrack.synthetic_runtime',true));"));
  verifyClusterIdentity(identity, { port, database, user, data });
  query(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA account_security_private;
    GRANT USAGE ON SCHEMA public,auth,account_security_private TO authenticated;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claims',true)::jsonb$$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT (auth.jwt()->>'sub')::uuid$$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,is_anonymous boolean,banned_until timestamptz);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
    CREATE TABLE public.users(id bigint PRIMARY KEY,username text);
    CREATE TABLE account_security_private.reviewed_roles(auth_user_id uuid PRIMARY KEY,legacy_user_id bigint,role text,enabled boolean);
    CREATE TABLE account_security_private.reviewed_admins(auth_user_id uuid,legacy_user_id bigint,enabled boolean);
    CREATE TABLE public.projects(id integer PRIMARY KEY,name text);
    CREATE TABLE public.plots(id integer PRIMARY KEY,project_name text);
    INSERT INTO public.projects VALUES(1,'Real project sentinel'); INSERT INTO public.plots VALUES(1,'Real project sentinel');
    ${['Admin','Owner','Sales','Foreman','QC','Project Engineer'].map((role, i) => `
      INSERT INTO auth.users VALUES('${uuid(i + 1)}',null,false,null);
      INSERT INTO auth.sessions VALUES('${uuid(i + 101)}','${uuid(i + 1)}',null);
      INSERT INTO public.users VALUES(${i + 1},'Synthetic ${role}');
      INSERT INTO account_security_private.reviewed_roles VALUES('${uuid(i + 1)}',${i + 1},'${role}',true);
    `).join('')}
    INSERT INTO account_security_private.reviewed_admins VALUES('${uuid(1)}',1,true);
  `);
  const authSource = readFileSync(resolve(root, '../supabase/migrations/20260928090010_crm_sealed_foundation_candidate.sql'), 'utf8');
  const start = authSource.indexOf('CREATE FUNCTION account_security_private.current_actor()');
  const end = authSource.indexOf('DO $postflight$', start);
  assert.ok(start > 0 && end > start);
  query(authSource.slice(start, end));
  query(`
    REVOKE ALL ON SCHEMA account_security_private FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON FUNCTION account_security_private.current_actor(), public.app_current_actor() FROM PUBLIC, anon, authenticated;
  `);
  query(readFileSync(resolve(root, '..', migration), 'utf8'));

  test('Admin creates sandbox with server ownership and revision', () => {
    const row = JSON.parse(asActor(1, `${insert(201)} RETURNING json_build_object('owner',created_by,'revision',revision,'name',name)`));
    assert.deepEqual(row, { owner: uuid(1), revision: 1, name: 'Infrastructure Demo' });
  });
  test('Admin reads sandbox (including PostgREST read-only GET transactions)', () => {
    assert.equal(asActor(1, 'SELECT count(*) FROM public.admin_demo_projects'), '1');
    assert.equal(asActor(1, 'SET LOCAL transaction_read_only = on; SELECT count(*) FROM public.admin_demo_projects'), '1');
  });
  test('Duplicate creation id does not create a second demo', () => {
    assert.match(asActor(1, insert(201), { fail: true }), /duplicate key/);
    assert.equal(asActor(1, 'SELECT count(*) FROM public.admin_demo_projects'), '1');
  });
  for (const [n, role] of [[2,'Owner'],[3,'Sales'],[4,'Foreman'],[5,'QC'],[6,'Project Engineer']]) {
    test(`${role} cannot read or insert, including forged Admin metadata`, () => {
      const opts = { metadata: { role: 'Admin' } };
      assert.equal(asActor(n, 'SELECT count(*) FROM public.admin_demo_projects', opts), '0');
      assert.match(asActor(n, insert(200 + n), { ...opts, fail: true }), /row-level security/);
      assert.equal(asActor(n, "WITH changes AS (UPDATE public.admin_demo_projects SET name='forbidden' RETURNING id) SELECT count(*) FROM changes", opts), '0');
    });
  }
  test('Anonymous cannot read or create', () => {
    assert.match(query('SET ROLE anon; SELECT * FROM public.admin_demo_projects;', { fail: true }), /permission denied/);
    assert.match(query(`SET ROLE anon; ${insert(210)};`, { fail: true }), /permission denied/);
  });
  test('Admin update increments revision and preserves creation evidence', () => {
    const row = JSON.parse(asActor(1, `UPDATE public.admin_demo_projects SET name='Edited Demo' WHERE id='${uuid(201)}' AND revision=1 RETURNING json_build_object('revision',revision,'owner',created_by,'timestamp',updated_at>=created_at)`));
    assert.deepEqual(row, { revision: 2, owner: uuid(1), timestamp: true });
  });
  test('Stale revision cannot overwrite another save', () => {
    assert.equal(asActor(1, `WITH changes AS (UPDATE public.admin_demo_projects SET name='Stale' WHERE id='${uuid(201)}' AND revision=1 RETURNING id) SELECT count(*) FROM changes`), '0');
    assert.equal(asActor(1, `SELECT name FROM public.admin_demo_projects WHERE id='${uuid(201)}'`), 'Edited Demo');
  });
  test('Ownership and revision cannot be forged', () => {
    assert.match(asActor(1, `UPDATE public.admin_demo_projects SET created_by='${uuid(2)}'`, { fail: true }), /permission denied/);
    assert.match(asActor(1, 'UPDATE public.admin_demo_projects SET revision=1', { fail: true }), /permission denied/);
    assert.match(asActor(1, `INSERT INTO public.admin_demo_projects(name,created_by) VALUES('Spoof','${uuid(2)}')`, { fail: true }), /permission denied/);
  });
  test('Delete and truncate are not available', () => {
    assert.match(asActor(1, 'DELETE FROM public.admin_demo_projects', { fail: true }), /permission denied/);
    assert.match(asActor(1, 'TRUNCATE public.admin_demo_projects', { fail: true }), /permission denied/);
  });
  test('Invalid layout, duplicate cells, bounds and names are rejected', () => {
    const invalid = [{}, { ...layout, cols: 0 }, { ...layout, cells: [layout.cells[0], { ...layout.cells[0], id: 'road-2' }] },
      { ...layout, cells: [{ ...layout.cells[0], x: 24 }] }, { ...layout, cells: [{ ...layout.cells[0], kind: 'unknown' }] }];
    for (const value of invalid) assert.match(asActor(1, insert(220, value), { fail: true }), /check constraint/);
    assert.match(asActor(1, insert(220, layout, ' '), { fail: true }), /check constraint/);
  });
  test('Different utility layers can occupy the same location', () => {
    const value = { ...layout, cells: [...layout.cells, { ...layout.cells[0], id: 'pipe-1', kind: 'water' }] };
    assert.equal(asActor(1, `${insert(230, value)} RETURNING revision`), '1');
  });
  test('Revoked membership and expired sessions deny access immediately', () => {
    query(`UPDATE account_security_private.reviewed_roles SET enabled=false WHERE auth_user_id='${uuid(1)}';`);
    assert.match(asActor(1, 'SELECT * FROM public.admin_demo_projects', { fail: true }), /APP_ACTOR_REQUIRED/);
    query(`UPDATE account_security_private.reviewed_roles SET enabled=true WHERE auth_user_id='${uuid(1)}'; UPDATE auth.sessions SET not_after=now()-interval '1 minute' WHERE id='${uuid(101)}';`);
    assert.match(asActor(1, insert(240), { fail: true }), /APP_ACTOR_REQUIRED/);
    query(`UPDATE auth.sessions SET not_after=null WHERE id='${uuid(101)}';`);
  });
  test('Real project and plot data are unchanged', () => {
    assert.equal(query("SELECT name FROM public.projects WHERE id=1"), 'Real project sentinel');
    assert.equal(query('SELECT count(*) FROM public.projects'), '1');
    assert.equal(query('SELECT count(*) FROM public.plots'), '1');
  });
  console.log(JSON.stringify({ checks, migration, liveDatabaseWrites: false, auth: 'real trusted actor function; synthetic users and sessions', limitations: 'SQL/RLS proof, not hosted PostgREST or browser E2E' }));
} finally {
  if (started) command('pg_ctl', ['-D', data, 'stop', '-m', 'fast', '-w', '-t', '20']);
  console.log('Owned demo test cluster stopped.');
}
