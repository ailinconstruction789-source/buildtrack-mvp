# Visit / SOP / Customer Voices — bounded local preparation

## Status and authority

User confirmed the next scope: appointments/check-in, house preparation/tour/close SOP, and per-Visit Customer Voices QR. This checkpoint is **local preparation only**, not a complete or deployable release. No production SQL, environment changes, grants, activation, customer writes, Git push or deployment in this turn. Existing production remains the central-booking/map release at `7499cdd638bc2ff0c33b3ece4d8b0f1e8e7ed857`.

Prior read-only metadata check found none of the 14 requested public visits/SOP/voices/project-interest routines installed. Do not mistake existing local drafts or mocked tests for production availability.

## Local changes completed

- Added explicit candidate scope `central_visits`. Central intake/booking/project maps remain allowed; Visit, SOP and Voices require this scope (or the previous unscoped local opt-in), exact individual flags, authenticated role checks and existing database capability versions. Current `central_booking`, unknown or misspelled scopes reject all seven Visit/SOP/staff-public Voice endpoints before constructing a database client.
- Central tracker receives a server-computed `visitsEnabled` prop. Each existing interest gets its own customer/interest-scoped Visit link, independently of the closed lead-work screen. No duplicate Lead creation, implicit project choice or generic project-specific Lead page. Links remain hidden by default and while the new-Lead form is open. Links may read history for closed interests; write authorization remains in the target workflow and database.
- SOP response parsing now accepts a database-authorized active Sales owner's **new appointment/Visit** when the imported engagement classification is `legacy_unclassified`. It retains the unknown value and does not invent a past SOP, Visit, answer, date or status. Wrong owner, Admin/Owner-as-writer, Lost, cancelled anchors and completed runs remain guarded. This aligns with SQL25's existing `canWrite` calculation; it does not grant a database permission.
- General follow-up/lifecycle/post-booking/report routes are not enabled by this candidate scope. Central navigation keeps schedule/notifications/SLA/queue links off. The subsequent local checkpoint below adds only a dedicated project-scoped next-action dependency. This is not certification of every deferred direct endpoint: a complete selected-release manifest and endpoint denial audit remain necessary before deployment.

## Confirmed installed-chain incompatibilities — do not bypass

| Area | Evidence in reviewed local deployment source | Required next work |
| --- | --- | --- |
| Activation seal | `20260929082516_central_booking_external_data_candidate.sql`, `reject_unreviewed_activation`; booking candidate `booking_activation_allowed` admits only central/booking dependency flags | Separate reviewed, transaction-permitted Visit activation path; retain deny-by-default behavior and all existing booking flags |
| Voice writes | Sealed foundation `crm_foundation_legacy_fields_sealed` trigger covers `customer_voices`; SQL26 inserts new V2 fields | Replace/adapt only the Voice seal with the reviewed Voice transaction permit, preserving legacy and rejecting direct writes |
| SOP close | SQL25 Stage C requires an open, future-dated, same-interest/current-owner next action; lead-work RPC grants and app route remain closed | Add narrowly bounded next-action read/set support; do not remove the SOP requirement or open every lifecycle command |
| Imported lifecycle | External `guard_materialized_history` rejects imported customer/interest updates except the existing booking permit | Preserve imported identity/history seals. Do not open lifecycle incidentally because its dependency flag is already true |
| Existing component coupling | Lead detail chooses lifecycle context from the lifecycle flag | Use a dedicated follow-up entry or explicit capability split; do not route the new workflow through a disabled lifecycle screen |

SQL23 → SQL25 → SQL26 are the functional chain, but remain DESIGN ONLY drafts with rollback guards. Do not run them directly or reinstall the foundation/SQL04/05. SQL24 is not a database dependency; adding a project later to an initially projectless Lead needs a separately selected UX/database step. Current new entry only targets existing interests.

## Next bounded implementation and acceptance

1. Prepare the restricted follow-up dependency for SOP using existing next-action records, without notifications, SLA processing, KPI, lifecycle, or post-booking expansion.
2. Build a candidate against the actual installed foundation + external identity/import + booking chain, adapting the two seals above. No old-customer data replacement or new import.
3. Rehearse locally with synthetic imported unknown-status identities, new appointments and walk-ins, Sales-only SOP, required next action, 8 explicit survey scores, optional personal data, 24-hour QR expiry, token rotation, replay and concurrency. Verify no fabricated historical evidence and unchanged booking/construction behavior.
4. Validate the selected application build, complete direct-route/role denial matrix and browser journey before requesting a separate real-database installation/activation decision.

## Verification

