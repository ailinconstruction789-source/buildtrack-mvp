# Visit installation and rollback preparation

## Production activation completed — 30 September 2026

This section supersedes the historical preparation-only and permission-blocked status below. The user explicitly authorized the bounded Visit/SOP and no-login 24-hour Customer Voices QR release. No further feature scope was enabled.

- Published exactly 83 selected files in commit `89b63b48087fe2bcdd1afd8280d10c6d4c333902`. Vercel production deployment `27wPATrr1nR7XwaF5dfX3p2ph7Y7` is Ready on [79c5](https://buildtrack-mvp-79c5.vercel.app/sales-crm), with `central_visits` and four scoped Visit environment switches.
- Applied exact reviewed activation artifact as migration `20260930063239 central_visits_reviewed_activation`; operation `50c2c3b7-8c0b-42ea-a4b1-5bc6c736dfcb`. All three database flags are true, QR TTL is 24 hours, one release/activation receipt exists, temporary permits are empty, and booking remains ready. Sealed installation was not repeated.
- Verified HTTPS pages, no-store/no-referrer/frame-denial QR headers, unauthenticated staff API rejection (401), and unissued random QR rejection (410). Admin login, central list/Visit links and an existing customer's Visit page loaded successfully with appointment and Walk-in controls. No production appointment, customer or survey answer was created or changed for acceptance testing.
- Security advisors changed only by the expected grants: three additional [anonymous guarded endpoints](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and fifteen [authenticated guarded endpoints](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Other findings remain unchanged and out of scope. No custom aggregate QR rate limiter is present; this remains an operational follow-up, not a claim of abuse-load protection.
- Full real-customer end-to-end questionnaire submission remains untested. General lifecycle, notifications, KPI, schedules and post-booking remain outside this release. Disable only through the reviewed scoped disable procedure; never restore the whole database or disable booking dependencies as a routine response.

Execution details and review attestations: `docs/sales-visit-production-activation-2026-09-30.json`. Screenshot: `C:/Users/HUAWEI/AppData/Local/Temp/buildtrack-visit-live-2026-09-30.png`.

This release adds appointments, Walk-in check-in, house preparation and tour SOP, a narrowly scoped next action, and Customer Voices per Visit. It preserves the existing central Lead, project booking and project-map release. This document is an operator runbook, not authorization or executable production SQL.

## Current package status

- The selected application snapshot passed its local build and browser workflow checks. Selection is defined by `scripts/release-check/visit-selection.mjs`, from immutable baseline `7499cdd638bc2ff0c33b3ece4d8b0f1e8e7ed857`; do not deploy the entire dirty checkout.
- `sql/sales/deployment/central_visits_candidate.sql` remains **local synthetic only**. It installs the additive Visit chain with flags off and public APIs sealed. It deliberately rejects a production database.
- `sql/sales/deployment/central_visits_disable_local.sql` is the separately guarded local disable rehearsal. It is not a production rollback script. It preserves collected records and returns only the three Visit flags to false.
- A distinct sealed-install preparation now exists at `supabase/migrations/20260930042013_central_visits_sealed_reviewed.sql`, created through Supabase CLI 2.117.0 and assembled by `scripts/sales-runtime/central-visits-reviewed.mjs`. The corresponding operator disable draft is `sql/sales/deployment/central_visits_disable_reviewed.sql`. Neither is authorization to run against production.
- First-activation preparation is now separate at `sql/sales/deployment/central_visits_activate_reviewed.sql`. It is not called by the installer and has not been run on production. Its backup/client/log references are operator attestations requiring independent verification, not automatic proof.
- `sql/sales/deployment/central_visits_preflight_readonly.sql` and `central_visits_preflight_privileges_readonly.sql` were run against the confirmed production project on 2026-09-30, each inside a read-only transaction ending in ROLLBACK. They read catalogs, settings and selected batch/digest receipts, not customer records, tokens or credentials. Evidence is in `docs/sales-visit-live-metadata-2026-09-30.json`.
- There is **not yet an approved production installer or activation command**. Do not remove local guards, replace the database-name check with a guessed project name, paste draft SQL23/25/26, or rerun foundation/import/booking migrations to force installation.

## Before preparing the production migration

1. Confirm the target is Supabase project `kbthmdedilswdmmczfay`, used by `buildtrack-mvp-79c5.vercel.app`; the unused w2a8 site is not the acceptance target. Verify actual metadata again rather than trusting historical context.
2. Run the read-only preflight only after target confirmation. Compare function fingerprints, owners, trigger definitions, RLS/policies, column shapes, grants and feature settings to the reviewed installed chain. Fingerprints are drift detection, not proof of authorization. Stop on differences.
   The report includes selected batch/digest/rollback metadata, column ACLs/defaults, constraints and indexes. Supplement it with effective inherited-role privileges and the exact reviewed release manifest; catalog ACL text alone is not a complete authorization audit.
3. Verify PostgreSQL version. The local installer uses `transaction_timeout`, which the local PostgreSQL 17 rehearsal supports; the production script must explicitly support the actual server version rather than assume it is identical.
4. Verify the exact active source batch and plan digest using metadata only, the corresponding booking release, no rollback receipt, and the actual authorized database operator. The disable operation must compare the complete settings row except the three Visit flags.
5. Confirm a recent usable backup and the recovery owner. A backup is disaster recovery, not the normal way to undo this feature: restoring the entire database could erase new work by other departments.
6. Generate a distinct production migration using the installed Supabase CLI's documented migration command, with a reviewed immutable source/definition manifest. Keep installation, activation and feature disable separate. Rehearse this exact production-safe artifact locally before real execution; the current local artifacts are not a substitute.

## Authorized execution update — 30 September 2026

The user explicitly confirmed production SQL installation, selected 79c5 web deployment, and bounded Visit/SOP/Customer Voices activation. This supersedes the earlier preparation-only authorization notes below; it does not authorize unrelated workflows or data replacement.

At 05:07:52 UTC, the exact reviewed sealed installer committed on `kbthmdedilswdmmczfay` as migration `20260930050752 central_visits_sealed_reviewed_release`. Fresh v2 preflight matched the reviewed saved manifest, and Chrome re-confirmed seven physical backups (latest 29 September 20:24:29 UTC). Postcheck: booking ready, all three Visit flags false, zero Visit releases, zero new public API grants, four restrictive Voice policies, and one install receipt covering 31 functions. No customer import, deletion, or workflow test-record mutation was performed.

Security advisors changed only the intentionally private [RLS/no-policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) category, from 27 to 40. Other pre-existing categories/counts stayed unchanged. Evidence: `sales-visit-sealed-install-execution-2026-09-30.json`.

At this update the selected application has not yet been pushed, Visit has not been activated, and hosting request-body/logging plus direct-RPC abuse controls remain unverified. Chrome temporarily disconnected during Vercel inspection; no Vercel configuration was changed. Do not rerun the installer or record synthetic privacy/client attestations as live evidence.

The safety reviewer rejected the first attempted application-file preparation (`app/api/customer-voices/route.ts` in the release worktree), citing insufficient explicit authorization for unauthenticated public survey submissions. No release-worktree files were changed, no commit/push occurred, and no bypass was attempted. The release worktree remains clean at `7499cdd638bc2ff0c33b3ece4d8b0f1e8e7ed857`. Ask the user to explicitly authorize the token-gated public QR submission scope before a reviewed retry. This authorization gate is separate from the remaining hosting/privacy/abuse-control verification.

Read-only database logging observation: `log_statement=ddl`, `log_min_duration_statement=-1`, `log_parameter_max_length=-1`, `log_parameter_max_length_on_error=0`, `log_min_error_statement=error`, `pgaudit.log=none`, `pgaudit.log_parameter=off`. This does not certify web request-body/APM or all direct-RPC logging behavior; no global logging configuration was changed.

## Intended installation and activation order

1. **Install sealed.** One short transaction, bounded lock/statement timeouts, exact preconditions, additive objects only, all three Visit flags false, new APIs revoked from non-owner roles. Preserve old settings, booking APIs, imported histories, construction fields and legacy Voice SELECT behavior. Abort on drift or contention; do not disable triggers or take prolonged broad construction locks.
2. **Verify sealed state.** Review grants including PUBLIC, anon, authenticated, service_role and custom grants. Compare preserved objects and aggregate invariants, without exporting customer data. Run Supabase advisors and review each intentional SECURITY DEFINER endpoint; never silence findings by granting wider access.
3. **Deploy selected app with Visit closed.** Preserve existing booking/map flags and behavior. Verify existing Admin, construction and Sales workflows. Public questionnaire routes must retain no-store, no-referrer, noindex and anti-framing headers.
4. **Activate separately.** Only after exact artifact approval and a real-account test plan: operator validates batch/digest/review reference, enables only `visits_enabled`, `visit_sop_enabled`, `customer_voices_enabled`, applies the exact API grant list and Voice policy atomically. General lead-work/lifecycle APIs, notifications, KPI, schedules and post-booking remain sealed.
5. **Enable app entry.** Set release scope `central_visits` and the reviewed Visit/SOP/Customer Voices/Visit follow-up flags. Do not reset all environment settings or expose a service-role key. Existing dependencies required for booking remain unchanged.
6. **Verify real access.** Use explicitly designated test records and authorized accounts: current Sales owner, other Sales, Admin/Owner, unauthenticated caller. Confirm real caller JWT and role/ownership denial through PostgREST, correct project/Visit linkage, and unchanged construction/booking behavior. Local mocked/browser/native tests do not replace this check.

## Non-destructive disable strategy

The current activation seal accepts the reviewed ON transition, not a plain OFF update. Also, turning off `lead_work_enabled` or `lead_lifecycle_enabled` would break booking dependencies. The local disable rehearsal uses the existing private booking settings permit under the database operator, validates matched receipts, locks settings, changes exactly the three Visit flags, removes the permit, and checks all other settings unchanged.

For production, prepare and independently review the corresponding exact OFF artifact. It must:

- Seal all 15 new Visit/SOP/Voice/follow-up public functions against every non-owner grant; preserve unrelated permissions.
- Change the restrictive Voice SELECT policy to `visit_id IS NULL` before revoking its row-readable helper, in the same transaction. Legacy survey reads continue; new V2 answers remain stored but temporarily inaccessible through this route.
- Preserve all Visits, appointments, SOP runs, surveys, pending actions, tokens, events, request receipts and imported identities. Do not drop tables, restore old rows or remove completed Visit evidence that a booking may reference.
- Keep an immutable operational receipt identifying operator, reviewed artifact, time and reason. The reviewed installer now defines private `visit_workflow_operations`; both reviewed operations append operator, batch/plan/artifact digests, before/after settings and permission evidence. UPDATE, DELETE and TRUNCATE are rejected. This is prepared and tested locally, not installed on production.
- Roll back flags, policy and grants together if any step fails. Use bounded lock timeouts, ensure no private permit survives, and verify pending requests cannot write after the disable commits.

Then close app entry and return to the reviewed central-booking release scope. Keep the additive database objects. Do not restore the old Voice trigger while collected V2 rows exist. After database disable, already issued QR links must be unable to submit even if an old browser remains open.

Re-enable is deliberately not automatic: the existing activation routine refuses a previous release receipt. A separate resume review must handle outstanding tokens so old QR links cannot silently become valid again.

## Acceptance evidence and remaining boundaries

Detailed results are recorded in `docs/sales-visit-release-preparation-2026-09-29.md` and the disposable runtime report. Read-only production metadata verification is complete for the sampled objects below. The distinct sealed-install and disable artifacts are now prepared for local rehearsal; installation and activation still require separate approval. This does not claim real caller JWT/PostgREST authorization tests, production concurrency, a clean production dependency install, or Vercel acceptance.

## Reviewed artifact contract

The installer requires `buildtrack.visit_operation` JSON supplied on the same operator connection, with no defaults: `operationKind=install`, fresh `operationId`, `reviewReference`, `expectedDatabase`, `expectedSessionActor`, `batchId`, `planDigest`, `releaseDigest`, and the complete `expectedPreflight` object. User-set configuration is not permission: `cutover_operator_check()` still runs first. Do not copy rehearsal values or manufacture a manifest from guesses.

Obtain the manifest with `sql/sales/deployment/central_visits_reviewed_preflight_readonly.sql`. This v2 query includes `house_visit_checklist_items` and `sales_private.visit_submission_tokens`, omitted from the earlier 14-relation sample. The previously saved live v1 report is not an acceptable v2 install input. V2 still reads only catalogs, settings and batch receipts, never customer rows, survey answers or tokens. A live v2 capture is now saved in `docs/sales-visit-live-preflight-v2-2026-09-30.json`: 16 relations and 17 functions; all previously sampled relations, functions and settings remained identical. Both newly included tables have RLS and owner-only table grants. Recheck immediately before execution and stop on drift.

The installer takes bounded locks on the seven existing DDL-targeted tables before comparing the exact manifest. It aborts on unexpected function/table names, existing column/index/trigger collisions, changed metadata, a wrong batch, missing review, contention or an unsealed new API. It does not scan customer/plot records to hash the entire shared database and does not take explicit broad construction locks. Sealing, validation and receipt collection are bounded to release-owned new objects, so unrelated newly created objects are not treated as this release.

The reviewed disable accepts the same target/batch/release inputs with `operationKind=disable` and `expectedSettingsDigest` instead of `expectedPreflight`. It requires a matching install receipt and activated Visit release, rejects reused operation IDs, changes only three flags, and retains all collected records. Its lock and transaction timeouts abort rather than wait indefinitely. Never turn off booking dependency flags to stop Visit.

The selected release digest is `22010a5c929e087232de32b28230fbbfe9ae7fb5e2558583b734079740fc1827`; it identifies the LF-normalized installer source bundle, not the final SQL file hash and not approval. Current file SHA256 values:

- Sealed installer: `1B6F90D99682CD956A0BE0C210C7E3A03F2AEE23B6CD5209CC8E20C31FC94B67`.
- First activation: `E56F58B4F03A066E0BCE060D67B3EE316890AF3B8A2B5496C987F8491CA53ABE`.
- Reviewed disable: `F65ECC3202F4857920DB525E4FD5C798C338FE3EAAD5EBF5370458A314067EBB`.

The retained helper inside the installer is deliberately **local-only** and all new functions remain sealed after installation. The separate reviewed activation SQL now handles first activation; it does not call or bypass that local helper. Production execution approval, client-release and raw QR token log review, fresh backup acceptance, real-account tests and post-install advisors remain separate gates. Resume is unsupported; do not run blanket `db push` from this dirty checkout.

The install receipt now accepts `activate` operations and captures fingerprints, owner names, ACLs and exact trigger associations for all 30 new functions plus the intentionally replaced activation guard. First activation compares that record and the preserved baseline, all four restrictive Voice policies, row guards and inherited callers before granting 15 authenticated endpoints and the three anonymous QR/read-helper endpoints. Only the three Visit switches change. Missing attestations, drift, prior activation/disable and operation replay abort; recorded attestations are explicitly labeled as not automatically verified.

## Backup observation

At 2026-09-30 04:43:42 UTC, the authenticated [Supabase backup page](https://supabase.com/dashboard/project/kbthmdedilswdmmczfay/database/backups/scheduled) displayed the Pro organization and seven physical backups. The latest listed backup was 2026-09-29 20:24:29 UTC, or **30 September 2026 03:24:29 Bangkok time**, with a Restore control. Evidence is saved in `docs/sales-visit-backup-observation-2026-09-30.json`.

No Restore button was clicked, no backup contents were downloaded, and no recovery was attempted. Listing a backup is not proof of a successful restore. Supabase states that database backups exclude Storage objects; a whole-database restore may also discard work performed since that backup. See [Database Backups](https://supabase.com/docs/guides/platform/backups). Recheck availability and acceptable recovery point immediately before a real change; do not use whole-database restore as the routine feature-disable method.

### Current install activation and disable verification

The complete reviewed chain passed on local PostgreSQL 17.11 with `node scripts/sales-runtime/run.mjs --central-visits-reviewed-only`. Report: `node_modules/.cache/buildtrack-sales-runtime/runs/run-GDLcZw/report.json`, status `passed`, cluster `stopped=true`, SHA256 `C443F68986718E4EA6DBA55801781B062165064859FD9115E5BFEA39E7929AC6`.

This run used the exact current saved installer and standalone activation SQL, with explicitly synthetic operator/backup/client/log attestations. It then ran the existing appointment, Walk-in, SOP, follow-up, QR expiry/rotation/submission and disable suites. There were 116 Visit/release checks: 58 workflow, 10 install, 18 activation, 16 original disable, 4 reviewed active-disable/contention probes and 10 reviewed repeat-disable checks. The preceding account/foundation/import/booking chain also passed. Focused Vitest tests passed 39 checks in seven files; activation helper/tests passed ESLint.

Activation tests rejected missing backup/client/log evidence, wrong operator/target/batch/digest, modified functions/grants/policies, disabled row/settings guards and replay. An injected late failure restored flags, grants, release records and operation receipts together. Successful activation changed exactly three flags and granted only the 15 authenticated APIs and three anonymous QR/read-helper APIs; booking stayed ready. First activation committed in the disposable database, not on Supabase.

The real backup listing and v2 catalog observation are separate evidence from these synthetic tests. No real-account/PostgREST activation, Vercel rollout, log-redaction acceptance, recovery test or production mutation was performed. The next externally mutating action requires explicit authorization for **sealed installation only**; activation and web deployment are not implied by that permission.

### Earlier sealed package verification

`node scripts/sales-runtime/run.mjs --central-visits-reviewed-only` passed on PostgreSQL 17.11. Final evidence: `node_modules/.cache/buildtrack-sales-runtime/runs/run-BCNsO9/report.json`, status `passed`, cluster `stopped=true`. The exact saved installer and disable SQL were exercised, with separately supplied synthetic operator/target/metadata inputs. The preceding installed account/foundation/import/booking chain also passed.

- 98 Visit/release checks: 58 workflow, 16 original local disable, 10 reviewed installation, 4 reviewed active-disable/lock-contention probes, and 10 reviewed repeat-disable checks.
- 33 focused Vitest tests across six files passed; new JavaScript files passed ESLint.
- Active ON-to-OFF reviewed disable was checked inside an intentional rollback transaction; exact-byte committed reviewed disable was checked from the already-disabled state. The original local disable also committed ON-to-OFF. These are distinct tests, not a claim that the reviewed artifact committed an active production transition.
- A separate local connection held the settings row `FOR SHARE`; the reviewed disable hit its two-second lock timeout, then preserved exact active settings, function grants, Voice policy and operation receipts. This covers bounded contention, not a complete in-flight production RPC race.
- Unattended install, wrong target, wrong batch/digest, stale metadata, unauthorized caller, repeated install, late failure and reused operation ID were rejected. Late-failure checks restored the entire captured metadata state and left no install receipt. Receipt UPDATE/DELETE/TRUNCATE attempts were refused.
- Imported identities, booking/plot data, legacy surveys, appointment/Visit/SOP/QR evidence and pending actions remained preserved under the existing runtime comparisons. No production database, Vercel environment, GitHub branch or customer data changed in this preparation.

## Production metadata findings on 2026-09-30

The confirmed project `kbthmdedilswdmmczfay` was ACTIVE_HEALTHY, reporting PostgreSQL 17.6. The `transaction_timeout` setting exists. Local rehearsals used 17.11, so this confirms major-version compatibility, not exact environment equality.

- The 17 sampled function bodies matched local migration source exactly, including all five booking/project-sales public APIs, private activation/stock/history guards, the sealed general lead-work/lifecycle APIs, the final role helper and the legacy Voice seal. Canonical live definition MD5, owner, configuration and ACL are recorded separately. This is not proof that every database object or full function declaration equals the local chain.
- All 14 sampled relations have RLS enabled. The booking/source batch and plan digests match, with no rollback receipt. Lead intake, work/lifecycle booking dependencies, booking and cutover review remain enabled. No Visit workflow flags, release relation or sampled new Visit API names were present; foundation Visit/Voice columns already exist and must not be recreated blindly.
- Effective EXECUTE plus schema USAGE checks for anon, authenticated, service_role and authenticator found authenticated can call the five booking/project-sales APIs and role helper. None of these four caller roles can directly execute the sampled private guards or the three sealed general work/lifecycle APIs. Role membership metadata confirms authenticator can SET the API roles but does not inherit them. This is a catalog check, not a real-account request test or an exhaustive custom-role audit.
- The legacy `customer_voices` table grants CRUD to anon, authenticated and service_role, but its permissive SELECT/ALL policies apply to authenticated, not anon. Thus an ordinary authenticated database role has broad legacy-row access under those policies; anon table grants alone do not grant row access. service_role bypasses RLS. No survey records were read or modified to test this.
- The reviewed SQL26 already intersects those legacy policies with restrictive V2 SELECT/INSERT/UPDATE/DELETE policies and an immutable V2 row trigger. Preserve all four restrictive policies and the trigger in the production artifact. Do not mistake RLS being enabled for proof of privacy, remove only the SELECT safeguard, or widen grants to solve installation errors. Legacy-row access remains a separate pre-existing permission concern; it was not changed in this audit.

Before producing an executable release, extend the immutable manifest to every object it replaces or creates, fail on unexpected collisions, and rehearse both sealed install and disable against the observed legacy policy shapes. Keep operator receipts, bounded concurrency behavior, fresh backup confirmation, real-account acceptance and separate activation on the remaining checklist. The captured metadata is point-in-time evidence and must be revalidated immediately before installation.

Official guidance checked: [Supabase Database Functions](https://supabase.com/docs/guides/database/functions), especially function EXECUTE grants and SECURITY DEFINER search paths. The changelog Markdown endpoint could not be fetched in this continuation; no SDK or Supabase API convention was changed.
