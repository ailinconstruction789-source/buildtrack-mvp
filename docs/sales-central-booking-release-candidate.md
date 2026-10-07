# Central Lead + project booking: bounded release candidate

29 September 2026. **Subsequently deployed, imported and activated in the bounded scope.** Target: `kbthmdedilswdmmczfay`, app `https://buildtrack-mvp-79c5.vercel.app/`. The sections below retain preparation evidence and original gates; installed state, migration versions, counts and outstanding real-session acceptance are in `docs/sales-central-release-execution-2026-09-29.md`. Do not replay these one-shot candidates.

**Construction conflict resolved separately on 29 September after explicit user approval:** the live completion function no longer turns occupied plots into `transferred`; sales transfer remains separate. Exact live-chain synthetic regression passed, and the tested function-only migration was applied and verified in production as `20260929093340`. CRM installation/import/app deployment and activation have **not** occurred. See `docs/sales-construction-compatibility-blocker-2026-09-29.md` for hashes, tests and limitations. Preserve this repaired function; never weaken the stock guard or restore the old auto-transfer rule to bypass compatibility checks.

## Scope and live observation

- Central Lead receives one customer, optionally interested in multiple projects. A confirmed booking links the same customer to a project/plot; project pages do not become another Lead registry.
- Source boundary is Google Sheets row **2 through 966 inclusive**, including hidden rows. Row 1 is a header. Rows 967 onward are excluded. Historical missing phone, money, exact event times and round numbers remain unknown. No loss of cancellation history.
- Notifications, Cron, SLA processing, visits/QR, broader lifecycle, post-booking commands and aggregate/KPI reporting are not part of this release.
- Read-only production metadata/count check at `2026-09-29T07:55:30.975764Z`: 895 legacy Leads, 289 sales, 306 plots, zero voices; PostgreSQL 17.6. `sales_customers` and `crm_external_private` absent; account guard present. This is a point-in-time observation, not a cutover baseline or backup certification.
- Existing plot RLS/grants are broad. This package does not broaden them or attempt unrelated security remediation. Construction pause/resume continues through the same policies; the added guard protects stock/transfer state and prevents silently moving a historically referenced plot to another project.

## Exact commands-install candidate

`supabase/migrations/20260929080153_central_booking_commands_candidate.sql` is produced by the pure `scripts/sales-runtime/central-booking-candidate.mjs` assembler. It contains the exact LF-normalized hashes and bodies of companions **04, 05, 18, 19, 22** and `external_booking_writer_draft.sql`. Tests compare the saved candidate byte-for-byte to the assembly. The design drafts retain their original refusal/rollback guards.

This candidate is **not the whole initial installation**. It requires the sealed CRM foundation, reviewed source staging/materialization, booking preparation, sales replacement and private history-evidence reader already installed with valid receipts. The prerequisite schema package is now prepared and rehearsed below; the reviewed data operations and full live-schema compatibility gates still precede live execution. Never run the design drafts directly and never `db push` the whole migrations directory: installed account migration timestamps differ.

The candidate:

1. Requires explicit operator authority and nonempty backup/app/review evidence references. A setting alone is an attestation, not verification of the server or app.
2. Binds the existing snapshot batch, workbook SHA256 and plan digest to the cutover receipt; rejects rolled-back batches and rechecks current approved identities.
3. Requires the combined recorded and skipped source-row numbers to equal **exactly 2..966**. Missing, repeated or out-of-range rows stop installation. Empty rows may be accounted for as skipped; this never invents a customer.
4. Installs companions and seals inherited/public execution privileges in **one transaction**. `lock_timeout=2s`, `statement_timeout=30s`, PostgreSQL 17 `transaction_timeout=30s`. If busy, abort and review timing; do not loosen the limits automatically.
5. Verifies existing sale/customer/interest data remains unchanged apart from newly generated revision columns. Verifies whole plots/projects/leads/voices and existing table owners, ACLs and RLS switches remain unchanged.
6. Leaves all feature switches and new command/search grants closed. There is **no activation call**, source import, role seed, Cron scheduling or deployment in this file.

Required session settings use the `buildtrack.booking_commands_` prefix: `release=central_booking_rows_2_966_v1`, `project=kbthmdedilswdmmczfay`, `batch`, `source_sha256`, `plan_digest`, `backup`, `app_review`, `review`. Do not copy synthetic evidence values from test code into production.

Activation remains a separate reviewed `enable_booking_writer` transition. It revalidates current identity, sale and stock baselines, retires legacy sale DML, and reopens only the central intake/search, booking and project-read allowlist. Native and imported `resume_follow_up` remain closed. Earlier selective replacement rollback intentionally refuses once this operational schema/new work exists; do not disable its checks or restore the shared database wholesale.

## External-data schema package and refreshed source

`supabase/migrations/20260929082516_central_booking_external_data_candidate.sql` installs the exact five external staging, CRM bridge, booking preparation, selective replacement and private evidence drafts in one sealed transaction. The pure assembler is `scripts/sales-runtime/external-data-candidate.mjs`. It requires the empty/disabled sealed foundation and explicit operator/backup/review attestations. It does not seed identities, stage source data, replace sales or activate APIs. It uses 2-second lock and 30-second statement/transaction limits, checks shared data/ACL/function/policy preservation and permits only the reviewed foundation sales-guard trigger replacement. Existing pre-cutover booking, cancellation, transfer, construction pause/resume and survey operations were exercised in the synthetic database.

