# External sales replacement and selective rollback

29 September 2026. **Local implementation under test, not a production release.**

The user authorized connecting the sales workflow to production, then explicitly authorized fresh local synthetic PostgreSQL schema and replacement/rollback tests. This is not authorization to restore the whole shared production database or overwrite construction work. No production mutations have been performed in this implementation step.

## Current release scope

Central Lead with the refreshed customer sheet through **row 966 inclusive**, including hidden rows, and project booking linkage only. Row 1 is the header; rows 967 onward are outside this release. Preserve booking/cancellation history and unknown evidence. No separate preview page, notifications, Cron activation or additional reporting rollout. The source cutoff must be enforced again when preparing the fresh release payload; this reader change does not refresh or import the workbook.

### Latest bounded-package follow-up

See `sales-central-booking-release-candidate.md` for the exact commands-install candidate and frontend scope gate. SQL22 search is now included; construction pause/resume remains compatible without granting CRM roles to other departments. Exact candidate native run `run-HlGFhW` passes 69 writer checks, including source-window checks and late-installation rollback, with the owned cluster stopped. This supersedes the older writer-only test description below but does **not** satisfy the remaining live import/deployment gates. No production writes occurred in this follow-up.

## Imported history reader integration — 29 September

- SQL18 booking context and SQL19 project sales now have a shared, private optional provenance reader. Existing/native rows keep their normal numbered rounds. Imported rows may have an unknown round only when evidence resolves to the persisted sale, immutable prepared record, linked customer/interest/plot, and a cutover receipt that has not been rolled back.
- `external_sale_evidence_draft.sql` exposes only source kind, batch, row, source stage and three date-only fields. It is SECURITY INVOKER, has no public/client/default-role execution grants, changes no source or sale data, and retains the DESIGN ONLY guard. The outer role-checked read RPCs remain the authorization boundary; private evidence is not a new public endpoint.
- Both TypeScript response parsers and existing booking/project screens support `importedHistory`. Unknown rounds, prices and event times remain unknown; dates from the source are visibly day-only evidence, not fabricated midnight timestamps. The source row is shown and project history links back to the same central customer. Operator `prepared` / `historyEvidence` responses are still rejected by operational parsers.
- New booking input remains strict; clients cannot submit imported provenance to bypass name/phone, money, revision or permission checks. Imported cancellation is offered only after the separate reviewed writer transition below. Resume remains disabled in that bounded release, and unsupported imported post-booking links stay hidden. Reader compatibility alone never activates the system.
- Frontend/API/contract regression: **224 tests passed across 11 files** (initial suite 222, then the two updated API files passed 42 including two added import-boundary tests); full TypeScript check and scoped ESLint passed. Synthetic external cutover run `run-NMTZoE` passed **27 evidence checks + 55 cutover checks** with `stopped=true`, including the exact optional private SQL18 wrapper and unchanged rollback dependencies. After widening the pre-filter integrity checks, existing public project reader regression `run-QdYX40` passed **71 assertions**, `stopped=true`; runtime-unit checks passed **15/15**. These do not prove the complete imported Auth/PostgREST workflow; the composed operational transition is still required.

## Composed booking writer — local implementation, 29 September

`external_booking_writer_draft.sql` and its exact in-memory synthetic adapter now connect the real booking commands to the import seals. The draft remains DESIGN ONLY / ROLLBACK, not a production installer. `node scripts/sales-runtime/run.mjs --external-booking-writer-only` creates its own fresh loopback database and uses the actual trusted session/role functions, not a replacement role or always-enabled capability shim.

