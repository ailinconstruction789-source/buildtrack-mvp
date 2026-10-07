// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const runner = readFileSync(resolve('scripts/sales-runtime/run.mjs'), 'utf8');
const harness = readFileSync(resolve('scripts/sales-runtime/central-visits-candidate-runtime.mjs'), 'utf8');

describe('installed-chain local Visit rehearsal entry point', () => {
    it('documents the mode without creating or connecting a cluster', () => {
        const result = spawnSync(process.execPath, ['scripts/sales-runtime/run.mjs', '--help'], { encoding: 'utf8', windowsHide: true });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('--central-visits-candidate-only');
        expect(result.stdout).not.toContain('Initializing');
        expect(runner.indexOf("options[0] === '--help'")).toBeLessThan(runner.indexOf('mkdtempSync(join(cache'));
    });
    it('adds to the exact external/import/booking chain, not a reduced standalone fixture', () => {
        expect(runner).toContain("const externalDataCandidateOnly = centralVisitsCandidateOnly || options.at(-1) === '--external-data-candidate-only'");
        expect(runner.indexOf('report.results.centralVisitsCandidate =')).toBeGreaterThan(runner.indexOf('report.results.externalBookingWriter ='));
        expect(harness).not.toMatch(/syntheticDraftBody|04_lead_work_foundation_draft\.sql|05_lead_lifecycle_draft\.sql/);
        expect(harness).toContain('assembleCentralVisitsCandidate(sources)');
    });
    it('retains local identity guard, protected source comparison and final shape checks', () => {
        expect(harness).toContain("session_user ~ '^runtime_[a-f0-9]+$'");
        expect(harness).toContain("inet_server_addr()='127.0.0.1'::inet");
        expect(harness).toContain("assert.equal(interest.engagement_status, 'legacy_unclassified')");
        expect(harness.match(/assert\.equal\(await query\(protectedState\), baseline\)/g)).toHaveLength(2);
        expect(runner).toContain('assertReviewedSharedShape(JSON.parse(await query(sharedShapeQuery)), { allowCrmAdditions: true })');
        expect(runner).toContain('await stopOwnedCluster();');
    });
    it('checks a true walk-in through the installed commands and parses all new snapshots', () => {
        expect(harness).toContain("appointmentId: null, expectedAppointmentRevision: null, reason: 'SYNTHETIC actual walk-in without appointment'");
        expect(harness).toContain("rpc(owner, 'crm_v2_visits_command', walkPayload, walkRequest)");
        expect(harness).toContain('assert.equal(walk.appointmentId, null)');
        expect(harness).toContain('walk-in completed SOP remains awaiting Customer Voices');
        expect(harness).toContain('parsers.sop(walkSopRead');
        expect(harness).toContain('parsers.voice(walkCompleted');
        expect(harness).toContain('parsers.visits(allVisits');
        expect(harness).toContain('without inventing appointment history');
    });
    it('uses rollback-only expired synthetic tokens while retaining all guard functions', () => {
        expect(harness).toContain("clock_timestamp()-interval '25 hours',clock_timestamp()-interval '1 hour'");
        expect(harness).toContain("request(owner, walkVoiceSql, expiredSetup).replace(/COMMIT;$/, 'ROLLBACK;')");
        expect(harness).toContain('BEGIN; ${expiredSetup} SET LOCAL ROLE anon; ${sql} ROLLBACK;');
        expect(harness).toContain('expired probes roll back token fixture and leave no survey or completion history');
        expect(harness).toContain('parsers.voice(expiredRead');
        expect(harness).not.toMatch(/DISABLE\s+TRIGGER|session_replication_role|CREATE\s+OR\s+REPLACE\s+FUNCTION|UPDATE\s+sales_private\.visit_submission_tokens|UPDATE\s+public\.crm_settings/i);
    });
    it('rotates via actual issue command and requires rejected QR not to complete Visit', () => {
        expect(harness).toContain('expectedTokenId: firstIssued.tokenId');
        expect(harness).toContain("rpc(owner, 'crm_v2_customer_voices_command', rotatePayload, rotateRequest)");
        expect(harness).toContain('rotation and exact retry retain two tokens with only the replacement active');
        expect(harness).toContain('rotated old QR cannot ${label}');
        expect(harness).toContain('rejected old QR leaves walk-in awaiting valid submission');
        expect(harness).toContain('replacement QR completes the exact walk-in once without optional personal defaults');
    });
    it('runs the independent rollback rehearsal only after protected imported-state comparison', () => {
        expect(harness.indexOf('const disabled = await runCentralVisitsDisableRuntime')).toBeGreaterThan(harness.lastIndexOf('assert.equal(await query(protectedState), baseline)'));
        expect(harness).toContain('expiredQrRollbackProbeTested: true, rotatedQrTested: true, disabled');
    });
});
