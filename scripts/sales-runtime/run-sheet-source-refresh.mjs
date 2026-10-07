// Generates private local import-plan artifacts. Never connects to a database.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { reconcileSheetSourceRefresh } from './sheet-source-refresh.mjs';
import { summarizeSheetSnapshotPlan, assertSameSheetSnapshotPlan } from './sheet-snapshot-plan.mjs';
import { reviewedSheetDates as dates } from './sheet-date-review-20260929.mjs';
import { reviewedSheetOwners as owners } from './sheet-owner-review-20260929.mjs';
import { reviewedSheetProjects as projects } from './sheet-project-review-20260929.mjs';
import { reviewedSheetPlots as plots } from './sheet-plot-review-20260929.mjs';
import { reviewedSheetIdentities as identities } from './sheet-identity-review-20260929.mjs';
import { reviewedPendingRows as pending } from './sheet-pending-review-20260929.mjs';

try {
    const { values } = parseArgs({ options: Object.fromEntries(['python', 'prior-source', 'source', 'sha256', 'snapshot-date', 'catalog'].map(k => [k, { type: 'string' }])), strict: true, allowPositionals: false });
    if (Object.values(values).some(v => !v) || Object.keys(values).length !== 6) throw new Error('REFRESH_ARGUMENTS_REQUIRED');
    const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
    const extract = (path, sha, snapshotDate) => {
        const child = spawnSync(values.python, [join(root, 'scripts/sales-runtime/read-customer-sheet.py'), '--source', path,
            '--sha256', sha, '--snapshot-date', snapshotDate], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
        if (child.status !== 0 || child.error) throw new Error('REFRESH_EXTRACTION_FAILED');
        return JSON.parse(child.stdout);
    };
    const sourceBytes = readFileSync(values.source);
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    if (sourceHash !== values.sha256) throw new Error('REFRESH_SOURCE_HASH_CHANGED');
    const catalogBytes = readFileSync(values.catalog);
    const result = reconcileSheetSourceRefresh({
        prior: extract(values['prior-source'], dates.sourceSha256, '2026-09-28'),
        fresh: extract(values.source, values.sha256, values['snapshot-date']),
        priorCatalog: JSON.parse(readFileSync(join(root, 'docs/sales-plot-catalog-2026-09-29.json'), 'utf8')),
        freshCatalog: JSON.parse(catalogBytes.toString('utf8')), approvals: { dates, owners, projects, plots, identities, pending },
    });
    assertSameSheetSnapshotPlan(result.plan, result.plan.planDigest);
    const base = join(root, 'node_modules/.cache/buildtrack-sales-release');
    mkdirSync(base, { recursive: true });
    const directory = mkdtempSync(join(base, 'source-'));
    // Freeze the exact verified bytes; browser download paths may be temporary.
    // The workbook is a full private source snapshot; the plan alone is bounded.
    writeFileSync(join(directory, 'private-source.xlsx'), sourceBytes, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(directory, 'catalog.json'), catalogBytes, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(directory, 'private-import-plan.json'), JSON.stringify(result.plan), { flag: 'wx', mode: 0o600 });
    const summary = { ...result.receipt, planSummary: summarizeSheetSnapshotPlan(result.plan) };
    writeFileSync(join(directory, 'source-review.json'), JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 });
    writeFileSync(join(directory, 'source-files.json'), JSON.stringify({ source: join(directory, 'private-source.xlsx'), sourceSha256: sourceHash, originalDownload: values.source, priorSource: values['prior-source'], catalog: join(directory, 'catalog.json') }, null, 2), { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ directory, ...summary }, null, 2) + '\n');
} catch (failure) {
    const marker = typeof failure?.message === 'string' && /^[A-Z_]+$/.test(failure.message) ? failure.message : 'REFRESH_PREPARATION_FAILED';
    process.stderr.write(marker + ': source review stopped; no database changes.\n'); process.exitCode = 1;
}
