# Central Lead release execution — 29 September 2026

Target: Supabase `kbthmdedilswdmmczfay`; app `https://buildtrack-mvp-79c5.vercel.app/`.

User-authorized boundary: central Lead with the refreshed customer sheet through rows 2–966, plus project booking/history. No notifications, Cron, SLA, Visit/QR, KPI or broader post-booking release. Other departments remain in use. Do not run the entire migrations directory or publish the dirty main worktree.

## Pre-install observations

- At `2026-09-29T09:37:52.496357Z`, the read-only roster resolved the same approved nine identities (one Admin, one Owner, seven Sales). `assertCentralRosterUnchanged` passed against digest `f94f056bf287da5913d303ce1d9065d92517643fa5ce2e0f46785368251b7efd`. This check expires in one hour; it is not evergreen authorization.
- At `2026-09-29T09:49:03.732172Z`, live counts were still 8 projects, 306 plots, 895 legacy Leads, 289 sales and zero voices. The CRM foundation was absent.
- Chrome showed the correct Supabase project, main/Production, with seven physical backups. Latest listed backup: `2026-09-28T20:24:38Z` (29 September, 03:24:38 Bangkok). No Restore was clicked. This confirms a listed backup, not a restore drill, PITR coverage or a backup of subsequent transactions/Storage objects.
- Chrome confirmed the live Vercel production deployment was Ready at `f404377c4e5cef2088de1f4d1805164967608539`, deployment `DgJdQyad4Ag7YxgPWEzzBq45zq2o`. Production environment-variable names showed the existing guarded-account flag and existing service configuration; no CRM release flags were present. Secret values were not revealed.
- The frozen workbook hash and bounded plan digest passed their existing offline validators again. The plan proposes 958 eligible customers, 955 interests and 303 plot-linked sales. Six source holds and one booking-history hold remain preserved. Private customer artifacts remain ignored and are never part of the Git release.
- The separately approved construction-only repair remains installed: normalized function MD5 `54c895cd4e84be7650f89baa4b43c138`. Construction completion must not generate a sales transfer.

## Resource sequencing

Running the selected app build and native database rehearsal together exhausted Windows commit memory (paging-file error 1455 / Node native OOM). The owned app build was stopped and the database cluster was shut down safely. No SQL assertion failure was reported through foundation/external schema/identity bridge/booking preparation. Heavy checks are now serialized: complete native rehearsal first, then the selected app build. Do not raise memory limits or terminate unrelated user processes to force progress.

## Execution status

Synthetic SQL tests do not certify real Supabase Auth/PostgREST/browser acceptance.

### Verified sealed installation and data staging

- Exact full-chain native rehearsal `run-exAwhF/report.json` passed and its owned cluster stopped. All 130 reviewed legacy columns and 10 original constraints survived the selected foundation/external/import/writer/construction sequence. This is a reference-compatible synthetic fixture, not a complete Supabase clone.
- Applied **`20260929095503 crm_sealed_foundation_reviewed_release`**, using exact local candidate `20260928090010_crm_sealed_foundation_candidate.sql` plus reviewed transaction-local evidence settings. At `09:55:43.941751Z`, customers/roles/settings were still zero; legacy sales 289, Leads 895, plots 306 and voices zero. Authenticated actor RPC remained sealed. Construction function hash stayed `54c895cd4e84be7650f89baa4b43c138`.
- Applied **`20260929095600 central_booking_external_data_reviewed_release`**, using exact local candidate `20260929082516_central_booking_external_data_candidate.sql` plus reviewed settings. Postcheck found no staged batches/customers/settings, unchanged legacy counts and no authenticated staging execution privilege.
- Seeded only the nine independently confirmed CRM identities through the operator role-review function in one guarded transaction. Result: nine reviewed roles and nine active matching projections, revision 1; zero enabled CRM settings. Sole Admin remains the user-confirmed Admin. No credentials or account creation/deletion.
- Staged the frozen approved plan via the private staging function: batch **`5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5`**, 965 source rows, 963 customer candidates, 960 interest candidates and 304 history rows. Not a client-visible activation.
- Materialized the same batch through the guarded identity bridge: **958 customers, 955 interests, 304 booking-history links**. Response explicitly reports **zero sales written, zero plots changed, activationReady=false**. Existing legacy sales have not been replaced.

### App deployment, replacement and activation

