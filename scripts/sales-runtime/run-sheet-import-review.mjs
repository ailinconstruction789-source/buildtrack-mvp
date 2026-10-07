// Local read-only review. The child's raw data is captured in memory, never logged.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { prepareSheetImportReview, summarizeSheetImportReview } from './sheet-import-review.mjs';
import { reviewedSheetDates } from './sheet-date-review-20260929.mjs';
import { reviewedSheetOwners } from './sheet-owner-review-20260929.mjs';
import { reviewSheetRelationships } from './sheet-relationship-review.mjs';
import { reviewedSheetProjects } from './sheet-project-review-20260929.mjs';
import { reviewedSheetPlots } from './sheet-plot-review-20260929.mjs';
import { reviewedSheetIdentities } from './sheet-identity-review-20260929.mjs';
import { reviewSheetIdentityDecisions } from './sheet-identity-decisions.mjs';
import { reviewedPendingRows } from './sheet-pending-review-20260929.mjs';
import { prepareSheetSnapshotPlan, summarizeSheetSnapshotPlan } from './sheet-snapshot-plan.mjs';
import { reviewBookingInventory } from './booking-inventory-review.mjs';

try {
    const { values } = parseArgs({ options: {
        python: { type: 'string' }, source: { type: 'string' }, sha256: { type: 'string' },
        'snapshot-date': { type: 'string' }, 'approved-dates-20260929': { type: 'boolean', default: false },
        'approved-owners-20260929': { type: 'boolean', default: false },
        'relationship-catalog': { type: 'string' },
        'approved-projects-20260929': { type: 'boolean', default: false },
        'approved-plots-20260929': { type: 'boolean', default: false },
        'approved-identities-20260929': { type: 'boolean', default: false },
        'snapshot-plan': { type: 'boolean', default: false },
        'booking-inventory': { type: 'string' },
    }, strict: true, allowPositionals: false });
    if (!values.python || !values.source || !/^[a-f0-9]{64}$/.test(values.sha256 ?? '')
        || !/^\d{4}-\d{2}-\d{2}$/.test(values['snapshot-date'] ?? '')) throw new Error('REVIEW_ARGUMENTS_REQUIRED');
    const extraction = spawnSync(values.python, [fileURLToPath(new URL('./read-customer-sheet.py', import.meta.url)),
        '--source', values.source, '--sha256', values.sha256, '--snapshot-date', values['snapshot-date']], {
        encoding: 'utf8', shell: false, windowsHide: true, timeout: 60000, maxBuffer: 32 * 1024 * 1024,
    });
    if (extraction.error || extraction.status !== 0) throw new Error('CUSTOMER_SHEET_EXTRACTION_FAILED');
    const draft = prepareSheetImportReview(JSON.parse(extraction.stdout),
        values['approved-dates-20260929'] ? reviewedSheetDates : null,
        values['approved-owners-20260929'] ? reviewedSheetOwners : null);
    let report = values['relationship-catalog']
        ? reviewSheetRelationships(draft, JSON.parse(readFileSync(values['relationship-catalog'], 'utf8')), undefined,
            values['approved-projects-20260929'] ? reviewedSheetProjects : null,
            values['approved-plots-20260929'] ? reviewedSheetPlots : null)
        : summarizeSheetImportReview(draft);
    if (values['approved-identities-20260929']) report = reviewSheetIdentityDecisions(report, reviewedSheetIdentities);
    if (values['booking-inventory']) report = reviewBookingInventory(
        prepareSheetSnapshotPlan(draft, report, reviewedPendingRows),
        JSON.parse(readFileSync(values['booking-inventory'], 'utf8')));
    else if (values['snapshot-plan']) report = summarizeSheetSnapshotPlan(prepareSheetSnapshotPlan(draft, report, reviewedPendingRows));
    process.stdout.write(`${JSON.stringify(report, null, values['relationship-catalog'] ? 0 : 2)}\n`);
} catch {
    // Never echo raw extraction, file paths or arbitrary source content on errors.
    process.stderr.write('SHEET_REVIEW_FAILED: check source hash, headers, catalog, arguments and reviewed bindings.\n');
    process.exitCode = 1;
}