- Order: sealed foundation → reviewed external identity and booking preparation → sales replacement → private source-evidence reader → companions 04/05/18/19/22 → writer guard installation → bounded operator activation. Installing the booking protection trigger before replacement is intentionally rejected.
- Activation rechecks current approved account bindings, exact source-plan digest, original replaced-sale baseline and affected plot stock flags. An immutable writer-release receipt records activation. All inherited/default companion function/table grants are removed; only the central intake/read, booking and project read RPC allowlist is reopened. Unrelated lifecycle APIs and notification processing remain closed.
- Each book/cancel transaction obtains a private permit bound to transaction, backend, actor, customer, project interest, sale and command. It lasts through stock and interest updates, then is removed. Clients cannot create permits. Generic legacy sales DML is retired; active plots have a unique index using the exact legacy-compatible active-sale predicate.
- Imported booked sales can be cancelled with an actual current timestamp, category and reason. Original source stage/days, unknown round, unknown price and identity provenance remain unchanged. Already-cancelled imported rows are immutable. A rebooking appends a new sale referencing its cancelled predecessor; it does not replace it or manufacture unknown historical rounds.
- A private plot trigger protects `has_customer`/`sale_status` against direct legacy changes while preserving construction-only updates. Booking stock changes must agree with the scoped permit and current active sales. Kill-switching CRM does not remove this guard.
- The narrowed external release rejects and hides `resume_follow_up`, including new bookings on imported interests. This prevents the booking command from opening a broader lifecycle path. The screens clarify that numbered rounds are recorded system sequence, not a customer's complete lifetime booking count when old rounds are unknown.
- Once the operational schema or booking data changes, the earlier selective cutover rollback is no longer valid and must fail. Recovery must preserve new work; do not weaken its dependency/after-image checks or restore the shared database wholesale.

The rehearsal includes a genuinely booked source row at ingestion (not a later rewrite of immutable staged history), a source-cancelled predecessor, real Sales sessions, public RPC calls and the actual TypeScript response parsers. It does not refresh the real sheet or certify Supabase Auth/PostgREST/browser integration.

Verified local composition: `node_modules/.cache/buildtrack-sales-runtime/runs/run-X5jdXB/report.json`, PostgreSQL 17.11, `status=passed`, `stopped=true`: **54 writer checks + 28 prerequisite replacement checks + 27 imported-evidence checks**, in addition to the account/foundation/identity/preparation suites. It exercised trusted session revocation, project-owner checks, cancellation/rebooking replay, distinct simultaneous requests, stock release/reservation, immutable imported customer and cancelled history, actual reader/parser compatibility, new central intake without a project, and rejected unsafe old rollback. Six frontend/API/contract files passed **152 tests**; six runtime boundary files passed **43 tests**. No customer source workbook, production mutation or deployment was involved.

Native-only booking regression `run-8dB2pB` also passed **57 history checks + 14 concurrency checks**, `stopped=true`, preserving the pre-existing native flow when the external writer is absent. Full TypeScript checking and scoped ESLint passed. The external-specific resume restriction does not silently change native-only lifecycle behavior.

Pre-activation replacement/rollback regression `run-AIQqbM` passed **55 cutover checks + 27 evidence checks**, `stopped=true`, with the optional writer hooks absent. This verifies that adding the inert hooks does not remove the earlier safe pre-activation rollback; it does not authorize that rollback after operational activation.

## Current evidence

- The Supabase dashboard for `kbthmdedilswdmmczfay` showed a scheduled physical backup at **2026-09-28 20:24:38 UTC / 2026-09-29 03:24:38 Bangkok**. We viewed the list only. Existence of a backup is not a tested restore or a safe rollback of changes made by other departments after that time.
- A read-only production schema check at 2026-09-29 06:39 UTC showed no incoming sales foreign keys in the then-current legacy schema. The sealed CRM foundation itself adds incoming foreign keys; local replacement must account for those too, and production metadata needs a fresh check before release.
- The production sales table has default `sale_price=0`, `booking_amount=0`, and `bank_status='Pending'`. The replacement explicitly supplies unknown values as NULL, rather than treating these defaults as historical evidence.

## Implementation

`sql/sales/external_sales_cutover_draft.sql` is guarded with DESIGN ONLY and ROLLBACK. Its isolated test adapter is `scripts/sales-runtime/external-sales-cutover-runtime.mjs`; the runtime option is `--external-sales-cutover-only`.

This follows the sealed foundation, external identity bridge and prepared booking receipt. It does not install the operational booking/post-booking commands, open an API, seed staff privileges, enable CRM or deploy a website.

