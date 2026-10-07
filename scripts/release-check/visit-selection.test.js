// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { buildEnvironment, includeSource, releaseArguments } from './check.mjs';
import { VISIT_BASELINE, VISIT_OVERLAY, VISIT_RUNTIME_FILES, selectedVisitFiles } from './visit-selection.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const git = args => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const baselineFiles = git(['ls-tree', '-rz', '--name-only', VISIT_BASELINE]).split('\0');
const files = selectedVisitFiles(baselineFiles, includeSource);
const body = file => VISIT_OVERLAY.includes(file) ? readFileSync(resolve(root, file), 'utf8') : git(['show', `${VISIT_BASELINE}:${file}`]);

describe('selected Visit release snapshot', () => {
  it('pins baseline and selects no credentials, SQL or arbitrary source', () => {
    expect(VISIT_BASELINE).toBe('7499cdd638bc2ff0c33b3ece4d8b0f1e8e7ed857');
    expect(releaseArguments(['--central-visits'], root)).toEqual({ releaseScope: 'central_visits', source: root });
    expect(() => releaseArguments(['--central-visits', '--source', root], root)).toThrow();
    expect(files.some(file => /\.sql$|\.env|customer.*xlsx/.test(file))).toBe(false);
    expect(new Set(VISIT_OVERLAY).size).toBe(VISIT_OVERLAY.length);
  });
  it('retains deployed account, construction, global wrappers and excluded workflow implementations', () => {
    for (const file of ['app/page.tsx', 'app/layout.tsx', 'app/sales-crm/[customerId]/page.tsx',
      'components/LoginView.tsx', 'hooks/useBuildTrackData.ts', 'components/admin/AdminUsersView.tsx',
      'components/sales/LeadWorkView.tsx', 'components/sales/NotificationsView.tsx',
      'components/sales/SalesReportingEntry.tsx', 'lib/sales/workflow.ts']) {
      expect(files).toContain(file); expect(VISIT_OVERLAY).not.toContain(file);
    }
    expect(VISIT_RUNTIME_FILES.some(file => /interests\/|post-booking\/|reports\/|queue-monitor\//.test(file))).toBe(false);
  });
  it('sets only intended synthetic features and strips real credentials', () => {
    const env = buildEnvironment({ DATABASE_URL: 'secret', SALES_CRM_NOTIFICATIONS_ENABLED: 'true' }, root, 'central_visits');
    expect(env.SALES_CRM_RELEASE_SCOPE).toBe('central_visits');
    for (const flag of ['VISITS', 'VISIT_SOP', 'CUSTOMER_VOICES', 'VISIT_FOLLOW_UP']) expect(env[`SALES_CRM_${flag}_ENABLED`]).toBe('true');
    for (const flag of ['SCHEDULE', 'NOTIFICATIONS', 'SLA_PREVIEW', 'QUEUE_MONITOR', 'POST_BOOKING', 'PROJECT_INTERESTS']) expect(env[`SALES_CRM_${flag}_ENABLED`]).toBe('false');
    expect(env).not.toHaveProperty('DATABASE_URL');
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:1');
  });
  it('selects only import-plus-gate changes in deployed deferred pages and adapters', () => {
    const guards = [...['notifications', 'work-schedule', 'sla-preview', 'sla-processing'].map(name => `app/sales-crm/${name}/page.tsx`),
      ...['notification', 'workSchedule', 'slaPreview', 'slaCycle', 'slaReceipt', 'slaProcessing'].map(name => `lib/sales/${name}Server.ts`)];
    for (const file of guards) {
      const source = body(file).replaceAll('\r\n', '\n');
      expect(source).toContain('!extendedSalesReleaseAllowed() ||');
      const unpatched = source.replace(/^import \{ extendedSalesReleaseAllowed \} from ['"][^'"]+['"];\n/m, '')
        .replace('!extendedSalesReleaseAllowed() || ', '');
      expect(unpatched).toBe(git(['show', `${VISIT_BASELINE}:${file}`]).replaceAll('\r\n', '\n'));
    }
  });
  it('adds only the pinned QR package pair to package metadata', () => {
    const prior = JSON.parse(git(['show', `${VISIT_BASELINE}:package.json`]));
    const selected = JSON.parse(body('package.json'));
    prior.dependencies.qrcode = '1.5.4'; prior.devDependencies['@types/qrcode'] = '1.5.6';
    expect(selected).toEqual(prior);
    const lock = JSON.parse(body('package-lock.json'));
    expect(lock.packages[''].dependencies).toEqual(selected.dependencies);
    expect(lock.packages[''].devDependencies).toEqual(selected.devDependencies);
  });
  it('all overlay static and literal dynamic local imports resolve within the selected snapshot', () => {
    const missing = [];
    for (const file of VISIT_OVERLAY.filter(file => /\.[jt]sx?$/.test(file))) {
      const source = ts.createSourceFile(file, body(file), ts.ScriptTarget.Latest, true);
      const visit = node => {
        let spec;
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) spec = node.moduleSpecifier.text;
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) spec = node.arguments[0].text;
        if (spec?.startsWith('.') || spec?.startsWith('@/')) {
          const candidate = spec.startsWith('@/') ? spec.slice(2) : resolve(root, dirname(file), spec).slice(root.length + 1).replaceAll('\\', '/');
          if (![candidate, ...['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx'].map(suffix => candidate + suffix)].some(path => files.includes(path))) missing.push(`${file}: ${spec}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(missing).toEqual([]);
  });
});