Exact saved-package rehearsal: `node_modules/.cache/buildtrack-sales-runtime/runs/run-Qo5zZ4/report.json`, status **passed**, owned cluster **stopped**. External-schema 27 checks, CRM bridge 48, booking preparation 34, selective replacement 28, evidence 27, writer 69, plus account/foundation suites. Unit subset: 38 tests across 6 files passed. These counts overlap earlier coverage; do not sum them as unique cases. Scoped ESLint passed.

Required order is **foundation → external-data schema → reviewed source/data operations → commands candidate → checked activation**. Migration filenames alone are not the deployment order: the external-data timestamp is later than the commands timestamp. Never deploy by directory-wide `db push`.

The real workbook was refreshed read-only on 29 September and frozen locally. The bounded plan covers exactly 965 source rows (2..966), proposing 958 eligible customers and 303 eligible booking-history entries. Held rows remain in preserved source evidence, not discarded. Details, hashes, comparison limitations and private artifact location are in `docs/sales-source-refresh-2026-09-29.md`. The refresh is not a real import or live backup. Source-review/inventory tests: **161 tests / 6 files passed**; source-refresh scripts passed scoped ESLint.

## App boundary

Set server-only `SALES_CRM_RELEASE_SCOPE=central_booking` for the bounded app deployment. The six dependency flags below must be `true`:

- `SALES_CRM_V2_ENABLED`
- `SALES_CRM_LEAD_WORK_ENABLED`
- `SALES_CRM_LIFECYCLE_ENABLED`
- `SALES_CRM_BOOKING_ENABLED`
- `SALES_CRM_PROJECT_SALES_ENABLED`
- `SALES_CRM_PROJECT_WORKSPACE_ENABLED`

Lead-work/lifecycle flags are internal booking dependencies, **not permission to open their user workflows**. Scope blocks their direct APIs/pages and report/post-booking surfaces, hides unfinished links, and prevents legacy writer fallback when the explicit bounded configuration is incomplete. Unknown nonempty scopes fail closed. Unset/empty scope preserves the pre-existing behavior. Keep all other Sales flags false, especially schedules, notifications, workers/dispatchers, queue monitor, visits, interests, SOP and Customer Voices. Do not alter existing account-login/Admin deployment flags without their own compatibility review.

Configure flags for the actual Vercel build and runtime together, then redeploy; server-rendered/static pages must not be assumed to pick up a changed environment instantly. No `NEXT_PUBLIC_` release scope and no service-role key in the browser.

Central GET uses **SQL22 central search**, not only the older snapshot RPC. The commands package now includes/seals/grants both search functions. The interested-plot picker still uses the existing authenticated `plots` and `sales` reads: verify those with the actual Sales session during acceptance, not just SQL role tests.

## Verified locally

- Exact candidate and real book/cancel/search RPCs in native PostgreSQL 17.11: `node_modules/.cache/buildtrack-sales-runtime/runs/run-HlGFhW/report.json`, **69 writer checks**, plus 28 replacement checks and imported evidence/account/foundation/identity/preparation suites. Completed with the owned cluster stopped. Covers source/plan binding, late-failure atomic rollback, initially sealed APIs, trusted sessions, cancellation history, concurrent booking, unknown historical fields, search parsing, construction pause/resume, and prevention of manual occupancy/transfer/project moves.
- Frontend/API plus initial candidate regression: **319 tests / 10 files passed**. Updated package/runtime boundary checks: **22 tests / 3 files passed**. Counts overlap and should not be added as distinct coverage. Full TypeScript check and scoped ESLint passed.
- These database checks are synthetic, not successful Supabase Auth/PostgREST/browser acceptance or production installation. The separately refreshed real workbook was reconciled offline only, not loaded into the synthetic database.

Bounded production-mode build `app-JxYLTk` passed type generation, full typecheck, webpack build and static generation **19/19**, with `sourceFilesUnchanged=true`, `realCredentialsLoaded=false`, `productionChanged=false`, `deployed=false`. Scoped ESLint passed. The local snapshot server passed **12 HTTP smoke checks**: central page returns 200, closed work/report pages display their disabled notices, development directory returns 404, central/booking/project APIs require authentication (401), excluded work/lifecycle/report/post-booking/notification APIs return FEATURE_DISABLED (503), and all checked APIs return `Cache-Control: no-store`. No authenticated happy-path browser test or visual acceptance is claimed. Build warnings concern the snapshot's extra lockfile/workspace-root inference; no project lockfiles were removed.

Credential-free app build command: `node scripts/release-check/check.mjs --central-booking`. It copies source to a new local release-check directory, excludes application `.env`/SQL/customer sheets, sets a loopback-only synthetic Supabase endpoint, and builds the actual bounded scope with the existing low-memory/offline-font profile. Its server launcher reuses the same scope. It is not the default Vercel Turbopack build and does not certify real login.

## Remaining release gates

1. Rehearse the now-packaged installers against the current complete shared schema; refresh backup evidence and the cutover baseline. Synthetic minimal fixtures do not certify every production dependency.
2. Use the frozen source-bound plan, fresh account bindings and reviewed recovery procedure for the actual staged import transactions. Recheck live account/plot/schema drift immediately before execution; do not reuse expired preflight evidence. Held rows remain preserved. No additional source/customer decision is needed from the present refresh.
3. Review/select and deploy the matching scoped app, perform the bounded database install/import/activation, then verify Admin/Sales access, available plots, booking linkage/history and other departments on the real app. Record actual results; do not treat local test counts as this gate.

The main worktree contains substantial pre-existing changes. An all-source local build is not permission to stage or push everything; select and review the release dependency set while preserving unrelated work.

No additional business-rule answer is currently needed from the user for these local preparation steps. A changed source decision, identity conflict or maintenance-window dependency must be raised with concrete evidence before proceeding.
