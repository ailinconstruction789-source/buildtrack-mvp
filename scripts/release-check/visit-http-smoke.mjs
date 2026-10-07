/** Read pages and exercise rejection paths on an owned credential-free built snapshot only. */
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const name = process.argv[2];
if (process.argv.length !== 3 || !/^app-[a-zA-Z0-9]{6}$/.test(name ?? '')) throw new Error('Supply an owned selected snapshot name');
const directory = realpathSync(join(root, '.next/release-check', name));
assert.equal(relative(join(root, '.next/release-check'), directory), name);
const build = JSON.parse(readFileSync(join(directory, 'release-report.json'), 'utf8'));
const server = JSON.parse(readFileSync(join(directory, 'serve-report.json'), 'utf8'));
assert.equal(build.status, 'passed'); assert.equal(build.profile, 'selected-visit-offline-webpack-low-memory');
assert.equal(build.sourceFilesUnchanged, true); assert.equal(build.realCredentialsLoaded, false);
assert.equal(server.directory, directory); assert.equal(server.stopped, false); assert.equal(server.realCredentialsLoaded, false);
assert.equal(server.origin, `http://127.0.0.1:${server.port}`);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = `customerId=${id(1)}&interestId=${id(2)}`;
const report = { startedAt: new Date().toISOString(), status: 'running', checks: [], productionChanged: false, realCredentialsLoaded: false,
  limitations: ['No authenticated Supabase/PostgREST or database success tested', 'HTTP responses only; visual and interactive browser acceptance separate'] };
async function check(path, status, options = {}, expectedCode = null, text = null) {
  const response = await fetch(`${server.origin}${path}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, status, path);
  const result = await response.text();
  if (expectedCode) { assert.equal(JSON.parse(result).error.code, expectedCode, path); assert.equal(response.headers.get('cache-control'), 'no-store'); }
  if (text) assert.ok(result.includes(text), `${path}: required page text absent`);
  report.checks.push({ path, method: options.method ?? 'GET', status, ...(expectedCode ? { code: expectedCode, cacheControl: response.headers.get('cache-control') } : {}) });
  return response;
}
const post = value => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
try {
  for (const path of ['/', '/sales', '/owner', '/sales-crm']) await check(path, 200);
  for (const [path, query] of [['visits', scope], ['sop', `${scope}&appointmentId=${id(3)}`],
    ['customer-voices', `${scope}&visitId=${id(3)}`], ['visit-follow-up', scope]]) {
    await check(`/sales-crm/${path}?${query}`, 200);
    await check(`/api/sales-crm/${path}?${query}`, 401, {}, 'UNAUTHENTICATED');
    await check(`/api/sales-crm/${path}`, 400, post({}), 'INVALID_INPUT');
  }
  await check('/api/sales-crm/visit-follow-up', 401, post({ requestId: id(4), command: 'set_next_action', customerId: id(1), interestId: id(2), expectedActionId: null,
    nextAction: { action: 'synthetic follow-up', dueAt: '2026-10-10T12:00:00Z' }, reason: 'synthetic HTTP rejection check' }), 'UNAUTHENTICATED');
  for (const path of ['lead-work', 'lifecycle', 'notifications', 'work-schedule', 'sla-preview', 'sla-receipts', 'sla-cycles']) {
    await check(`/api/sales-crm/${path}`, 503, {}, 'FEATURE_DISABLED');
    if (['sla-preview', 'sla-receipts'].includes(path)) await check(`/api/sales-crm/${path}`, 405, post({}));
    else await check(`/api/sales-crm/${path}`, 503, post({}), 'FEATURE_DISABLED');
  }
  await check('/api/sales-crm/sla-process', 503, post({}), 'FEATURE_DISABLED');
  for (const [path, text] of [['notifications', 'ยังไม่เปิดระบบแจ้งเตือนฝ่ายขาย'], ['work-schedule', 'ยังไม่เปิดระบบจัดเวรฝ่ายขาย'],
    ['sla-preview', 'ยังไม่เปิดหน้าตรวจแผนแจ้งเตือน'], ['sla-processing', 'ยังไม่เปิดหน้าประมวลผลและตรวจใบรับ']]) await check(`/sales-crm/${path}`, 200, {}, null, text);
  // Absent one-segment sales pages match the deployed [customerId] route, whose scope gate returns a closed notice.
  for (const path of ['/sales-crm/interests', '/sales-crm/queue-monitor', '/sales-crm/post-booking', '/sales-crm/reports']) await check(path, 200, {}, null, 'ยังไม่เปิดงานติดตามลูกค้า');
  await check('/dev/account-access', 404);
  const publicPage = await check('/customer-voices', 200);
  assert.equal(publicPage.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(publicPage.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(publicPage.headers.get('x-frame-options'), 'DENY');
  assert.ok(publicPage.headers.get('cache-control').includes('no-store'));
  assert.ok(publicPage.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  report.checks.push({ path: '/customer-voices', headers: 'privacy/no-store/no-frame verified' });
  await check('/api/customer-voices', 400, post({}), 'INVALID_INPUT');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); writeFileSync(join(directory, 'visit-http-smoke-report.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, error: report.error, report: join(directory, 'visit-http-smoke-report.json') }));