- `replace_sales` verifies the reviewed source, identity bindings, preparation, baseline, held active histories and incoming dependencies. It replaces the local `public.sales` set atomically and saves complete before/after sales images in a private immutable receipt. Legacy leads and survey rows stay untouched.
- An `external_booking_id` foreign key and MATCH FULL source-stage foreign key tie each inserted sale to its immutable prepared evidence. The cancellation exemption applies only to a source row already cancelled, not an imported active sale cancelled later. Unknown historical round/timestamps stay NULL; source dates remain available in private source evidence. This does not invent legacy Lead IDs or cancellation provenance.
- Only eligible histories become operational-table candidates. Held histories remain in private evidence and the result reports their count. An active held history blocks replacement rather than silently freeing its plot.
- Existing plot-sync triggers remain active. The transaction reconciles occupancy, requires an explicit override for stale transferred flags, rejects overrides on unrelated plots or inconsistent with source transfers, and checks both final occupancy and transfer flags. Other plot columns must not change within the transaction.
- Private transaction/backend permits authorize the bounded insert/delete operations. Entry points are operator-only SECURITY INVOKER. The private DML trigger alone uses SECURITY DEFINER to inspect permits without granting legacy clients access; its direct execution is revoked. After replacement, sales writes remain sealed until a separate operational integration is reviewed.
- `rollback_sales` checks that sales and affected plot flags still match the replacement's after-image. It restores complete original sale rows and only `has_customer`/`sale_status` on affected plots. Later construction notes/completion/pause data are not restored from old snapshots. A changed inventory flag or sales row blocks automatic rollback.
- Replay and rollback revalidate current identity bindings. If the original approved accounts/bindings are no longer valid, recovery requires operator review; the code does not silently bypass current authorization.
- A dependency fingerprint checks columns/defaults, incoming/outgoing sales constraints, sales/plot triggers and their function definitions, rewrite rules and sales indexes. Later cascading dependencies or changed trigger/rule behavior stop rollback. Initial production schema review is still required; this fingerprint only detects changes from the reviewed cutover. Function-definition DDL also requires a coordinated maintenance window because table locks alone do not freeze function replacement.

## Still required before production

This is deliberately **not safe to deploy as a standalone live switch**: the local writer composition is not a reviewed production installer, and old sales screens cannot correctly operate on the new identities.

1. Rehearse the composed central intake/booking path against the full current production schema and prepare the bounded installation package. Scope retained legacy records as superseded without false identity mappings. Broader lifecycle, reports and post-booking features remain outside this narrowed release.
2. Verify deployment-time writer retirement, plot-guard compatibility with other departments and exact API privileges. Local implementations of the import permits, ACL seals and stock uniqueness are described above; they have not been installed on production.
3. Test the actual composed release, authentication/session handling, user permissions and frontend end-to-end. The reduced native fixture is not a full Supabase/PostgREST or production schema certification.
4. Refresh the source sheet and production baseline, verify role bindings, deploy the compatible app, then perform the reviewed production installation/import with a selective rollback package. Do not run these design drafts directly or use `db push` across mismatched migration histories.

## Verification

- Earlier native run: `node_modules/.cache/buildtrack-sales-runtime/runs/run-c8kTHP/report.json`, PostgreSQL 17.11, replacement/rollback **54 checks passed**, `status=passed`, `stopped=true`. The newer composed and regression results are recorded above.
- Tests cover concurrent replacement, exact replay, full sale-row restoration, retaining later construction updates, unknown monetary/bank/date values, stale transfer corrections, current Admin bans, new cascading FKs, trigger-function/rewrite-rule drift, private ACLs and blocked activation. The source fixture contains four booking histories: two inserted and two held, not the real 304-history import.
- Unit tests: **118/118 passed** across five runtime/safety test files; scoped ESLint passed. One initial native run found a PL/pgSQL CASE-expression syntax issue; it was corrected and all subsequent final checks passed.
- No full frontend build/E2E, Supabase Auth/PostgREST integration, full production-schema rehearsal, real customer import, production writes, deployment or CRM activation performed. The existence of this test result or a backup record is not a completed release gate.
