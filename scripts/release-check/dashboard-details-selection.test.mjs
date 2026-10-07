import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { DETAILS_BASELINE, DETAILS_OVERLAY, DETAILS_TEST_FILES, selectedDetailsFiles } from './dashboard-details-selection.mjs';
import { includeSource, releaseArguments } from './check.mjs';

test('data connection release pins current production and exactly 14 files', () => {
  assert.equal(DETAILS_BASELINE, 'ebde3bdf459ec2a1015925fd56ecc67577e2b819');
  assert.equal(DETAILS_OVERLAY.length, 14);
  assert.equal(new Set(DETAILS_OVERLAY).size, 14);
  for (const file of ['app/page.tsx', 'package.json', 'lib/sales/releaseScope.ts', '.env.local', 'sql/sales/excel_booking_amounts_draft.sql']) {
    assert.equal(DETAILS_OVERLAY.includes(file), false);
  }
  assert.equal(DETAILS_TEST_FILES.length, 10);
  assert.equal(releaseArguments(['--dashboard-details'], process.cwd()).candidate, 'details');
  assert.throws(() => releaseArguments(['--dashboard-details', '--source', process.cwd()], process.cwd()));
});
test('bounded selection rejects private artifacts and covers local imports', () => {
  const root = process.cwd();
  const baseline = execFileSync('git', ['ls-tree', '-rz', '--name-only', DETAILS_BASELINE], { encoding: 'utf8' }).split('\0');
  const selected = selectedDetailsFiles([...baseline, '.env.local', 'app/../private.ts', 'backup.sql'], includeSource);
  for (const file of ['.env.local', 'app/../private.ts', 'backup.sql']) assert.equal(selected.includes(file), false);
  for (const file of DETAILS_OVERLAY) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const name = node.moduleSpecifier.text;
        if (name.startsWith('.') || name.startsWith('@/')) {
          const target = name.startsWith('@/') ? name.slice(2) : resolve(dirname(file), name).slice(root.length + 1).replaceAll('\\', '/');
          assert.ok(['', '.ts', '.tsx', '.js', '.mjs', '/index.ts'].some(suffix => selected.includes(target + suffix)), `${file}: ${name}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