- Selected worktree validation passed: **548 tests / 23 files**, scoped lint, typegen, typecheck and offline webpack build `app-O2OaVK` (13 static pages). Report SHA256 `4079c2e732fb5e118dcd8f137c42032423612a6a8f9ac0ac43d8cd68b546a093`. The main agent independently matched all 67 selected files to the build report before staging.
- Committed exactly 40 application files and 27 tests/fixtures as **`7ae9052ea392e7d683e87ecf5b7e829f291deaeb`** in the existing release worktree; pushed non-forced to GitHub main only after checking the remote was still `f404377`. Dirty main-workspace changes were not published.
- Saved only seven non-secret Production configuration values for Vercel 79c5: `SALES_CRM_RELEASE_SCOPE=central_booking` and the six dependency flags in the candidate document. Existing account flag and service secrets remained unchanged. Vercel UI confirmed successful save requiring a new deployment.
- GitHub's named check **Vercel – buildtrack-mvp-79c5** reported success for the exact commit; deployment **`3diW7XJ6w7YvYPGiKkebcvc4dKja`**. Live central/booking/project-sales APIs returned 401 UNAUTHENTICATED and no-store without credentials. Other connected Vercel project checks included unrelated failures; these were not treated as a 79c5 failure or repaired in this scope.
- Prepared and replaced sales in **one guarded transaction**, checking 304 histories, 303 eligible, one hold, 220 active source plots and 289 old sales. Result: **303 sales written, all 289 previous sales archived**, one held history preserved. Exactly the user-approved ไอลิน6 plot IDs 16, 18, 19 were reconciled to active/source-booked. The procedure checks all other plot/construction fields unchanged before commit.
- Applied **`20260929101309 central_booking_commands_reviewed_release`**, from exact local candidate `20260929080153_central_booking_commands_candidate.sql` and reviewed settings. Post-install readback found 303 sales / 958 customers / 955 interests, zero enabled settings, zero writer releases and still-sealed booking/search RPCs.
- Executed guarded `enable_booking_writer` for the pinned batch/plan. Result: **bookingEnabled=true, notificationsEnabled=false**. It retires legacy sale DML and grants only reviewed central/search/booking/project-read entry points. Internal lead-work/lifecycle dependency switches do not grant those workflows: direct APIs/grants and bounded app scope keep them closed.

### Final database audit at `2026-09-29T10:15:48.793329Z`

- **958 customers, 955 interests, 303 sales: 18 booked / 202 transferred / 83 cancelled.**
- All 304 source histories preserved; one cancelled unknown-plot history held. Six source rows remain held per the prior user decision. All 895 legacy Lead rows retained and all 289 replaced legacy sales archived privately.
- Occupancy mismatches **0**; plots with multiple active sales **0**.
- Authenticated central search/booking enabled; anonymous central search denied; direct authenticated legacy sale writes denied; client raw-snapshot reads denied.
- Construction repair hash unchanged: `54c895cd4e84be7650f89baa4b43c138`.
- No notification/Cron/SLA/Visit/QR/KPI/post-booking release or test customer/booking created.

### Acceptance and remaining limits

The user confirmed logging into Admin and then explicitly confirmed that `/sales-crm` shows **the customer list and create-Lead button** after refresh. This is user-verified Admin read/UI acceptance, not an agent-performed real booking test. Chrome control suffered `Debugger unattached` / connection timeouts after documented tab recovery and kernel reinitialization, so no agent screenshot/visual acceptance is claimed. Actual Sales-account write/booking acceptance and other-department UI checks after this release remain unverified. No real customer was altered merely to test a workflow.

Security advisors: existing warning categories/counts remain (definer views 10, mutable search paths 8, metadata RLS 5, anonymous presence RPC 1, leaked-password protection 1). [Private RLS-without-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) increased from 1 to 27 for intentionally client-sealed, deny-by-default private tables. [Authenticated definer-RPC notices](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) increased from 1 to 12 after granting reviewed caller/session/role-checked CRM functions. No new anonymous definer exposure. This is not whole-system security certification or remediation of pre-existing policies.

Do not rerun the initial empty-roster/foundation installers, bypass their guards, or push the migrations directory wholesale. Remote timestamps differ from local filenames. The old replacement rollback deliberately refuses after operational writer installation/new work. Do not restore the shared database wholesale to undo this Sales release.
