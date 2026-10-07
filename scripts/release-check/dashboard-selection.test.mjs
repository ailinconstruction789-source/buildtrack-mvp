import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { DASHBOARD_BASELINE, DASHBOARD_OVERLAY, DASHBOARD_RUNTIME_FILES, DASHBOARD_OVERLAY_TEST_FILES,
  DASHBOARD_TEST_FILES, selectedDashboardFiles } from './dashboard-selection.mjs';
import { EXCEL_TEST_FILES } from './excel-selection.mjs';
import { buildEnvironment, includeSource, releaseArguments } from './check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const git = args => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const baselineFiles = git(['ls-tree', '-rz', '--name-only', DASHBOARD_BASELINE]).split('\0');

test('Dashboard selection pins production and permits exactly three presentation files and two tests', () => {
  assert.equal(DASHBOARD_BASELINE, 'e91e22f373ce635778ebab33ef9f4cc03c40ed90');
  assert.deepEqual(DASHBOARD_RUNTIME_FILES, [
    'components/sales/CentralExcelReportView.tsx',
    'components/sales/CentralLegacyDashboard.tsx',
    'components/sales/CentralLegacyWaitingDetails.tsx',
  ]);
  assert.deepEqual(DASHBOARD_OVERLAY_TEST_FILES, [
    'components/sales/__tests__/CentralExcelReportView.test.tsx',
    'components/sales/__tests__/CentralLegacyWaitingDetails.test.tsx',
  ]);
  assert.deepEqual(DASHBOARD_OVERLAY, [...new Set([...DASHBOARD_RUNTIME_FILES, ...DASHBOARD_OVERLAY_TEST_FILES])].sort());
  const selected = selectedDashboardFiles(baselineFiles, includeSource);
  for (const file of ['app/page.tsx', 'app/api/sales-crm/excel-report/route.ts', 'components/sales/SalesReportingEntry.tsx',
    'components/sales/CentralExcelReportWorkspace.tsx', 'lib/sales/projectSalesServer.ts', 'lib/sales/excelReportMetrics.ts',
    'lib/sales/projectSalesFlags.ts', 'package.json', 'package-lock.json']) {
    assert.ok(selected.includes(file), file);
    assert.equal(DASHBOARD_OVERLAY.includes(file), false, file);
  }
  assert.equal(selected.includes('components/sales/SalesReportsWorkspace.tsx'), false);
  assert.equal(selected.includes('app/api/sales-crm/reports/route.ts'), false);
});

test('selection rejects private artifacts, SQL, traversal and linked-style names even with permissive callback', () => {
  const unsafe = ['.env.local', 'app/.env', 'private-import-plan.json', 'customer.xlsx', 'customers.csv',
    'backup.sql', 'key.pem', 'node_modules/x.js', '../app/page.tsx', '/app/page.tsx', 'C:/secret.ts', 'app\\secret.ts'];
  const files = selectedDashboardFiles([...baselineFiles, ...unsafe], () => true);
  for (const file of unsafe) assert.equal(files.includes(file), false, file);
  assert.throws(() => selectedDashboardFiles(baselineFiles, () => false), /Unsafe Dashboard overlay/);
});

test('all six Excel tests remain selected, with only UI tests sourced from dirty checkout', () => {
  for (const file of EXCEL_TEST_FILES) assert.ok(DASHBOARD_TEST_FILES.includes(file), file);
  assert.equal(DASHBOARD_TEST_FILES.length, 7);
  for (const file of DASHBOARD_TEST_FILES.filter(file => !DASHBOARD_OVERLAY.includes(file))) {
    assert.ok(baselineFiles.includes(file), `Baseline regression test missing: ${file}`);
  }
});

test('Dashboard profile cannot override its source and preserves existing release profiles', () => {
  assert.deepEqual(releaseArguments(['--restore-dashboard'], root), { releaseScope: 'central_visits', candidate: 'dashboard', source: root });
  assert.throws(() => releaseArguments(['--restore-dashboard', '--source', root], root), /immutable baseline/);
  assert.deepEqual(releaseArguments(['--central-excel'], root), { releaseScope: 'central_visits', candidate: 'excel', source: root });
  assert.deepEqual(releaseArguments(['--central-visits'], root), { releaseScope: 'central_visits', source: root });
});

test('Dashboard validation keeps current release flags and excludes inherited credentials', () => {
  const env = buildEnvironment({ PATH: 'synthetic-path', SUPABASE_SERVICE_ROLE_KEY: 'do-not-copy', VERCEL_TOKEN: 'do-not-copy' }, root, 'central_visits');
  assert.equal(env.SALES_CRM_RELEASE_SCOPE, 'central_visits');
  assert.equal(env.SALES_CRM_VISITS_ENABLED, 'true');
  assert.equal(env.SALES_CRM_NOTIFICATIONS_ENABLED, 'false');
  assert.equal(env.SALES_CRM_POST_BOOKING_ENABLED, 'false');
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.VERCEL_TOKEN, undefined);
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:1');
});

test('presentation imports close over immutable production plus the exact five-file overlay', () => {
  const selected = selectedDashboardFiles(baselineFiles, includeSource);
  const missing = [];
  for (const file of DASHBOARD_OVERLAY) {
    const source = ts.createSourceFile(file, readFileSync(resolve(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = node => {
      let spec;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) spec = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) spec = node.arguments[0].text;
      if (spec?.startsWith('.') || spec?.startsWith('@/')) {
        const candidate = spec.startsWith('@/') ? spec.slice(2) : resolve(root, dirname(file), spec).slice(root.length + 1).replaceAll('\\', '/');
        if (![candidate, ...['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx'].map(suffix => candidate + suffix)].some(path => selected.includes(path))) missing.push(`${file}: ${spec}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(missing, []);
});