- Before edits: 137 tests / 4 files passed.
- After edits: focused boundary/contract/server/navigation checkpoint, 220 tests / 7 files passed.
- Broader visits/SOP/voices component, contract, client, pending and server suite: **451 tests / 23 files passed**, one worker, 74.16 seconds. Includes the final imported-status server regression.
- Separate non-overlapping public Voice form/page and existing map regression suite: **50 tests / 4 files passed**, 25.21 seconds. Combined final unique coverage: **501 tests / 27 files**. Earlier checkpoints are not added again.
- Scoped ESLint passed. Tracked-file whitespace check passed (some files were already untracked, so Git's check does not cover those).
- Whole-workspace TypeScript `--noEmit --incremental false` passed with a process-local 1152 MB heap limit. Existing release worktree remains clean and unchanged. No production build, browser E2E, native database rehearsal, PostgREST or real-account workflow acceptance was run for this new candidate.

The Supabase skill guided the separation of local preparation from real activation and preservation of caller-JWT/capability checks. Official changelog and Auth getUser documentation were checked; no SDK upgrade or Auth method change was required for this local application-boundary change.

## Subsequent checkpoint — bounded next-action and installed-chain rehearsal

This section supersedes the earlier "next implementation" items only where explicitly verified below. The earlier test totals refer to the preceding checkpoint, not to the new changes. Production scope and authorization remain unchanged.

### Narrow follow-up entry

- Added `/sales-crm/visit-follow-up` and `/api/sales-crm/visit-follow-up`, requiring both customer and project-interest IDs. The SOP screen links to this entry only when enabled and no SOP command is pending.
- Requires `visitSopEnabled()` and exact server flag `SALES_CRM_VISIT_FOLLOW_UP_ENABLED=true`. The existing `central_booking` release still rejects this entry. No environment file was changed.
- Only current Sales owner may set or replace the next action. Admin/Owner may read; no Admin override, contact-attempt, reassignment, Lost or generic lifecycle operation is exposed. The original generic route remains sealed in `central_visits`.
- Shares the existing request receipt and same-request retry protocol. A recovered generic contact-attempt receipt blocks safely without deletion. Form mode defaults to its original behavior everywhere else.
- Narrow snapshots explicitly validate Sales-only write authority. Actual account changes hide stale UI, and reads recheck session identity before rendering; session data does not authorize database access. Server verification and database role/ownership checks remain authoritative.

### Additive database candidate

- `sql/sales/deployment/central_visits_candidate.sql` assembles guarded SQL23/25/26 and the narrow adapter. The original installed foundation/import/booking migrations are unchanged; SQL04/05 are not reinstalled.
- **Local synthetic only:** both installation and activation reject non-synthetic database/user names, non-loopback servers or missing explicit rehearsal markers. This is not a production migration and must not be pasted into Supabase.
- Installation leaves new flags off and new routines sealed, including inherited custom grants. Separate local activation enables only visits/SOP/Voices plus the narrow next-action façade; general lead-work/lifecycle routines remain inaccessible.
- Preserves imported identity/history guards. Adapts only the Voice legacy-field seal with the existing private, exact Visit/Voice transaction permit. Existing legacy survey reads remain usable before activation.
- `--central-visits-candidate-only` rehearses the exact synthetic installed foundation/import/booking chain before the addition, includes late-failure rollback, and stops its owned disposable cluster in cleanup.

### Verification on 30 September 2026

- Combined narrow follow-up, original lead-work, SOP UI/page and additive-candidate tests: **292 tests / 12 files passed**, one worker. Includes the real identity subscription and post-read account-change guard.
- Separate release-boundary, SOP client/server/contracts, public Voice adapter and existing central-booking UI regression: **155 tests / 6 files passed**. Total for these non-overlapping final suites: **447 tests / 18 files**. Scoped ESLint passed on the edited application/test/harness files; tracked-file whitespace checks passed.
- Whole-workspace TypeScript `--noEmit --incremental false` passed with process-local heap capped at 1152 MB.
- Native PostgreSQL 17.11 rehearsal passed at `node_modules/.cache/buildtrack-sales-runtime/runs/run-lpRyi7/report.json`; status `passed`, owned cluster `stopped: true`.
- The new composed Visit suite passed **45 assertions** after the existing account/foundation/import/booking/construction chain. It verified initial sealing and failed-install rollback, Sales-only project-scoped next actions, SOP A/B/C and required future follow-up, check-in remaining incomplete until Customer Voices, 8 required scores with optional personal answers still unknown, exactly 24-hour QR lifetime, simultaneous identical submissions creating only one result, other-Sales response privacy and unchanged source/customer/interest/booking/construction/legacy-Voice/SLA data.
- Shared synthetic legacy shape retained **130 columns and 10 constraints**. This is the reviewed synthetic baseline, not a claim that every production table or live PostgREST policy has been tested.
- The preceding failed run (`run-iSBXb5`) stopped safely. Its failure was the harness trying to parse multiple matching synthetic project interests as one JSON object. The corrected query selects the imported booked-source interest and asserts exactly one match; it does not silently select an arbitrary row or alter application SQL to make the test pass.
- Expired/rotated-token and walk-in variants were **not rerun in this composed candidate**. The completed journey used a scheduled appointment and concurrent identical QR submissions. Do not generalize this checkpoint into complete browser or production acceptance.
- No real Supabase reads/writes, production environment changes, Git push or deployment were performed in this continuation. Release checkout remains clean at `7499cdd638bc2ff0c33b3ece4d8b0f1e8e7ed857`. The new code and candidate remain local and disabled by default.

Browser/selected-release build, complete direct-route/role denial audit, remaining composed variants, real Supabase/PostgREST acceptance and a separate production release decision remain outstanding. Supabase least-privilege guidance kept general lifecycle APIs sealed and limited the new write path to current Sales-owned next actions. Refreshing the changelog in this continuation was unavailable; no Supabase package upgrade or new provider API convention was introduced.

## Subsequent checkpoint — selected build and synthetic browser journey

30 September 2026. This checkpoint is still local only. It supersedes the selected-build and bounded route-audit outstanding items above, not production acceptance.

- Added a `--central-visits` release-check selection built from immutable baseline `7499cdd638bc2ff0c33b3ece4d8b0f1e8e7ed857` plus an explicit, hashed overlay. It does not copy the whole dirty application or modify the release checkout. Manifest: `scripts/release-check/visit-selection.mjs`.
- Closed deferred notification, work-schedule and SLA adapters/pages by release scope even when optional flags are accidentally true. The analogous unpublished queue-monitor/project-interest guards are fixed locally but their new implementations are not selected for release.
- Snapshot `.next/release-check/app-cBYCJY`: 420 files, including 53 runtime/config/package overlays and 30 test/fixture overlays. **1,371 tests / 39 files passed**, type generation, full TypeScript, webpack production compilation, Next final typecheck and static generation 13/13 passed. `sourceFilesUnchanged=true`. Report SHA256: `1460b9cc2c1003999b52659f6ed313769e563e39be062da32334b22b36124a41`.
- Tool boundary tests: 12/12 passed. Main-workspace deferred-module regressions: 873 tests / 14 files passed. Dedicated candidate route/role audit: 215/215 passed. These suites overlap selected coverage; do not add their totals together as unique tests.
- The route audit covers missing/expired sessions, six roles across 15 protected methods, and scope rejection before data access. Allowed-role tests deliberately stop at a missing capability; they do not certify authenticated live data reads/writes.
- Whole-workspace TypeScript without emitting files and scoped ESLint passed after adding the browser harness and route guards.
- Built-snapshot HTTP smoke passed 44 checks (`visit-http-smoke-report.json` in the snapshot; SHA256 `de17e144c525804950b555d32d0bb55c795e16dfb7f023f6d3e8d1e0ce388d14`). Valid protected requests without login return 401, malformed writes 400, deferred APIs 503 and unsupported methods 405; checked errors are no-store. Public survey privacy headers are present. Existing baseline pages respond, development account page is 404. Excluded one-segment Sales URLs match the baseline dynamic customer route and return 200 with the closed notice, not an enabled workspace. Owned built server stopped successfully.

### Browser evidence and limitations

- Used the actual React workflow components in a loopback-only Vite harness at `127.0.0.1:4179`, with injected synthetic APIs. Supabase is replaced with a throwing stub; no application environment is loaded. Source: `browser-tests/visit-workflow-preview/` and `scripts/visit-workflow-preview.mjs`.
- Browser actions completed scheduled appointment → SOP A (16 explicit answers) → check-in → start tour → next action → SOP C (13 explicit answers) → issue QR → public survey → Visit completed. Confirmed Stage B disabled before check-in and Stage C disabled without a next action.
- Confirmed SOP completion and QR issuance leave Visit waiting for Customer Voices. All eight survey scores start blank; blank submission shows validation; eight explicit scores with all optional personal fields blank submit successfully; only then the Visit displays completed. Admin follow-up view shows read-only and no write form. Browser console reported no captured errors at the end of the Sales journey.
- This is functional UI evidence, not live Auth/PostgREST, database authorization, concurrency or full production visual acceptance. Harness styling is simplified, one customer/one Visit is supported, and data persists only in its named synthetic browser storage. A native datetime automation mismatch produced an October appointment-event timestamp in the fixture; no real record was affected and this journey must not be cited as timestamp-validation evidence. Native SQL timestamp/ownership assertions remain the separate source of database evidence.
- Saved visible Visit-completed proof: `.next/release-check/app-cBYCJY/visit-browser-proof.png`. It depicts synthetic data and simplified harness styling, not the deployed app. Browser test tab closed after verification.
- Selected build uses loopback dummy Supabase values, installed dependencies, offline fonts and low-memory webpack. A clean dependency install and Vercel default build were not run. No SQL, real environment changes, Git push or deployment occurred.

Still required before activation: remaining composed walk-in/expired/rotated-token variants; reviewed production-safe additive migration and rollback (the existing candidate intentionally rejects production); real Supabase/PostgREST acceptance under separately confirmed authority; final release/activation decision. No need to re-import or reread customer records for this local checkpoint.

## Subsequent checkpoint — remaining variants and non-destructive disable

30 September 2026. The remaining composed Walk-in/expired/rotated-token variants above are now verified locally. The production installer and real-account acceptance remain outstanding.

- Final exact installed-chain rehearsal passed in PostgreSQL 17.11: `node_modules/.cache/buildtrack-sales-runtime/runs/run-JKyNDQ/report.json`, status `passed`, owned cluster `stopped: true`. This supersedes the earlier smaller disable snapshot in `run-1b9ANg`.
- **60 Visit assertions plus 16 disable assertions passed.** The 60 include previous scheduled-appointment coverage and 15 additional variant/preflight checks; do not add the previous 45 again.
- Walk-in uses the real scoped command, creates no synthetic appointment history, and completes only through a valid survey. Exact check-in retries do not duplicate the Visit. Walk-in SOP and all real response shapes pass the application parsers.
- Expiry is tested with a transaction-local past token under the existing guarded synthetic write permit, then real anonymous open/submit calls. No system clock, TTL, application routine or trigger is changed. Probes roll back, leaving no submitted survey or completion. This is boundary testing, not waiting 24 hours in real time.
- QR rotation uses the real issue command. The old token is revoked and rejected for open/submit, the replacement is the only active token, retry does not create a third token, and only a valid replacement submission completes the exact Visit. Optional personal answers remain unknown.
- Added a **local-only** disable transaction. It validates the database operator and matched Visit/booking/source receipts, uses the existing private booking settings permit, changes only three Visit flags, atomically removes the Voice-policy helper dependency and seals all 15 new public API grants against non-owner roles. It preserves booking dependencies and all collected data.
- Rehearsal includes completed Visits, submitted surveys, an outstanding QR, partial SOP and a future next action before disable. Exact preserved snapshots include checklist items, workflow events, command receipts and Voice submission records. After disable these records remain, the outstanding QR cannot submit, completed evidence is retained, legacy Voice reads work, the booking writer remains ready, and no settings permit survives. Booking context/command definitions and grants are unchanged, and the Sales caller can still read booking context. Authenticated non-operator disable is denied. Repeated disable is safe. An injected late failure restores flags, policy and grants atomically.
- Read-only preflight SQL executed successfully only in the synthetic database. It collects schema/permission/function fingerprints and settings, not customer records. No production metadata was fetched this turn.
- Focused source-boundary and UTF-8 regression tests **23/23 passed across four files**; scoped ESLint passed. No application component, selected release overlay or installation candidate was changed in this checkpoint, so the previous selected application build evidence remains relevant. This does not replace a fresh final release check after future production-artifact changes.
- The expanded snapshot exposed a harness decoding defect in `run-kzBFEi` and diagnostic `run-gGp22D`, both safely stopped. `command()` concatenated raw pipe chunks as strings, which could split a multibyte Thai character in the large JSON response. Diagnostic comparison located the difference at an SOP event's Thai `item_label_snapshot`. Setting stdout/stderr UTF-8 stream decoding fixed it. A 5,000-row Thai JSON regression splits every byte and verifies exact reconstruction. The final native run passes every field comparison without removing fields, suppressing differences or changing application SQL.

The preparation runbook is `docs/sales-visit-installation-and-rollback-2026-09-30.md`. It deliberately identifies the missing production-safe installer, operational disable receipt, reviewed resume procedure, and real PostgREST/concurrent-disable acceptance rather than presenting local-only SQL as ready to paste. No live SQL, customer read/write, environment change, Git push or deployment occurred. Supabase least-privilege guidance shaped the exact-function revocation and policy ordering; the existing booking, identity and construction guards were not weakened.
