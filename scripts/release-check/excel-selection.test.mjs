import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { EXCEL_BASELINE, EXCEL_ENTRY_PATH, EXCEL_OVERLAY, EXCEL_RUNTIME_FILES, EXCEL_SOURCE_FILES,
  EXCEL_TEST_FILES, excelSourceOverride, selectedExcelFiles } from './excel-selection.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const git = args => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const baselineFiles = git(['ls-tree', '-rz', '--name-only', EXCEL_BASELINE]).split('\0');
const selected = selectedExcelFiles(baselineFiles, () => true);
const baselineEntry = git(['show', `${EXCEL_BASELINE}:${EXCEL_ENTRY_PATH}`]);
const entry = excelSourceOverride(EXCEL_ENTRY_PATH, baselineEntry);
const body = file => file === EXCEL_ENTRY_PATH ? entry : EXCEL_SOURCE_FILES.includes(file)
  ? readFileSync(resolve(root, file), 'utf8') : git(['show', `${EXCEL_BASELINE}:${file}`]);

test('exact baseline and bounded sorted overlay; no arbitrary dirty source inclusion', () => {
  assert.equal(EXCEL_BASELINE, '89b63b48087fe2bcdd1afd8280d10c6d4c333902');
  assert.equal(EXCEL_RUNTIME_FILES.length, 8);
  assert.equal(EXCEL_TEST_FILES.length, 6);
  assert.equal(new Set(EXCEL_OVERLAY).size, EXCEL_OVERLAY.length);
  assert.deepEqual(EXCEL_OVERLAY, [...EXCEL_OVERLAY].sort());
  assert.equal(EXCEL_SOURCE_FILES.includes(EXCEL_ENTRY_PATH), false);
  assert.ok(EXCEL_SOURCE_FILES.every(file => EXCEL_OVERLAY.includes(file)));
  for (const file of ['app/page.tsx', 'app/layout.tsx', 'components/LoginView.tsx', 'hooks/useBuildTrackData.ts',
    'components/admin/AdminUsersView.tsx', 'lib/sales/workflow.ts', 'package.json', 'package-lock.json',
    'components/sales/SalesWorkspaceModeProvider.tsx', 'lib/sales/projectSalesFlags.ts']) {
    assert.ok(selected.includes(file), file);
    assert.equal(EXCEL_OVERLAY.includes(file), false, file);
  }
  assert.equal(selected.includes('components/sales/SalesReportsWorkspace.tsx'), false);
  assert.equal(selected.includes('app/api/sales-crm/reports/route.ts'), false);
});

test('selection excludes secrets, private artifacts, spreadsheets, SQL and path traversal even with permissive callback', () => {
  const unsafe = ['.env.local', 'app/.env', 'private-import-plan.json', 'customer.xlsx', 'customers.csv',
    'backup.sql', 'key.pem', 'node_modules/x.js', '../app/page.tsx', '/app/page.tsx', 'C:/secret.ts', 'app\\secret.ts'];
  const files = selectedExcelFiles([...baselineFiles, ...unsafe], () => true);
  for (const path of unsafe) assert.equal(files.includes(path), false, path);
  assert.throws(() => selectedExcelFiles(baselineFiles, () => false), /Unsafe Excel overlay/);
});

test('Entry derives only two insertions from deployed baseline and preserves all other report gates', () => {
  const withoutInsertions = entry.replace("import CentralExcelReportWorkspace from './CentralExcelReportWorkspace';\n", '')
    .replace("  if (props.surface === 'dashboard' || props.surface === 'summary') return <CentralExcelReportWorkspace surface={props.surface} initialProjectName={projectName} />;\n", '');
  assert.equal(withoutInsertions, baselineEntry.replaceAll('\r\n', '\n'));
  assert.ok(entry.indexOf("if (mode === 'legacy')") < entry.indexOf('<CentralExcelReportWorkspace'));
  assert.ok(entry.indexOf("if (props.surface === 'dashboard' && !props.active) return null") < entry.indexOf('<CentralExcelReportWorkspace'));
  assert.ok(entry.indexOf("if (mode === 'blocked')") < entry.indexOf('<CentralExcelReportWorkspace'));
  assert.equal(entry.includes('SalesReportsWorkspace'), false);
  assert.equal(entry.includes('useSalesReportsEnabled'), false);
  assert.equal(entry.includes("surface === 'owner') return <CentralExcelReportWorkspace"), false);
});

test('override rejects dirty Entry, changed guard and absent baseline; normal files have no override', () => {
  assert.throws(() => excelSourceOverride(EXCEL_ENTRY_PATH), /requires/);
  assert.throws(() => excelSourceOverride(EXCEL_ENTRY_PATH, baselineEntry.replace("mode === 'blocked'", "mode === 'legacy'")), /baseline mismatch/);
  assert.throws(() => excelSourceOverride(EXCEL_ENTRY_PATH, readFileSync(resolve(root, EXCEL_ENTRY_PATH), 'utf8')), /baseline mismatch/);
  assert.equal(excelSourceOverride('app/page.tsx'), null);
  assert.equal(excelSourceOverride(EXCEL_ENTRY_PATH, baselineEntry.replaceAll('\n', '\r\n')), entry);
});

test('overlay static and literal dynamic local imports resolve inside the selected baseline plus overlay', () => {
  const missing = [];
  for (const file of EXCEL_OVERLAY) {
    const source = ts.createSourceFile(file, body(file), ts.ScriptTarget.Latest, true);
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
